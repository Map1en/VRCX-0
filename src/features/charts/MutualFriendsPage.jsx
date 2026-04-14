import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CheckIcon,
    EyeOffIcon,
    LoaderCircleIcon,
    RefreshCcwIcon,
    Settings2Icon,
    UserIcon
} from 'lucide-react';
import { createNodeBorderProgram } from '@sigma/node-border';
import EdgeCurveProgram from '@sigma/edge-curve';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import Sigma from 'sigma';
import dayjs from '@/lib/dayjs.js';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { userImage } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { configRepository, mutualGraphRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { createRateLimiter } from '@/shared/utils/throttle.js';
import { executeWithBackoff } from '@/shared/utils/retry.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger
} from '@/ui/shadcn/sheet.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover.jsx';
import { ScrollArea } from '@/ui/shadcn/scroll-area.jsx';
import GraphLayoutWorker from './graphLayoutWorker.js?worker&inline';

const LAYOUT_ITERATIONS_MIN = 300;
const LAYOUT_ITERATIONS_MAX = 1500;
const LAYOUT_SPACING_MIN = 8;
const LAYOUT_SPACING_MAX = 240;
const EDGE_CURVATURE_MIN = 0;
const EDGE_CURVATURE_MAX = 0.2;
const COMMUNITY_SEPARATION_MIN = 0;
const COMMUNITY_SEPARATION_MAX = 3;
const LAYOUT_DEFAULTS = {
    layoutIterations: 800,
    layoutSpacing: 60,
    edgeCurvature: 0.1,
    communitySeparation: 0
};
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

const EXCLUDED_FRIENDS_KEY = 'VRCX_MutualGraphExcludedFriends';
const EMPTY_USER_ID = 'usr_00000000-0000-0000-0000-000000000000';
const PICKER_RESULT_LIMIT = 120;

function readExcludedFriendIds() {
    try {
        const value = localStorage.getItem(EXCLUDED_FRIENDS_KEY);
        const parsed = value ? JSON.parse(value) : [];
        return Array.isArray(parsed) ? parsed.map(normalizeId).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function writeExcludedFriendIds(value) {
    try {
        localStorage.setItem(
            EXCLUDED_FRIENDS_KEY,
            JSON.stringify(Array.isArray(value) ? value.map(normalizeId).filter(Boolean) : [])
        );
    } catch {
        // localStorage may be unavailable; excluded friends are optional state.
    }
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isValidMutualIdentifier(value) {
    const identifier = normalizeId(value);
    return Boolean(identifier && identifier !== EMPTY_USER_ID);
}

async function fetchMutualFriendIds(friendId, { rateLimiter = null, isCancelled = () => false } = {}) {
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
                    error?.status === 429 || String(error?.message || '').includes('429')
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
        collected.push(...page.map((entry) => entry?.id).filter(isValidMutualIdentifier));

        if (page.length < 100) {
            break;
        }
        offset += page.length;
    }

    return collected;
}

function truncateLabel(value, maxLength = 18) {
    const text = String(value || '');
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function pickerOptionMatches(option, query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }
    const text = [
        option?.label,
        option?.displayLabel,
        option?.value,
        option?.search,
        option?.user?.displayName,
        option?.user?.username
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return normalizedQuery
        .split(/\s+/)
        .filter(Boolean)
        .every((token) => text.includes(token));
}

function filterPickerOptions(options, query, limit = PICKER_RESULT_LIMIT) {
    return (Array.isArray(options) ? options : [])
        .filter((option) => pickerOptionMatches(option, query))
        .slice(0, limit);
}

function buildPickerOption(userId, friendsById, fallbackName = '', degree = null) {
    const normalizedId = normalizeId(userId);
    if (!isValidMutualIdentifier(normalizedId)) {
        return null;
    }
    const user = friendsById[normalizedId] || null;
    const label = user?.displayName || user?.username || fallbackName || 'User';
    return {
        value: normalizedId,
        label,
        displayLabel: Number.isFinite(degree) ? `${label} (${degree})` : label,
        search: `${label} ${normalizedId}`,
        user,
        degree
    };
}

function UserPickerRow({ option, selected = false, multiple = false }) {
    const imageUrl = option?.user ? userImage(option.user, true, '64') : '';

    return (
        <span className="flex w-full items-center p-1.5 text-left text-[13px]">
            <span className="mr-2.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : (
                    <UserIcon className="size-4 text-muted-foreground" />
                )}
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate font-medium leading-[18px]">
                    {option?.label || option?.value}
                </span>
                {Number.isFinite(option?.degree) ? (
                    <span className="block truncate text-xs text-muted-foreground">
                        {option.degree} connections
                    </span>
                ) : null}
            </span>
            {multiple ? (
                <Checkbox
                    checked={selected}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="ml-auto"
                />
            ) : (
                <CheckIcon className={cn('ml-auto size-4', selected ? 'opacity-100' : 'opacity-0')} />
            )}
        </span>
    );
}

function GraphLoadingState() {
    return (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed bg-muted/20">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-5 animate-spin" />
                Loading mutual graph snapshot.
            </div>
        </div>
    );
}

function GraphEmptyState({ title, description }) {
    return (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-md space-y-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function createBaseGraph(snapshot, meta, friendsById, excludedFriendIds = []) {
    const nodeMap = new Map();
    const edgeMap = new Map();
    const excluded = new Set((excludedFriendIds || []).map(normalizeId).filter(Boolean));

    function ensureNode(id) {
        const normalizedId = normalizeId(id);
        if (!isValidMutualIdentifier(normalizedId) || excluded.has(normalizedId)) {
            return null;
        }
        if (!nodeMap.has(normalizedId)) {
            const friend = friendsById[normalizedId];
            const metadata = meta.get(normalizedId) || { lastFetchedAt: null, optedOut: false };
            nodeMap.set(normalizedId, {
                id: normalizedId,
                label: friend?.displayName || friend?.username || normalizedId,
                lastFetchedAt: metadata.lastFetchedAt || null,
                optedOut: Boolean(metadata.optedOut),
                degree: 0
            });
        }
        return nodeMap.get(normalizedId);
    }

    snapshot.forEach((mutualIds, friendId) => {
        const source = ensureNode(friendId);
        if (!source) {
            return;
        }
        for (const mutualId of Array.isArray(mutualIds) ? mutualIds : []) {
            const target = ensureNode(mutualId);
            if (!target || target.id === source.id) {
                continue;
            }
            edgeMap.set([source.id, target.id].sort().join('__'), {
                source: source.id,
                target: target.id
            });
        }
    });

    for (const edge of edgeMap.values()) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (source) source.degree += 1;
        if (target) target.degree += 1;
    }

    return {
        nodes: Array.from(nodeMap.values()).sort((left, right) => right.degree - left.degree),
        links: Array.from(edgeMap.values())
    };
}

function filterGraph(baseGraph, searchQuery) {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) {
        return baseGraph;
    }

    const matchedIds = new Set(
        baseGraph.nodes
            .filter(
                (node) =>
                    node.label.toLowerCase().includes(query) ||
                    node.id.toLowerCase().includes(query)
            )
            .map((node) => node.id)
    );
    if (!matchedIds.size) {
        return { nodes: [], links: [] };
    }

    const includedIds = new Set(matchedIds);
    const links = [];
    for (const link of baseGraph.links) {
        if (matchedIds.has(link.source) || matchedIds.has(link.target)) {
            includedIds.add(link.source);
            includedIds.add(link.target);
            links.push(link);
        }
    }

    return {
        nodes: baseGraph.nodes.filter((node) => includedIds.has(node.id)),
        links
    };
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
            reject(event instanceof ErrorEvent ? event.error || new Error(event.message) : new Error('Graph layout worker failed.'));
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
    const curvature = clampNumber(layoutSettings.edgeCurvature, EDGE_CURVATURE_MIN, EDGE_CURVATURE_MAX);
    const type = curvature > 0 ? 'curve' : 'line';
    graph.forEachEdge((edge) => {
        graph.mergeEdgeAttributes(edge, { curvature, type });
    });
}

function assignCommunitiesAndColors(graph) {
    const communities = louvain(graph);
    const ids = Array.from(new Set(Object.values(communities))).sort((left, right) => String(left).localeCompare(String(right)));
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
    const separation = clampNumber(layoutSettings.communitySeparation, COMMUNITY_SEPARATION_MIN, COMMUNITY_SEPARATION_MAX);
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
        communities.get(attrs.community).nodes.push({ node, x: attrs.x, y: attrs.y });
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

function destroySigmaInstance(instanceRef, resizeObserverRef) {
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
        ctx.fillText(subLine, x + paddingX, y + paddingY + lineHeight + smallFontSize / 2);
    }
}

function renderSigmaGraph({
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
            defaultDrawNodeHover: (ctx, data, settings) => drawSigmaNodeHover(ctx, data, settings, t)
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
        neighbors = node && graph.hasNode(node) ? new Set(graph.neighbors(node)) : new Set();
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

        result.color = isDarkMode ? 'rgba(148,163,184,0.04)' : 'rgba(100,116,139,0.06)';
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
            title: graph.getNodeAttribute(node, 'fullLabel') || graph.getNodeAttribute(node, 'label') || undefined
        });
        sigma.refresh();
    });
    sigma.refresh();
}

async function buildSigmaGraph({ nodes, links, layoutSettings, selectedNodeId }) {
    const graph = new Graph({
        type: 'undirected',
        multi: false,
        allowSelfLoops: false
    });
    const maxDegree = nodes.reduce((max, node) => Math.max(max, Number(node.degree) || 0), 0);

    for (const node of nodes) {
        const degree = Number(node.degree) || 0;
        const isSelected = node.id === selectedNodeId;
        graph.addNode(node.id, {
            label: truncateLabel(node.label, 20),
            fullLabel: node.label,
            size: (4 + (maxDegree ? (degree / maxDegree) * 18 : 0)) * (isSelected ? 1.35 : 1),
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
            console.warn('[MutualFriendsPage] Graph layout worker failed, using fallback layout.', error);
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

export function MutualFriendsPage() {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore((state) => state.orderedFriendIds);
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const confirm = useModalStore((state) => state.confirm);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);

    const [status, setStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [snapshotData, setSnapshotData] = useState({ snapshot: new Map(), meta: new Map() });
    const [layoutSettings, setLayoutSettings] = useState(LAYOUT_DEFAULTS);
    const searchQuery = '';
    const [nodePickerOpen, setNodePickerOpen] = useState(false);
    const [nodeSearchQuery, setNodeSearchQuery] = useState('');
    const [excludeSearchQuery, setExcludeSearchQuery] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const [excludedFriendIds, setExcludedFriendIds] = useState(readExcludedFriendIds);
    const [fetchProgress, setFetchProgress] = useState({
        isFetching: false,
        processedFriends: 0,
        totalFriends: 0,
        cancelRequested: false
    });
    const [nodeRefreshId, setNodeRefreshId] = useState('');
    const [reloadToken, setReloadToken] = useState(0);

    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const selectedNodeIdRef = useRef('');
    const fetchCancelRef = useRef(false);
    const currentUserIdRef = useRef(currentUserId);

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
        fetchCancelRef.current = true;
    }, [currentUserId]);

    const setGraphElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            destroySigmaInstance(chartInstanceRef, resizeObserverRef);
        }
        chartElementRef.current = node;
    }, []);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getInt('MutualGraphLayoutIterations', LAYOUT_DEFAULTS.layoutIterations),
            configRepository.getInt('MutualGraphLayoutSpacing', LAYOUT_DEFAULTS.layoutSpacing),
            configRepository.getFloat('MutualGraphEdgeCurvature', LAYOUT_DEFAULTS.edgeCurvature),
            configRepository.getFloat('MutualGraphCommunitySeparation', LAYOUT_DEFAULTS.communitySeparation)
        ])
            .then(([iterations, spacing, curvature, separation]) => {
                if (!active) {
                    return;
                }

                setLayoutSettings({
                    layoutIterations: clampNumber(iterations, LAYOUT_ITERATIONS_MIN, LAYOUT_ITERATIONS_MAX, LAYOUT_DEFAULTS.layoutIterations),
                    layoutSpacing: clampNumber(spacing, LAYOUT_SPACING_MIN, LAYOUT_SPACING_MAX, LAYOUT_DEFAULTS.layoutSpacing),
                    edgeCurvature: clampNumber(curvature, EDGE_CURVATURE_MIN, EDGE_CURVATURE_MAX, LAYOUT_DEFAULTS.edgeCurvature),
                    communitySeparation: clampNumber(separation, COMMUNITY_SEPARATION_MIN, COMMUNITY_SEPARATION_MAX, LAYOUT_DEFAULTS.communitySeparation)
                });
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setStatus('idle');
            setSnapshotData({ snapshot: new Map(), meta: new Map() });
            return () => {
                active = false;
            };
        }

        setStatus('running');
        setDetail('');

        mutualGraphRepository
            .getSnapshot(currentUserId)
            .then((result) => {
                if (!active) {
                    return;
                }

                setSnapshotData(result);
                setStatus('ready');
                setDetail('Reading the cached mutual-friends graph from the local database.');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setStatus('error');
                setSnapshotData({ snapshot: new Map(), meta: new Map() });
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the mutual-friends graph cache.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentUserId, reloadToken]);

    useEffect(() => {
        writeExcludedFriendIds(excludedFriendIds);
    }, [excludedFriendIds]);

    useEffect(() => {
        return () => {
            destroySigmaInstance(chartInstanceRef, resizeObserverRef);
        };
    }, []);

    const baseGraph = useMemo(
        () => createBaseGraph(snapshotData.snapshot, snapshotData.meta, friendsById, excludedFriendIds),
        [excludedFriendIds, friendsById, snapshotData.meta, snapshotData.snapshot]
    );

    const filteredGraph = useMemo(
        () => filterGraph(baseGraph, searchQuery),
        [baseGraph, searchQuery]
    );

    const nodeOptions = useMemo(
        () =>
            baseGraph.nodes
                .slice()
                .sort((left, right) => left.label.localeCompare(right.label))
                .map((node) =>
                    buildPickerOption(node.id, friendsById, node.label, node.degree)
                )
                .filter(Boolean),
        [baseGraph.nodes, friendsById]
    );

    const excludePickerOptions = useMemo(() => {
        const seen = new Set();
        const items = [];

        function pushOption(userId, fallbackName = '') {
            const normalizedId = normalizeId(userId);
            if (
                !isValidMutualIdentifier(normalizedId) ||
                normalizedId === currentUserId ||
                seen.has(normalizedId)
            ) {
                return;
            }
            const option = buildPickerOption(normalizedId, friendsById, fallbackName);
            if (option) {
                seen.add(normalizedId);
                items.push(option);
            }
        }

        snapshotData.snapshot.forEach((mutualIds, friendId) => {
            pushOption(friendId);
            for (const mutualId of Array.isArray(mutualIds) ? mutualIds : []) {
                pushOption(mutualId);
            }
        });

        return items.sort((left, right) => left.label.localeCompare(right.label));
    }, [currentUserId, friendsById, snapshotData.snapshot]
    );

    const filteredNodeOptions = useMemo(
        () => filterPickerOptions(nodeOptions, nodeSearchQuery),
        [nodeOptions, nodeSearchQuery]
    );

    const excludedFriendIdSet = useMemo(
        () => new Set(excludedFriendIds.map(normalizeId).filter(Boolean)),
        [excludedFriendIds]
    );

    const filteredExcludeOptions = useMemo(
        () => filterPickerOptions(excludePickerOptions, excludeSearchQuery),
        [excludePickerOptions, excludeSearchQuery]
    );

    const selectedNode = useMemo(
        () => baseGraph.nodes.find((node) => node.id === selectedNodeId) || null,
        [baseGraph.nodes, selectedNodeId]
    );

    useEffect(() => {
        if (!filteredGraph.nodes.length) {
            selectedNodeIdRef.current = '';
            setSelectedNodeId('');
            return;
        }

        if (filteredGraph.nodes.some((node) => node.id === selectedNodeIdRef.current)) {
            return;
        }

        const nextSelectedNodeId = filteredGraph.nodes[0].id;
        selectedNodeIdRef.current = nextSelectedNodeId;
        setSelectedNodeId(nextSelectedNodeId);
    }, [filteredGraph.nodes]);

    useEffect(() => {
        if (!filteredGraph.nodes.length) {
            destroySigmaInstance(chartInstanceRef, resizeObserverRef);
            return undefined;
        }

        const container = chartElementRef.current;
        if (!container) {
            return undefined;
        }

        let active = true;
        const isDarkMode = resolvedTheme === 'dark' || resolvedTheme === 'midnight';
        void buildSigmaGraph({
            nodes: filteredGraph.nodes,
            links: filteredGraph.links,
            layoutSettings,
            selectedNodeId: selectedNodeIdRef.current
        })
            .then((graph) => {
                if (!active || chartElementRef.current !== container) {
                    return;
                }

                renderSigmaGraph({
                    graph,
                    container,
                    instanceRef: chartInstanceRef,
                    resizeObserverRef,
                    isDarkMode,
                    selectedNodeIdRef,
                    onSelectNode: setSelectedNodeId,
                    t
                });
            })
            .catch((error) => {
                if (active) {
                    console.warn('[MutualFriendsPage] Failed to render mutual graph.', error);
                }
            });

        return () => {
            active = false;
        };
    }, [filteredGraph.links, filteredGraph.nodes, layoutSettings, resolvedTheme, t]);

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
        chartInstanceRef.current?.refresh?.();
    }, [selectedNodeId]);

    const edgeCount = filteredGraph.links.length;
    const nodeCount = filteredGraph.nodes.length;
    const excludedCount = excludedFriendIds.length;
    const progressPercent = fetchProgress.totalFriends
        ? Math.min(100, Math.round((fetchProgress.processedFriends / fetchProgress.totalFriends) * 100))
        : 0;

    async function reloadSnapshot(nextDetail, expectedUserId = currentUserId) {
        if (!expectedUserId || currentUserIdRef.current !== expectedUserId) {
            return;
        }

        setStatus('running');
        try {
            const result = await mutualGraphRepository.getSnapshot(expectedUserId);
            if (currentUserIdRef.current !== expectedUserId) {
                return;
            }
            setSnapshotData(result);
            setStatus('ready');
            setDetail(nextDetail || 'Reading the cached mutual-friends graph from the local database.');
        } catch (error) {
            setSnapshotData({ snapshot: new Map(), meta: new Map() });
            setStatus('error');
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to load the mutual-friends graph cache.'
            );
        }
    }

    async function handleFetchGraph() {
        if (!currentUserId || fetchProgress.isFetching) {
            return;
        }
        const ownerUserId = currentUserId;

        const friendSnapshot = orderedFriendIds
            .map((friendId) => friendsById[friendId])
            .filter((friend) => friend?.id);
        if (!friendSnapshot.length) {
            toast.info('No friends are available for mutual graph fetching.');
            return;
        }

        fetchCancelRef.current = false;
        setFetchProgress({
            isFetching: true,
            processedFriends: 0,
            totalFriends: friendSnapshot.length,
            cancelRequested: false
        });
        setDetail('Fetching mutual friends from VRChat.');

        const rateLimiter = createRateLimiter({
            limitPerInterval: 5,
            intervalMs: 1000
        });
        const entries = new Map();
        const metaEntries = new Map();
        let cancelled = false;

        try {
            for (let index = 0; index < friendSnapshot.length; index += 1) {
                const friend = friendSnapshot[index];
                if (!friend?.id) {
                    continue;
                }

                if (fetchCancelRef.current) {
                    cancelled = true;
                    break;
                }

                try {
                    const mutualIds = await fetchMutualFriendIds(friend.id, {
                        rateLimiter,
                        isCancelled: () => fetchCancelRef.current
                    });
                    if (fetchCancelRef.current) {
                        cancelled = true;
                        break;
                    }
                    entries.set(friend.id, mutualIds);
                    metaEntries.set(friend.id, {
                        optedOut: false
                    });
                } catch (error) {
                    if (fetchCancelRef.current || String(error?.message || '') === 'cancelled') {
                        cancelled = true;
                        break;
                    }
                    if (error?.status === 403 || error?.status === 404) {
                        metaEntries.set(friend.id, {
                            optedOut: true
                        });
                    } else {
                        console.warn('[MutualFriendsPage] Skipping mutual graph friend fetch', friend.id, error);
                    }
                }

                setFetchProgress({
                    isFetching: true,
                    processedFriends: index + 1,
                    totalFriends: friendSnapshot.length,
                    cancelRequested: false
                });
            }

            if (cancelled) {
                toast.warning('Mutual graph fetch cancelled. The cached graph was not replaced.');
                return;
            }

            if (currentUserIdRef.current !== ownerUserId) {
                return;
            }
            await mutualGraphRepository.bulkUpsertMeta(ownerUserId, metaEntries);
            await mutualGraphRepository.saveSnapshot(ownerUserId, entries);
            await reloadSnapshot('Fetched and cached the mutual-friends graph.', ownerUserId);
            toast.success('Mutual-friends graph refreshed.');
        } catch (error) {
            setStatus('error');
            setDetail(error instanceof Error ? error.message : 'Failed to fetch mutual-friends graph.');
            toast.error(error instanceof Error ? error.message : 'Failed to fetch mutual-friends graph.');
        } finally {
            fetchCancelRef.current = false;
            setFetchProgress((current) => ({
                ...current,
                isFetching: false,
                cancelRequested: false
            }));
        }
    }

    function handleCancelFetch() {
        fetchCancelRef.current = true;
        setFetchProgress((current) => ({
            ...current,
            cancelRequested: true
        }));
    }

    function handleOpenSelectedNode() {
        if (!selectedNode?.id) {
            return;
        }

        openUserDialog({
            userId: selectedNode.id,
            title: selectedNode.label
        });
    }

    function handleHideSelectedNode() {
        if (!selectedNode?.id) {
            return;
        }

        setExcludedFriendIds((current) =>
            current.includes(selectedNode.id) ? current : [...current, selectedNode.id]
        );
    }

    function selectNode(friendId) {
        const nextValue = normalizeId(friendId);
        selectedNodeIdRef.current = nextValue;
        setSelectedNodeId(nextValue);
        const sigma = chartInstanceRef.current;
        sigma?.refresh?.();
        if (!nextValue || !sigma?.getNodeDisplayData?.(nextValue)) {
            return;
        }
        const displayData = sigma.getNodeDisplayData(nextValue);
        sigma.getCamera?.()?.animate?.(
            {
                x: displayData.x,
                y: displayData.y,
                ratio: 0.15
            },
            { duration: 300 }
        );
    }

    function toggleExcludedFriendId(friendId) {
        const normalizedId = normalizeId(friendId);
        if (!normalizedId) {
            return;
        }
        setExcludedFriendIds((current) => {
            const normalizedCurrent = current.map(normalizeId).filter(Boolean);
            if (normalizedCurrent.includes(normalizedId)) {
                return normalizedCurrent.filter((id) => id !== normalizedId);
            }
            return [...normalizedCurrent, normalizedId];
        });
    }

    async function handleRefreshSelectedNode() {
        if (!currentUserId || !selectedNode?.id || nodeRefreshId) {
            return;
        }
        const ownerUserId = currentUserId;

        const isFriend = Boolean(friendsById[selectedNode.id]);
        if (!isFriend) {
            const result = await confirm({
                title: 'Refresh non-friend mutuals',
                description:
                    'This node is not currently in the friend roster. Continue refreshing its mutual-friends cache?',
                confirmText: 'Refresh',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return;
            }
        }

        setNodeRefreshId(selectedNode.id);
        try {
            const mutualIds = await fetchMutualFriendIds(selectedNode.id);
            if (currentUserIdRef.current !== ownerUserId) {
                return;
            }
            await mutualGraphRepository.updateMutualsForFriend(ownerUserId, selectedNode.id, mutualIds);
            await mutualGraphRepository.upsertMeta(ownerUserId, selectedNode.id, {
                optedOut: false
            });
            await reloadSnapshot(`Refreshed mutuals for ${selectedNode.label}.`, ownerUserId);
            toast.success(`Refreshed mutuals for ${selectedNode.label}.`);
        } catch (error) {
            if (error?.status === 403 || error?.status === 404) {
                if (currentUserIdRef.current !== ownerUserId) {
                    return;
                }
                await mutualGraphRepository.upsertMeta(ownerUserId, selectedNode.id, {
                    optedOut: true
                });
                await reloadSnapshot(`${selectedNode.label} has opted out of shared connections.`, ownerUserId);
                toast.warning(`${selectedNode.label} has opted out of shared connections.`);
                return;
            }

            toast.error(error instanceof Error ? error.message : 'Failed to refresh selected mutuals.');
        } finally {
            setNodeRefreshId('');
        }
    }

    function handleResetLayoutAndHidden() {
        setLayoutSettings(LAYOUT_DEFAULTS);
        setExcludedFriendIds([]);
        void configRepository.setInt('MutualGraphLayoutIterations', LAYOUT_DEFAULTS.layoutIterations);
        void configRepository.setInt('MutualGraphLayoutSpacing', LAYOUT_DEFAULTS.layoutSpacing);
        void configRepository.setFloat('MutualGraphEdgeCurvature', LAYOUT_DEFAULTS.edgeCurvature);
        void configRepository.setFloat('MutualGraphCommunitySeparation', LAYOUT_DEFAULTS.communitySeparation);
    }

    return (
        <div id="chart" className="x-container flex h-full min-h-0 flex-col overflow-y-auto p-6">
            <div className="mt-0 flex min-h-0 flex-1 flex-col items-center pt-12">
                <div className="flex w-full items-center gap-3">
                    <div className="options-container flex items-center gap-3 bg-transparent pb-3 shadow-none">
                        {fetchProgress.isFetching ? (
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={fetchProgress.cancelRequested}
                                onClick={handleCancelFetch}>
                                {fetchProgress.cancelRequested ? 'Cancelling...' : 'Stop fetching'}
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                disabled={!currentUserId || !orderedFriendIds.length}
                                onClick={handleFetchGraph}>
                                {baseGraph.nodes.length ? 'Fetch again' : 'Start fetch'}
                            </Button>
                        )}
                        {baseGraph.nodes.length ? (
                            <Popover open={nodePickerOpen} onOpenChange={setNodePickerOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="min-w-60 justify-start px-3 font-normal">
                                        <span className="truncate">
                                            {selectedNode
                                                ? `${selectedNode.label} (${selectedNode.degree})`
                                                : t('view.charts.mutual_friend.actions.go_to_friend')}
                                        </span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-80 p-2">
                                    <Input
                                        autoFocus
                                        value={nodeSearchQuery}
                                        onChange={(event) => setNodeSearchQuery(event.target.value)}
                                        placeholder={t('view.charts.mutual_friend.actions.go_to_friend')}
                                    />
                                    <ScrollArea className="mt-2 h-72">
                                        <div className="space-y-1 pr-2">
                                            <button
                                                type="button"
                                                className="flex w-full items-center rounded-md p-1.5 text-left text-[13px] hover:bg-muted"
                                                onClick={() => {
                                                    selectNode('');
                                                    setNodePickerOpen(false);
                                                }}>
                                                <span className="min-w-0 flex-1 truncate">No selection</span>
                                                <CheckIcon
                                                    className={cn(
                                                        'ml-auto size-4',
                                                        selectedNodeId ? 'opacity-0' : 'opacity-100'
                                                    )}
                                                />
                                            </button>
                                            {filteredNodeOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className="w-full rounded-md hover:bg-muted"
                                                    onClick={() => {
                                                        selectNode(option.value);
                                                        setNodePickerOpen(false);
                                                        setNodeSearchQuery('');
                                                    }}>
                                                    <UserPickerRow
                                                        option={option}
                                                        selected={option.value === selectedNodeId}
                                                    />
                                                </button>
                                            ))}
                                            {!filteredNodeOptions.length ? (
                                                <div className="p-3 text-xs text-muted-foreground">
                                                    No friends match this search.
                                                </div>
                                            ) : null}
                                        </div>
                                    </ScrollArea>
                                </PopoverContent>
                            </Popover>
                        ) : null}
                    </div>

                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        {selectedNode ? (
                            <>
                                <Button type="button" variant="outline" size="sm" onClick={handleOpenSelectedNode}>
                                    <UserIcon className="mr-2 size-4" />
                                    Open
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={nodeRefreshId === selectedNode.id}
                                    onClick={handleRefreshSelectedNode}>
                                    <RefreshCcwIcon className="mr-2 size-4" />
                                    {nodeRefreshId === selectedNode.id ? 'Refreshing...' : 'Refresh'}
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={handleHideSelectedNode}>
                                    <EyeOffIcon className="mr-2 size-4" />
                                    Hide
                                </Button>
                            </>
                        ) : null}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setReloadToken((value) => value + 1)}
                            disabled={fetchProgress.isFetching}>
                            <RefreshCcwIcon className="size-4" />
                        </Button>
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button type="button" variant="ghost" size="icon">
                                    <Settings2Icon className="size-4" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-90 overflow-y-auto">
                                <SheetHeader>
                                    <SheetTitle>{t('view.charts.mutual_friend.settings.title')}</SheetTitle>
                                </SheetHeader>
                                <div className="grid gap-5 p-4 pt-0 text-sm">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span>{t('view.charts.mutual_friend.settings.layout_iterations')}</span>
                                            <span className="tabular-nums text-muted-foreground">{layoutSettings.layoutIterations}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={LAYOUT_ITERATIONS_MIN}
                                            max={LAYOUT_ITERATIONS_MAX}
                                            step="100"
                                            value={layoutSettings.layoutIterations}
                                            onChange={(event) => {
                                                const nextValue = clampNumber(event.target.value, LAYOUT_ITERATIONS_MIN, LAYOUT_ITERATIONS_MAX, LAYOUT_DEFAULTS.layoutIterations);
                                                setLayoutSettings((current) => ({ ...current, layoutIterations: nextValue }));
                                                void configRepository.setInt('MutualGraphLayoutIterations', nextValue);
                                            }}
                                            className="w-full accent-primary"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span>{t('view.charts.mutual_friend.settings.layout_spacing')}</span>
                                            <span className="tabular-nums text-muted-foreground">{layoutSettings.layoutSpacing}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={LAYOUT_SPACING_MIN}
                                            max={LAYOUT_SPACING_MAX}
                                            step="1"
                                            value={layoutSettings.layoutSpacing}
                                            onChange={(event) => {
                                                const nextValue = clampNumber(event.target.value, LAYOUT_SPACING_MIN, LAYOUT_SPACING_MAX, LAYOUT_DEFAULTS.layoutSpacing);
                                                setLayoutSettings((current) => ({ ...current, layoutSpacing: nextValue }));
                                                void configRepository.setInt('MutualGraphLayoutSpacing', nextValue);
                                            }}
                                            className="w-full accent-primary"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span>{t('view.charts.mutual_friend.settings.edge_curvature')}</span>
                                            <span className="tabular-nums text-muted-foreground">{layoutSettings.edgeCurvature.toFixed(2)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="0.2"
                                            step="0.01"
                                            value={layoutSettings.edgeCurvature}
                                            onChange={(event) => {
                                                const nextValue = clampNumber(event.target.value, 0, 0.2, LAYOUT_DEFAULTS.edgeCurvature);
                                                const rounded = Number(nextValue.toFixed(2));
                                                setLayoutSettings((current) => ({ ...current, edgeCurvature: rounded }));
                                                void configRepository.setFloat('MutualGraphEdgeCurvature', rounded);
                                            }}
                                            className="w-full accent-primary"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span>{t('view.charts.mutual_friend.settings.community_separation')}</span>
                                            <span className="tabular-nums text-muted-foreground">{layoutSettings.communitySeparation.toFixed(1)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="3"
                                            step="0.1"
                                            value={layoutSettings.communitySeparation}
                                            onChange={(event) => {
                                                const nextValue = clampNumber(event.target.value, 0, 3, LAYOUT_DEFAULTS.communitySeparation);
                                                const rounded = Number(nextValue.toFixed(1));
                                                setLayoutSettings((current) => ({ ...current, communitySeparation: rounded }));
                                                void configRepository.setFloat('MutualGraphCommunitySeparation', rounded);
                                            }}
                                            className="w-full accent-primary"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span>{t('view.charts.mutual_friend.settings.exclude_friends')}</span>
                                            <span className="tabular-nums text-muted-foreground">
                                                {excludedCount}
                                            </span>
                                        </div>
                                        <Input
                                            value={excludeSearchQuery}
                                            onChange={(event) => setExcludeSearchQuery(event.target.value)}
                                            placeholder={t('view.charts.mutual_friend.settings.exclude_friends_placeholder')}
                                        />
                                        <ScrollArea className="h-72 rounded-md border">
                                            <div className="space-y-1 p-1 pr-2">
                                                {filteredExcludeOptions.map((option) => {
                                                    const selected = excludedFriendIdSet.has(option.value);
                                                    return (
                                                        <div
                                                            key={option.value}
                                                            role="checkbox"
                                                            aria-checked={selected}
                                                            tabIndex={0}
                                                            className="cursor-pointer rounded-md hover:bg-muted"
                                                            onClick={() => toggleExcludedFriendId(option.value)}
                                                            onKeyDown={(event) => {
                                                                if (event.key !== 'Enter' && event.key !== ' ') {
                                                                    return;
                                                                }
                                                                event.preventDefault();
                                                                toggleExcludedFriendId(option.value);
                                                            }}>
                                                            <UserPickerRow
                                                                option={option}
                                                                selected={selected}
                                                                multiple
                                                            />
                                                        </div>
                                                    );
                                                })}
                                                {!filteredExcludeOptions.length ? (
                                                    <div className="p-3 text-xs text-muted-foreground">
                                                        No friends match this search.
                                                    </div>
                                                ) : null}
                                            </div>
                                        </ScrollArea>
                                        <p className="text-xs text-muted-foreground">
                                            {t('view.charts.mutual_friend.settings.exclude_friends_help')}
                                        </p>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Hidden nodes: {excludedCount}. Visible nodes: {nodeCount}. Visible links: {edgeCount}.
                                    </div>
                                    <Button type="button" variant="outline" size="sm" onClick={handleResetLayoutAndHidden}>
                                        {t('view.charts.mutual_friend.settings.reset_defaults')}
                                    </Button>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>

                {fetchProgress.isFetching ? (
                    <div className="grid w-70 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-center rounded-md bg-transparent p-3">
                        <div className="mb-1 flex justify-between text-sm">
                            <span>{Math.round(progressPercent)}%</span>
                            <strong>
                                {fetchProgress.processedFriends} / {fetchProgress.totalFriends}
                            </strong>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary transition-[width]" style={{ width: `${progressPercent}%` }} />
                        </div>
                    </div>
                ) : null}

                <div className="mt-3 w-full flex-1">
                    {status === 'running' ? (
                            <GraphLoadingState />
                        ) : status === 'error' ? (
                            <GraphEmptyState
                                title="Mutual graph failed to load"
                                description={detail || 'The graph adapter could not read the cached mutual-friends tables.'}
                            />
                        ) : !baseGraph.nodes.length ? (
                            <GraphEmptyState
                                title="No cached mutual graph yet"
                                description="The local mutual-friends snapshot is empty. Use Start fetch to build the graph cache."
                            />
                        ) : !filteredGraph.nodes.length ? (
                            <GraphEmptyState
                                title="No graph nodes match the current search"
                                description="Try a broader search term or clear the node filter."
                            />
                    ) : (
                        <div
                            ref={setGraphElementRef}
                            className={cn('h-[calc(100vh-260px)] min-h-[520px] w-full flex-1 rounded-lg bg-transparent', resolvedTheme === 'midnight' ? 'border-primary/20' : '')}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
