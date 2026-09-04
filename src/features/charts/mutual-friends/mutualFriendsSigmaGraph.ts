import EdgeCurveProgram from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import Graph from 'graphology';
import Sigma from 'sigma';

import { runGraphLayoutWorker } from './graphLayoutWorkerClient';
import { isMutualFriendNodeUnavailable } from './mutualFriendsFilters';
import {
    communityColor,
    type MutualFriendsGraphTheme
} from './mutualFriendsPalette';
import { truncateMutualFriendLabel } from './mutualFriendsPicker';
import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_LAYOUT_DEFAULTS,
    MUTUAL_GRAPH_LAYOUT_LIMITS
} from './mutualFriendsSettings';
import { mixGraphColors } from './mutualFriendsSigmaColors';
import {
    drawMutualFriendHoverCard,
    type HoverCardStrings
} from './mutualFriendsSigmaHoverCard';
import type {
    MutualFriendGraph,
    MutualFriendsLayoutSettings
} from './mutualFriendsTypes';

const NODE_LABEL_THRESHOLD = 10;
const LABEL_DENSITY = 0.7;
const LABEL_GRID_CELL_SIZE = 140;
const SELECTED_SIZE_SCALE = 1.35;
const HOVER_SIZE_SCALE = 1.55;
const NODE_DIM_STRENGTH = 0.9;
const EDGE_DIM_STRENGTH = 0.85;
const HOVER_ENTER_DURATION = 140;
const HOVER_LEAVE_DURATION = 110;
const SELECTION_DURATION = 180;

type MutualFriendsNodeAttributes = Record<string, unknown> & {
    baseColor?: string;
    baseSize: number;
    baseX?: number;
    baseY?: number;
    color?: string;
    community: number;
    communityNamed: boolean;
    degree: number;
    forceLabel?: boolean;
    fullLabel: string;
    holeColor?: string;
    label: string;
    lastFetchedAt: string | null;
    mutualCount: number;
    optedOut: boolean;
    size: number;
    type: string;
    x?: number;
    y?: number;
    zIndex: number;
};

type MutualFriendsEdgeAttributes = Record<string, unknown> & {
    color?: string;
    curvature?: number;
    size: number;
    type?: string;
    zIndex?: number;
};

export type MutualFriendsSigmaGraph = Graph<
    MutualFriendsNodeAttributes,
    MutualFriendsEdgeAttributes
>;

const {
    edgeCurvature: EDGE_CURVATURE_LIMITS,
    communitySeparation: COMMUNITY_SEPARATION_LIMITS
} = MUTUAL_GRAPH_LAYOUT_LIMITS;

const NodeBorderProgram = createNodeBorderProgram({
    borders: [
        { size: { value: 0.1 }, color: { value: '#f2f2f2' } },
        { size: { fill: true }, color: { attribute: 'color' } }
    ]
});

const NodeHollowProgram = createNodeBorderProgram({
    borders: [
        { size: { value: 0.34 }, color: { attribute: 'color' } },
        { size: { fill: true }, color: { attribute: 'holeColor' } }
    ]
});

let layoutRequestSequence = 0;

function easeOut(progress: number) {
    return 1 - Math.pow(1 - progress, 3);
}

export type SigmaInstance = Sigma;

interface GraphTransition {
    value: number;
    frame: number;
}

function createTransition(): GraphTransition {
    return { value: 0, frame: 0 };
}

function cancelTransition(transition: GraphTransition) {
    if (transition.frame) {
        cancelAnimationFrame(transition.frame);
        transition.frame = 0;
    }
}

function runTransition(
    transition: GraphTransition,
    target: number,
    duration: number,
    onFrame: () => void
) {
    cancelTransition(transition);

    const from = transition.value;
    const distance = target - from;
    if (!distance || duration <= 0) {
        transition.value = target;
        onFrame();
        return;
    }

    const start = performance.now();
    const step = () => {
        const elapsed = performance.now() - start;
        const progress = Math.min(1, elapsed / duration);
        transition.value = from + distance * easeOut(progress);
        onFrame();
        transition.frame = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    transition.frame = requestAnimationFrame(step);
}

function prefersReducedMotion() {
    return (
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
}

function serializeGraph(graph: MutualFriendsSigmaGraph) {
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

function applyLayoutPositions(
    graph: MutualFriendsSigmaGraph,
    positions: Record<string, { x: number; y: number }>
) {
    for (const [node, position] of Object.entries(positions || {})) {
        if (graph.hasNode(node)) {
            graph.mergeNodeAttributes(node, {
                x: position.x,
                y: position.y,
                baseX: position.x,
                baseY: position.y
            });
        }
    }
}

function buildFallbackLayout(graph: MutualFriendsSigmaGraph) {
    const nodes = graph.nodes();
    const radius = Math.max(50, Math.sqrt(nodes.length || 1) * 30);
    nodes.forEach((node, index) => {
        const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        graph.mergeNodeAttributes(node, { x, y, baseX: x, baseY: y });
    });
}

export function applyMutualFriendsEdgeCurvature(
    graph: MutualFriendsSigmaGraph,
    layoutSettings: MutualFriendsLayoutSettings
) {
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

export function applyMutualFriendsCommunitySeparation(
    graph: MutualFriendsSigmaGraph,
    layoutSettings: MutualFriendsLayoutSettings
) {
    const separation = clampMutualGraphNumber(
        layoutSettings.communitySeparation,
        COMMUNITY_SEPARATION_LIMITS.min,
        COMMUNITY_SEPARATION_LIMITS.max,
        MUTUAL_GRAPH_LAYOUT_DEFAULTS.communitySeparation
    );

    if (separation <= 0) {
        graph.forEachNode((node, attributes) => {
            graph.mergeNodeAttributes(node, {
                x: attributes.baseX ?? attributes.x,
                y: attributes.baseY ?? attributes.y
            });
        });
        return;
    }

    const communities = new Map<
        number,
        {
            nodes: { node: string; x: number; y: number }[];
            cx: number;
            cy: number;
        }
    >();
    graph.forEachNode((node, attributes) => {
        const community = attributes.community;
        const bucket = communities.get(community) ?? {
            nodes: [],
            cx: 0,
            cy: 0
        };
        bucket.nodes.push({
            node,
            x: attributes.baseX ?? attributes.x ?? 0,
            y: attributes.baseY ?? attributes.y ?? 0
        });
        communities.set(community, bucket);
    });

    let total = 0;
    let globalX = 0;
    let globalY = 0;
    for (const community of communities.values()) {
        for (const item of community.nodes) {
            community.cx += item.x;
            community.cy += item.y;
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
                x: item.x + pushX,
                y: item.y + pushY
            });
        }
    }
}

export function applyMutualFriendsGraphTheme(
    graph: MutualFriendsSigmaGraph,
    theme: MutualFriendsGraphTheme
) {
    graph.forEachNode((node, attributes) => {
        graph.mergeNodeAttributes(node, {
            baseColor: communityColor(
                theme.communityPalette,
                attributes.community,
                attributes.communityNamed,
                theme.neutralCommunityColor
            ),
            holeColor: theme.backgroundColor
        });
    });
}

export async function buildSigmaGraph({
    graph: sourceGraph,
    layoutSettings,
    communityIndexById,
    namedCommunityIndexes,
    theme
}: {
    graph: MutualFriendGraph;
    layoutSettings: MutualFriendsLayoutSettings;
    communityIndexById: Map<string, number>;
    namedCommunityIndexes: ReadonlySet<number>;
    theme: MutualFriendsGraphTheme;
}) {
    const graph = new Graph<
        MutualFriendsNodeAttributes,
        MutualFriendsEdgeAttributes
    >({
        type: 'undirected',
        multi: false,
        allowSelfLoops: false
    });
    const maxDegree = sourceGraph.nodes.reduce(
        (max, node) => Math.max(max, node.degree),
        0
    );

    for (const node of sourceGraph.nodes) {
        const baseSize = 4 + (maxDegree ? (node.degree / maxDegree) * 18 : 0);
        const community = communityIndexById.get(node.id) ?? 0;
        graph.addNode(node.id, {
            label: truncateMutualFriendLabel(node.label, 20),
            fullLabel: node.label,
            size: baseSize,
            baseSize,
            degree: node.degree,
            mutualCount: node.mutualCount,
            optedOut: node.optedOut,
            lastFetchedAt: node.lastFetchedAt,
            community,
            communityNamed: namedCommunityIndexes.has(community),
            type: isMutualFriendNodeUnavailable(node) ? 'hollow' : 'border',
            zIndex: 1
        });
    }

    for (const link of sourceGraph.links) {
        if (!graph.hasNode(link.source) || !graph.hasNode(link.target)) {
            continue;
        }
        const key = [link.source, link.target].sort().join('__');
        if (!graph.hasEdge(key)) {
            graph.addEdgeWithKey(key, link.source, link.target, { size: 0.5 });
        }
    }

    if (graph.order > 1) {
        try {
            const positions = await runGraphLayoutWorker({
                requestId: `mutual-graph-layout-${(layoutRequestSequence += 1)}`,
                ...serializeGraph(graph),
                settings: {
                    layoutIterations: layoutSettings.layoutIterations,
                    layoutSpacing: layoutSettings.layoutSpacing,
                    deltaSpacing: 0,
                    reinitialize: true
                }
            });
            applyLayoutPositions(graph, positions);
        } catch (error) {
            console.warn(
                '[MutualFriendsPage] Graph layout worker failed, using fallback layout.',
                error
            );
            buildFallbackLayout(graph);
        }
    } else {
        buildFallbackLayout(graph);
    }

    applyMutualFriendsGraphTheme(graph, theme);
    applyMutualFriendsCommunitySeparation(graph, layoutSettings);
    applyMutualFriendsEdgeCurvature(graph, layoutSettings);

    return graph;
}

export function destroySigmaInstance(
    instanceRef: { current: SigmaInstance | null },
    resizeObserverRef: { current: ResizeObserver | null }
) {
    resizeObserverRef.current?.disconnect();
    instanceRef.current?.kill();
    resizeObserverRef.current = null;
    instanceRef.current = null;
}

export function renderSigmaGraph({
    graph,
    container,
    instanceRef,
    resizeObserverRef,
    themeRef,
    selectedNodeIdRef,
    onSelectNode,
    onOpenNode,
    hoverCardStringsRef
}: {
    graph: MutualFriendsSigmaGraph;
    container: HTMLElement;
    instanceRef: { current: SigmaInstance | null };
    resizeObserverRef: { current: ResizeObserver | null };
    themeRef: { current: MutualFriendsGraphTheme };
    selectedNodeIdRef: { current: string };
    onSelectNode: (nodeId: string) => void;
    onOpenNode: (nodeId: string) => void;
    hoverCardStringsRef: { current: HoverCardStrings };
}) {
    let sigma = instanceRef.current;

    if (sigma) {
        sigma.setGraph(graph);
        sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    } else {
        sigma = new Sigma(graph, container, {
            allowInvalidContainer: true,
            renderLabels: true,
            labelRenderedSizeThreshold: NODE_LABEL_THRESHOLD,
            labelDensity: LABEL_DENSITY,
            labelGridCellSize: LABEL_GRID_CELL_SIZE,
            zIndex: true,
            defaultNodeType: 'border',
            nodeProgramClasses: {
                border: NodeBorderProgram,
                hollow: NodeHollowProgram
            },
            edgeProgramClasses: { curve: EdgeCurveProgram }
        });
        instanceRef.current = sigma;
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = new ResizeObserver(() => {
            sigma?.resize();
            sigma?.refresh();
        });
        resizeObserverRef.current.observe(container);
    }

    const renderer = sigma;
    const reducedMotion = prefersReducedMotion();
    const hoverTransition = createTransition();
    const selectionTransition = createTransition();
    let hovered: string | null = null;
    let neighbors = new Set<string>();

    const repaint = () => renderer.refresh({ skipIndexation: true });

    const applyTheme = () => {
        renderer.setSetting('labelColor', {
            color: themeRef.current.labelColor
        });
        renderer.setSetting('defaultEdgeColor', themeRef.current.edgeColor);
        repaint();
    };

    renderer.setSetting('labelRenderedSizeThreshold', NODE_LABEL_THRESHOLD);
    renderer.setSetting('defaultDrawNodeHover', (ctx, data, settings) =>
        drawMutualFriendHoverCard(
            ctx,
            {
                x: data.x,
                y: data.y,
                size: data.size,
                label: data.label,
                fullLabel:
                    'fullLabel' in data && typeof data.fullLabel === 'string'
                        ? data.fullLabel
                        : undefined,
                lastFetchedAt:
                    'lastFetchedAt' in data &&
                    (typeof data.lastFetchedAt === 'string' ||
                        data.lastFetchedAt === null)
                        ? data.lastFetchedAt
                        : undefined,
                optedOut:
                    'optedOut' in data && typeof data.optedOut === 'boolean'
                        ? data.optedOut
                        : undefined,
                mutualCount:
                    'mutualCount' in data &&
                    typeof data.mutualCount === 'number'
                        ? data.mutualCount
                        : undefined
            },
            settings,
            themeRef.current,
            hoverCardStringsRef.current
        )
    );

    renderer.setSetting('nodeReducer', (node, data) => {
        const baseColor = String(data.baseColor ?? data.color);
        const baseSize = Number(data.baseSize ?? data.size ?? 4);
        const theme = themeRef.current;
        const isSelected = node === selectedNodeIdRef.current;
        const selection = isSelected ? selectionTransition.value : 0;
        const dim = hoverTransition.value;
        const isHovered = node === hovered;
        const isNeighbor = neighbors.has(node);
        const stayLit = isHovered || isNeighbor || isSelected;

        const result: Record<string, unknown> = { ...data };
        result.size = baseSize * (1 + (SELECTED_SIZE_SCALE - 1) * selection);

        if (isHovered) {
            result.color = baseColor;
            result.size = baseSize * (1 + (HOVER_SIZE_SCALE - 1) * dim);
            result.forceLabel = true;
            result.zIndex = 4;
            return result;
        }

        if (stayLit) {
            result.color = baseColor;
            result.forceLabel = isSelected || (isNeighbor && dim > 0.5);
            result.zIndex = isSelected ? 3 : 2;
            return result;
        }

        result.color = mixGraphColors(
            baseColor,
            theme.backgroundColor,
            dim * NODE_DIM_STRENGTH
        );
        result.zIndex = 1;
        if (dim > 0.5) {
            result.label = '';
        }
        return result;
    });

    renderer.setSetting('edgeReducer', (edge, data) => {
        const result: Record<string, unknown> = { ...data };
        const theme = themeRef.current;
        const dim = hoverTransition.value;
        if (!dim) {
            result.color = theme.edgeColor;
            return result;
        }

        if (!graph.hasEdge(edge)) {
            return result;
        }

        const [source, target] = graph.extremities(edge);
        const isIncident = source === hovered || target === hovered;
        result.color = isIncident
            ? mixGraphColors(theme.edgeColor, theme.edgeActiveColor, dim)
            : mixGraphColors(
                  theme.edgeColor,
                  theme.backgroundColor,
                  dim * EDGE_DIM_STRENGTH
              );
        result.zIndex = isIncident ? 1 : 0;
        return result;
    });

    renderer.removeAllListeners();
    renderer.on('enterNode', ({ node }) => {
        hovered = node;
        neighbors = graph.hasNode(node)
            ? new Set(graph.neighbors(node))
            : new Set();
        runTransition(
            hoverTransition,
            1,
            reducedMotion ? 0 : HOVER_ENTER_DURATION,
            repaint
        );
    });
    renderer.on('leaveNode', () => {
        runTransition(
            hoverTransition,
            0,
            reducedMotion ? 0 : HOVER_LEAVE_DURATION,
            () => {
                if (!hoverTransition.value) {
                    hovered = null;
                    neighbors = new Set();
                }
                repaint();
            }
        );
    });
    renderer.on('clickNode', ({ node }) => {
        if (node) {
            onSelectNode(node);
        }
    });
    renderer.on('doubleClickNode', (event) => {
        event.preventSigmaDefault();
        if (event.node) {
            onOpenNode(event.node);
        }
    });

    let appliedSelection = selectedNodeIdRef.current;
    selectionTransition.value = appliedSelection ? 1 : 0;
    applyTheme();
    renderer.refresh();

    return {
        applySelection(nodeId: string) {
            if (appliedSelection === nodeId) {
                repaint();
                return;
            }
            appliedSelection = nodeId;
            selectedNodeIdRef.current = nodeId;
            selectionTransition.value = 0;
            runTransition(
                selectionTransition,
                nodeId ? 1 : 0,
                reducedMotion ? 0 : SELECTION_DURATION,
                repaint
            );
        },
        applyTheme,
        dispose() {
            cancelTransition(hoverTransition);
            cancelTransition(selectionTransition);
        }
    };
}

export type SigmaGraphController = ReturnType<typeof renderSigmaGraph>;
