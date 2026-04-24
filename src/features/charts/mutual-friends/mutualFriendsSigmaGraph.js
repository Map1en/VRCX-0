import EdgeCurveProgram from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import Sigma from 'sigma';

import dayjs from '@/lib/dayjs.js';
import { mutualGraphRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { executeWithBackoff } from '@/shared/utils/retry.js';

import GraphLayoutWorker from '../graphLayoutWorker.js?worker&inline';
import { truncateMutualFriendLabel } from './mutualFriendsPicker.js';
import {
    clampMutualGraphNumber,
    isValidMutualFriendId,
    MUTUAL_GRAPH_LAYOUT_DEFAULTS,
    MUTUAL_GRAPH_LAYOUT_LIMITS
} from './mutualFriendsSettings.js';

const COLORS_PALETTE = [
    '#5470c6',
    '#91cc75',
    '#fac858',
    '#ee6666',
    '#73c0de',
    '#3ba272',
    '#fc8452',
    '#9a60b4',
    '#ea7ccc'
];
const NODE_LABEL_THRESHOLD = 10;
const NodeBorderProgram = createNodeBorderProgram({
    borders: [
        { size: { value: 0.1 }, color: { value: '#f2f2f2' } },
        { size: { fill: true }, color: { attribute: 'color' } }
    ]
});
const {
    edgeCurvature: EDGE_CURVATURE_LIMITS,
    communitySeparation: COMMUNITY_SEPARATION_LIMITS
} = MUTUAL_GRAPH_LAYOUT_LIMITS;

export async function fetchMutualFriendIds(
    friendId,
    { rateLimiter = null, isCancelled = () => false } = {}
) {
    const collected = [];
    let offset = 0;

    while (true) {
        if (isCancelled()) {
            break;
        }
        if (rateLimiter) {
            await rateLimiter.wait();
        }
        if (isCancelled()) {
            break;
        }

        const response = await executeWithBackoff(
            () => {
                if (isCancelled()) {
                    throw new Error('cancelled');
                }
                return mutualGraphRepository.getMutualFriends({
                    friendId,
                    offset,
                    n: 100
                });
            },
            {
                maxRetries: 4,
                baseDelay: 500,
                shouldRetry: (error) =>
                    error?.status === 429 ||
                    String(error?.message || '').includes('429')
            }
        ).catch((error) => {
            if (String(error?.message || '') === 'cancelled') {
                return null;
            }
            throw error;
        });

        if (!response || isCancelled()) {
            break;
        }

        const page = Array.isArray(response.json) ? response.json : [];
        collected.push(
            ...page.map((entry) => entry?.id).filter(isValidMutualFriendId)
        );

        if (page.length < 100) {
            break;
        }
        offset += page.length;
    }

    return collected;
}

function serializeGraph(graph) {
    return {
        nodes: graph.nodes().map((id) => ({
            id,
            attributes: graph.getNodeAttributes(id)
        })),
        edges: graph.edges().map((key) => {
            const [source, target] = graph.extremities(key);
            return {
                key,
                source,
                target,
                attributes: graph.getEdgeAttributes(key)
            };
        })
    };
}

function runLayoutWorker(graph, settings) {
    const { nodes, edges } = serializeGraph(graph);
    return new Promise((resolve, reject) => {
        const requestId = `${Date.now()}:${Math.random()}`;
        const worker = new GraphLayoutWorker();
        worker.addEventListener('message', (event) => {
            if (event.data?.requestId !== requestId) {
                return;
            }
            worker.terminate();
            if (event.data.error) {
                reject(new Error(event.data.error));
                return;
            }
            resolve(event.data.positions || {});
        });
        worker.addEventListener('error', (event) => {
            worker.terminate();
            reject(
                event instanceof ErrorEvent
                    ? event.error || new Error(event.message)
                    : new Error('Graph layout worker failed.')
            );
        });
        worker.postMessage({ requestId, nodes, edges, settings });
    });
}

function applyLayoutPositions(graph, positions) {
    for (const [node, position] of Object.entries(positions || {})) {
        if (graph.hasNode(node)) {
            graph.mergeNodeAttributes(node, position);
        }
    }
}

function applyEdgeCurvature(graph, layoutSettings) {
    const curvature = clampMutualGraphNumber(
        layoutSettings.edgeCurvature,
        EDGE_CURVATURE_LIMITS.min,
        EDGE_CURVATURE_LIMITS.max,
        MUTUAL_GRAPH_LAYOUT_DEFAULTS.edgeCurvature
    );
    const type = curvature > 0 ? 'curve' : 'line';
    graph.forEachEdge((edge) => {
        graph.mergeEdgeAttributes(edge, { curvature, type });
    });
}

function assignCommunitiesAndColors(graph) {
    const communities = louvain(graph);
    const ids = Array.from(new Set(Object.values(communities))).sort(
        (left, right) => String(left).localeCompare(String(right))
    );
    const idToIndex = new Map(ids.map((id, index) => [id, index]));

    graph.forEachNode((node) => {
        const communityId = communities[node];
        const colorIndex = idToIndex.get(communityId) ?? 0;
        graph.mergeNodeAttributes(node, {
            community: communityId,
            color: COLORS_PALETTE[colorIndex % COLORS_PALETTE.length]
        });
    });
}

function applyCommunitySeparation(graph, layoutSettings) {
    const separation = clampMutualGraphNumber(
        layoutSettings.communitySeparation,
        COMMUNITY_SEPARATION_LIMITS.min,
        COMMUNITY_SEPARATION_LIMITS.max,
        MUTUAL_GRAPH_LAYOUT_DEFAULTS.communitySeparation
    );
    if (separation <= 0) {
        return;
    }

    const communities = new Map();
    graph.forEachNode((node, attrs) => {
        if (typeof attrs.community === 'undefined') {
            return;
        }
        if (!communities.has(attrs.community)) {
            communities.set(attrs.community, { nodes: [], cx: 0, cy: 0 });
        }
        communities
            .get(attrs.community)
            .nodes.push({ node, x: attrs.x, y: attrs.y });
    });

    let total = 0;
    let globalX = 0;
    let globalY = 0;
    for (const community of communities.values()) {
        for (const item of community.nodes) {
            community.cx += item.x || 0;
            community.cy += item.y || 0;
        }
        community.cx /= Math.max(community.nodes.length, 1);
        community.cy /= Math.max(community.nodes.length, 1);
        globalX += community.cx * community.nodes.length;
        globalY += community.cy * community.nodes.length;
        total += community.nodes.length;
    }
    globalX /= Math.max(total, 1);
    globalY /= Math.max(total, 1);

    for (const community of communities.values()) {
        const dx = community.cx - globalX;
        const dy = community.cy - globalY;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const pushX = (dx / distance) * separation * 80;
        const pushY = (dy / distance) * separation * 80;
        for (const item of community.nodes) {
            graph.mergeNodeAttributes(item.node, {
                x: (item.x || 0) + pushX,
                y: (item.y || 0) + pushY
            });
        }
    }
}

function buildFallbackLayout(graph) {
    const nodes = graph.nodes();
    const radius = Math.max(50, Math.sqrt(nodes.length || 1) * 30);
    nodes.forEach((node, index) => {
        const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
        graph.mergeNodeAttributes(node, {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
        });
    });
}

export function destroySigmaInstance(instanceRef, resizeObserverRef) {
    resizeObserverRef.current?.disconnect();
    instanceRef.current?.kill?.();
    resizeObserverRef.current = null;
    instanceRef.current = null;
}

function drawSigmaNodeHover(ctx, data, settings, t) {
    const label = data.fullLabel || data.label;
    if (!label) {
        return;
    }

    const fontSize = settings.labelSize ?? 12;
    const font = settings.labelFont ?? 'sans-serif';
    const smallFontSize = Math.max(9, fontSize - 2);
    const subLine = data.lastFetchedAt
        ? `${t('view.charts.mutual_friend.context_menu.last_fetched')}: ${dayjs(data.lastFetchedAt).format('YYYY-MM-DD HH:mm')}`
        : '';
    const paddingX = 6;
    const paddingY = 4;

    ctx.font = `${fontSize}px ${font}`;
    ctx.textBaseline = 'middle';
    const labelWidth = ctx.measureText(label).width;
    ctx.font = `${smallFontSize}px ${font}`;
    const subWidth = subLine ? ctx.measureText(subLine).width : 0;
    ctx.font = `${fontSize}px ${font}`;

    const width = Math.max(labelWidth, subWidth) + paddingX * 2;
    const lineHeight = fontSize + paddingY;
    const height = lineHeight * (subLine ? 2 : 1) + paddingY;
    const x = data.x + data.size - 5;
    const y = data.y - height / 2;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fillRect(x, y, width, height);

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#111827';
    ctx.font = `${fontSize}px ${font}`;
    ctx.fillText(label, x + paddingX, y + paddingY + fontSize / 2);

    if (subLine) {
        ctx.fillStyle = data.optedOut ? '#dc2626' : '#6b7280';
        ctx.font = `${smallFontSize}px ${font}`;
        ctx.fillText(
            subLine,
            x + paddingX,
            y + paddingY + lineHeight + smallFontSize / 2
        );
    }
}

export function renderSigmaGraph({
    graph,
    container,
    instanceRef,
    resizeObserverRef,
    isDarkMode,
    selectedNodeIdRef,
    onSelectNode,
    t
}) {
    const labelColor = isDarkMode ? '#e2e8f0' : '#111827';
    const edgeBase = isDarkMode ? '#334155' : '#94a3b8';
    const edgeActive = isDarkMode ? '#bac1c9' : '#0f172a';
    let sigma = instanceRef.current;
    let cameraState = null;

    if (sigma) {
        cameraState = sigma.getCamera?.()?.getState?.() || null;
        sigma.setGraph(graph);
        sigma.setSetting('labelRenderedSizeThreshold', NODE_LABEL_THRESHOLD);
        sigma.setSetting('labelColor', { color: labelColor });
        sigma.setSetting('defaultEdgeColor', edgeBase);
        sigma.setSetting('zIndex', true);
    } else {
        sigma = new Sigma(graph, container, {
            allowInvalidContainer: true,
            renderLabels: true,
            labelRenderedSizeThreshold: NODE_LABEL_THRESHOLD,
            labelColor: { color: labelColor },
            defaultEdgeColor: edgeBase,
            zIndex: true,
            defaultNodeType: 'border',
            nodeProgramClasses: { border: NodeBorderProgram },
            edgeProgramClasses: { curve: EdgeCurveProgram },
            defaultDrawNodeHover: (ctx, data, settings) =>
                drawSigmaNodeHover(ctx, data, settings, t)
        });
        instanceRef.current = sigma;
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = new ResizeObserver(() => {
            sigma.resize();
            sigma.refresh();
        });
        resizeObserverRef.current.observe(container);
    }

    if (cameraState) {
        sigma.getCamera?.()?.setState?.(cameraState);
    }

    let hovered = null;
    let neighbors = new Set();
    const rebuildNeighbors = (node) => {
        neighbors =
            node && graph.hasNode(node)
                ? new Set(graph.neighbors(node))
                : new Set();
    };

    sigma.setSetting('nodeReducer', (node, data) => {
        const result = { ...data };
        const isSelected = node === selectedNodeIdRef.current;

        if (data.optedOut) {
            result.borderColor = '#9ca3af';
        }

        if (!hovered) {
            result.color = data.optedOut ? '#d1d5db' : data.color;
            result.zIndex = isSelected ? 3 : 1;
            if (isSelected) {
                result.size = (data.size || 4) * 1.35;
                result.label = `${data.label} (${data.degree ?? graph.degree(node) ?? 0})`;
            }
            return result;
        }

        const isHover = node === hovered;
        const isNeighbor = neighbors.has(node);

        if (isHover) {
            result.color = '#facc15';
            result.size = (data.size || 4) * 1.6;
            result.label = `${data.label} (${neighbors.size})`;
            result.labelColor = '#111827';
            result.zIndex = 4;
            return result;
        }

        if (isNeighbor || isSelected) {
            result.color = data.color;
            result.size = (data.size || 4) * (isSelected ? 1.35 : 1.2);
            result.label = data.label;
            result.labelColor = '#111827';
            result.zIndex = isSelected ? 3 : 2;
            return result;
        }

        result.color = isDarkMode
            ? 'rgba(148,163,184,0.04)'
            : 'rgba(100,116,139,0.06)';
        result.size = 0.7;
        result.label = '';
        result.zIndex = 0;
        return result;
    });

    sigma.setSetting('edgeReducer', (edge, data) => {
        const result = { ...data };
        if (!hovered) {
            result.hidden = false;
            result.color = edgeBase;
            result.size = data.size || 1;
            return result;
        }

        const [source, target] = graph.extremities(edge);
        if (source === hovered || target === hovered) {
            result.hidden = false;
            result.color = edgeActive;
            result.size = data.size || 1;
            return result;
        }

        result.hidden = true;
        return result;
    });

    sigma.removeAllListeners?.();
    sigma.on('enterNode', ({ node }) => {
        hovered = node;
        rebuildNeighbors(node);
        sigma.setSetting('labelRenderedSizeThreshold', 0);
        sigma.refresh();
    });
    sigma.on('leaveNode', () => {
        hovered = null;
        rebuildNeighbors(null);
        sigma.setSetting('labelRenderedSizeThreshold', NODE_LABEL_THRESHOLD);
        sigma.refresh();
    });
    sigma.on('clickNode', ({ node }) => {
        if (!node) {
            return;
        }
        selectedNodeIdRef.current = node;
        onSelectNode(node);
        openUserDialog({
            userId: node,
            title:
                graph.getNodeAttribute(node, 'fullLabel') ||
                graph.getNodeAttribute(node, 'label') ||
                undefined
        });
        sigma.refresh();
    });
    sigma.refresh();
}

export async function buildSigmaGraph({
    nodes,
    links,
    layoutSettings,
    selectedNodeId
}) {
    const graph = new Graph({
        type: 'undirected',
        multi: false,
        allowSelfLoops: false
    });
    const maxDegree = nodes.reduce(
        (max, node) => Math.max(max, Number(node.degree) || 0),
        0
    );

    for (const node of nodes) {
        const degree = Number(node.degree) || 0;
        const isSelected = node.id === selectedNodeId;
        graph.addNode(node.id, {
            label: truncateMutualFriendLabel(node.label, 20),
            fullLabel: node.label,
            size:
                (4 + (maxDegree ? (degree / maxDegree) * 18 : 0)) *
                (isSelected ? 1.35 : 1),
            degree,
            optedOut: Boolean(node.optedOut),
            lastFetchedAt: node.lastFetchedAt || null,
            type: 'border',
            zIndex: isSelected ? 3 : 1,
            color: node.optedOut ? '#d1d5db' : COLORS_PALETTE[0]
        });
    }

    for (const link of links) {
        if (!graph.hasNode(link.source) || !graph.hasNode(link.target)) {
            continue;
        }
        const key = [link.source, link.target].sort().join('__');
        if (!graph.hasEdge(key)) {
            graph.addEdgeWithKey(key, link.source, link.target, { size: 0.75 });
        }
    }

    if (graph.order > 1) {
        try {
            const positions = await runLayoutWorker(graph, {
                layoutIterations: layoutSettings.layoutIterations,
                layoutSpacing: layoutSettings.layoutSpacing,
                deltaSpacing: 0,
                reinitialize: true
            });
            applyLayoutPositions(graph, positions);
        } catch (error) {
            console.warn(
                '[MutualFriendsPage] Graph layout worker failed, using fallback layout.',
                error
            );
            buildFallbackLayout(graph);
        }
        assignCommunitiesAndColors(graph);
        applyCommunitySeparation(graph, layoutSettings);
        applyEdgeCurvature(graph, layoutSettings);
    } else {
        buildFallbackLayout(graph);
    }

    return graph;
}
