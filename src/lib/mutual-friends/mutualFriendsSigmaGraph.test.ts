// @vitest-environment jsdom

import type Sigma from 'sigma';
import {
    DEFAULT_STYLES,
    evaluateEdgeStyle,
    evaluateNodeStyle
} from 'sigma/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MutualFriendsSigmaGraph } from './mutualFriendsSigmaGraph';

type NodeAttributes = ReturnType<MutualFriendsSigmaGraph['getNodeAttributes']>;
type EdgeAttributes = ReturnType<MutualFriendsSigmaGraph['getEdgeAttributes']>;
type SigmaOptions = NonNullable<
    ConstructorParameters<typeof Sigma<NodeAttributes, EdgeAttributes>>[2]
>;

type SigmaNodeEvent = {
    node: string;
    event?: { original: { detail: number } };
    preventSigmaDefault?: () => void;
};

const sigmaMock = vi.hoisted(() => {
    const webglConstants = {
        FLOAT: 5126,
        UNSIGNED_BYTE: 5121,
        UNSIGNED_INT: 5125,
        TRIANGLES: 4
    };
    vi.stubGlobal('WebGL2RenderingContext', webglConstants);
    vi.stubGlobal('WebGLRenderingContext', webglConstants);
    return {
        webglConstants,
        handlers: new Map<string, (event: SigmaNodeEvent) => void>(),
        options: [] as SigmaOptions[],
        kill: vi.fn(),
        killLayer: vi.fn()
    };
});

vi.mock('sigma', async (importOriginal) => ({
    ...(await importOriginal<typeof import('sigma')>()),
    default: class {
        constructor(
            private graph: MutualFriendsSigmaGraph,
            _container: HTMLElement,
            private options: SigmaOptions
        ) {
            sigmaMock.options.push(options);
        }
        refresh() {}
        resize() {}
        kill = sigmaMock.kill;
        killLayer = sigmaMock.killLayer;
        createCanvas() {
            return document.createElement('canvas');
        }
        getDimensions() {
            return { width: 400, height: 300 };
        }
        framedGraphToViewport(data: { x: number; y: number }) {
            return { x: data.x * 400, y: data.y * 300 };
        }
        scaleSize(size: number) {
            return size;
        }
        getNodeDisplayData(node: string) {
            return {
                ...projectNode(this.graph, this.options, node),
                x: 0.25,
                y: 0.4
            };
        }
        removeAllListeners() {
            sigmaMock.handlers.clear();
        }
        on(name: string, handler: (event: SigmaNodeEvent) => void) {
            sigmaMock.handlers.set(name, handler);
        }
        removeListener(name: string) {
            sigmaMock.handlers.delete(name);
        }
    }
}));
vi.mock('./mutualFriendsSigmaHoverCard', () => ({
    drawMutualFriendHoverCard: vi.fn()
}));
vi.mock('./graphLayoutWorkerClient', () => ({
    runGraphLayoutWorker: vi.fn(async () => ({}))
}));

import { buildMutualFriendsGraphTheme } from './mutualFriendsPalette';
import { MUTUAL_GRAPH_LAYOUT_DEFAULTS } from './mutualFriendsSettings';
import {
    applyMutualFriendsEdgeCurvature,
    buildSigmaGraph,
    renderSigmaGraph
} from './mutualFriendsSigmaGraph';
import { drawMutualFriendHoverCard } from './mutualFriendsSigmaHoverCard';
import type { MutualFriendGraph } from './mutualFriendsTypes';

function node(id: string) {
    return {
        id,
        label: id,
        lastFetchedAt: '2026-09-01T00:00:00.000Z',
        optedOut: false,
        degree: 1,
        mutualCount: 1
    };
}

const GRAPH: MutualFriendGraph = {
    nodes: [node('usr_target'), node('usr_a'), node('usr_b')],
    links: [
        { source: 'usr_target', target: 'usr_a' },
        { source: 'usr_target', target: 'usr_b' },
        { source: 'usr_a', target: 'usr_b' }
    ]
};

function build(forceLabels?: boolean) {
    return buildSigmaGraph({
        graph: GRAPH,
        layoutSettings: MUTUAL_GRAPH_LAYOUT_DEFAULTS,
        communityIndexById: new Map([
            ['usr_a', 0],
            ['usr_b', 1]
        ]),
        namedCommunityIndexes: new Set([0, 1]),
        theme: buildMutualFriendsGraphTheme(true),
        forceLabels
    });
}

beforeEach(() => {
    sigmaMock.options.length = 0;
    sigmaMock.kill.mockClear();
    sigmaMock.killLayer.mockClear();
    vi.mocked(drawMutualFriendHoverCard).mockClear();
    vi.stubGlobal('WebGL2RenderingContext', sigmaMock.webglConstants);
    vi.stubGlobal('WebGLRenderingContext', sigmaMock.webglConstants);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        }
    );
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function projectNode(
    graph: MutualFriendsSigmaGraph,
    options: SigmaOptions,
    node: string
) {
    const attributes = graph.getNodeAttributes(node);
    const state = {
        isHovered: false,
        isLabelHovered: false,
        isHidden: false,
        isHighlighted: false,
        isDragged: false
    };
    const graphState = {
        isIdle: true,
        isPanning: false,
        isZooming: false,
        isDragging: false,
        hasHovered: false,
        hasHighlighted: false
    };
    const data = evaluateNodeStyle(
        DEFAULT_STYLES.nodes,
        attributes,
        state,
        graphState,
        graph
    );
    return {
        ...data,
        ...options.nodeReducer?.(
            node,
            data,
            attributes,
            state,
            graphState,
            graph
        )
    };
}

describe('buildSigmaGraph', () => {
    it('keeps a node outside every circle neutral and its edges out of the cross-circle highlight', async () => {
        const graph = await build();

        expect(graph.getNodeAttribute('usr_target', 'communityNamed')).toBe(
            false
        );
        expect(
            graph.getEdgeAttribute('usr_a__usr_target', 'crossCommunity')
        ).toBe(false);
        expect(graph.getEdgeAttribute('usr_a__usr_b', 'crossCommunity')).toBe(
            true
        );
    });

    it('shows every name only when asked to', async () => {
        const forced = await build(true);
        const regular = await build();

        expect(
            forced.everyNode((id) => forced.getNodeAttribute(id, 'forceLabel'))
        ).toBe(true);
        expect(
            regular.someNode((id) => regular.getNodeAttribute(id, 'forceLabel'))
        ).toBe(false);
    });

    it('maps the curvature setting to the built-in v4 path names', async () => {
        const graph = await build();
        applyMutualFriendsEdgeCurvature(graph, {
            ...MUTUAL_GRAPH_LAYOUT_DEFAULTS,
            edgeCurvature: 0.1
        });
        expect(graph.getEdgeAttributes('usr_a__usr_b')).toMatchObject({
            type: 'curved',
            curvature: 0.1
        });
        applyMutualFriendsEdgeCurvature(graph, {
            ...MUTUAL_GRAPH_LAYOUT_DEFAULTS,
            edgeCurvature: 0
        });
        expect(graph.getEdgeAttributes('usr_a__usr_b')).toMatchObject({
            type: 'straight',
            curvature: 0
        });
    });

    async function renderGraph(
        callbacks: Pick<
            Parameters<typeof renderSigmaGraph>[0],
            'onSelectNode' | 'onOpenNode'
        >
    ) {
        const container = document.createElement('div');
        renderSigmaGraph({
            graph: await build(),
            container,
            instanceRef: { current: null },
            resizeObserverRef: { current: null },
            themeRef: { current: buildMutualFriendsGraphTheme(true) },
            selectedNodeIdRef: { current: '' },
            crossCommunityOnlyRef: { current: false },
            hoverCardStringsRef: {
                current: { connections: '', lastFetched: '', unavailable: '' }
            },
            ...callbacks
        });
        return container;
    }

    function emit(name: string, event: SigmaNodeEvent) {
        sigmaMock.handlers.get(name)?.(event);
    }

    it('shows a pointer over nodes so they read as clickable', async () => {
        const container = await renderGraph({ onSelectNode: vi.fn() });

        emit('enterNode', { node: 'usr_a' });
        expect(container.style.cursor).toBe('pointer');
        emit('leaveNode', { node: 'usr_a' });
        expect(container.style.cursor).toBe('');
    });

    it('uses v4 primitives and keeps screen sizes and existing camera interactions', async () => {
        await renderGraph({ onSelectNode: vi.fn() });
        const options = sigmaMock.options[0];
        expect(options.settings).toMatchObject({
            itemSizesReference: 'screen',
            enableNodeDrag: false,
            enableCameraMouseRotation: false,
            labelRenderedSizeThreshold: 10,
            labelDensity: 0.7,
            labelGridCellSize: 140
        });
        expect(options.primitives?.nodes?.layers?.[0]).toMatchObject({
            name: 'border'
        });
        expect(
            options.primitives?.edges?.paths?.map((path) => path.name)
        ).toEqual(['straight', 'curved']);
    });

    it('preserves hollow nodes, forced labels, hover highlights and theme updates', async () => {
        const graph = await build(true);
        const themeRef = { current: buildMutualFriendsGraphTheme(true) };
        graph.mergeNodeAttributes('usr_a', {
            type: 'hollow',
            holeColor: themeRef.current.backgroundColor
        });
        const controller = renderSigmaGraph({
            graph,
            container: document.createElement('div'),
            instanceRef: { current: null },
            resizeObserverRef: { current: null },
            themeRef,
            selectedNodeIdRef: { current: '' },
            crossCommunityOnlyRef: { current: false },
            onSelectNode: vi.fn(),
            hoverCardStringsRef: {
                current: { connections: '', lastFetched: '', unavailable: '' }
            }
        });
        const options = sigmaMock.options[0];
        const hollowNode = projectNode(graph, options, 'usr_a');
        expect(hollowNode).toMatchObject({
            borderSize: 0.34,
            borderColor: hollowNode.color,
            fillColor: themeRef.current.backgroundColor,
            labelVisibility: 'visible'
        });
        emit('enterNode', { node: 'usr_a' });
        expect(projectNode(graph, options, 'usr_a')).toMatchObject({
            size: graph.getNodeAttribute('usr_a', 'baseSize') * 1.55,
            zIndex: 4
        });
        emit('leaveNode', { node: 'usr_a' });
        controller.applySelection('usr_b');
        expect(projectNode(graph, options, 'usr_b')).toMatchObject({
            size: graph.getNodeAttribute('usr_b', 'baseSize') * 1.35,
            zIndex: 3,
            labelVisibility: 'visible'
        });
        themeRef.current = buildMutualFriendsGraphTheme(false);
        controller.applyTheme();
        expect(projectNode(graph, options, 'usr_b').labelColor).toBe(
            themeRef.current.labelColor
        );
        controller.dispose();
        expect(sigmaMock.handlers.has('afterRender')).toBe(false);
        expect(sigmaMock.killLayer).toHaveBeenCalledWith('mutual-friend-hover');
    });

    it('keeps edge widths and curves while highlighting cross-circle connections', async () => {
        const graph = await build();
        applyMutualFriendsEdgeCurvature(graph, {
            ...MUTUAL_GRAPH_LAYOUT_DEFAULTS,
            edgeCurvature: 0.1
        });
        const theme = buildMutualFriendsGraphTheme(true);
        renderSigmaGraph({
            graph,
            container: document.createElement('div'),
            instanceRef: { current: null },
            resizeObserverRef: { current: null },
            themeRef: { current: theme },
            selectedNodeIdRef: { current: '' },
            crossCommunityOnlyRef: { current: false },
            onSelectNode: vi.fn(),
            hoverCardStringsRef: {
                current: { connections: '', lastFetched: '', unavailable: '' }
            }
        });
        const options = sigmaMock.options[0];
        const attributes = graph.getEdgeAttributes('usr_a__usr_b');
        const state = {
            isHovered: false,
            isLabelHovered: false,
            isHidden: false,
            isHighlighted: false,
            parallelIndex: 0,
            parallelCount: 1
        };
        const graphState = {
            isIdle: true,
            isPanning: false,
            isZooming: false,
            isDragging: false,
            hasHovered: false,
            hasHighlighted: false
        };
        const data = evaluateEdgeStyle(
            options.styles?.edges,
            attributes,
            state,
            graphState,
            graph
        );
        expect(
            options.edgeReducer?.(
                'usr_a__usr_b',
                data,
                attributes,
                state,
                graphState,
                graph
            )
        ).toMatchObject({
            size: 0.75,
            path: 'curved',
            color: theme.edgeCrossColor,
            zIndex: 1
        });
        emit('enterNode', { node: 'usr_a' });
        expect(
            options.edgeReducer?.(
                'usr_a__usr_b',
                data,
                attributes,
                state,
                graphState,
                graph
            )
        ).toMatchObject({
            size: 0.75,
            path: 'curved',
            zIndex: 2
        });
    });

    it('releases the previous renderer and observer when rebuilding the graph', async () => {
        const options: Parameters<typeof renderSigmaGraph>[0] = {
            graph: await build(),
            container: document.createElement('div'),
            instanceRef: { current: null },
            resizeObserverRef: { current: null },
            themeRef: { current: buildMutualFriendsGraphTheme(true) },
            selectedNodeIdRef: { current: '' },
            crossCommunityOnlyRef: { current: false },
            onSelectNode: vi.fn(),
            hoverCardStringsRef: {
                current: { connections: '', lastFetched: '', unavailable: '' }
            }
        };
        const firstController = renderSigmaGraph(options);
        const firstRenderer = options.instanceRef.current;
        const firstObserver = options.resizeObserverRef.current;
        if (!firstObserver) throw new Error('Expected a resize observer');
        const disconnect = vi.spyOn(firstObserver, 'disconnect');
        firstController.dispose();
        const secondController = renderSigmaGraph({
            ...options,
            graph: await build()
        });
        expect(sigmaMock.kill).toHaveBeenCalledOnce();
        expect(disconnect).toHaveBeenCalledOnce();
        expect(options.instanceRef.current).not.toBe(firstRenderer);
        expect(sigmaMock.handlers.has('afterRender')).toBe(true);
        secondController.dispose();
    });

    it('draws the hover card with raw metadata and clears it on leaving', async () => {
        const context = {
            setTransform: vi.fn(),
            clearRect: vi.fn()
        } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
            context
        );
        await renderGraph({ onSelectNode: vi.fn() });
        emit('enterNode', { node: 'usr_a' });
        emit('afterRender', { node: 'usr_a' });
        expect(drawMutualFriendHoverCard).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                fullLabel: 'usr_a',
                mutualCount: 1,
                lastFetchedAt: '2026-09-01T00:00:00.000Z',
                x: 100,
                y: 120
            }),
            expect.objectContaining({ labelFont: 'Arial', labelSize: 14 }),
            expect.anything(),
            expect.anything()
        );
        vi.mocked(drawMutualFriendHoverCard).mockClear();
        emit('leaveNode', { node: 'usr_a' });
        emit('afterRender', { node: 'usr_a' });
        expect(drawMutualFriendHoverCard).not.toHaveBeenCalled();
        expect(context.clearRect).toHaveBeenCalledWith(0, 0, 400, 300);
    });

    it('reacts to a double click only once', async () => {
        const onSelectNode = vi.fn();
        const onOpenNode = vi.fn();
        await renderGraph({ onSelectNode, onOpenNode });
        const preventSigmaDefault = vi.fn();

        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 1 } }
        });
        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 2 } }
        });
        emit('doubleClickNode', { node: 'usr_a', preventSigmaDefault });

        expect(onSelectNode).toHaveBeenCalledOnce();
        expect(onOpenNode).toHaveBeenCalledOnce();
        expect(preventSigmaDefault).toHaveBeenCalledOnce();
    });

    it('opens nothing extra on double click when the graph only reacts to clicks', async () => {
        const onSelectNode = vi.fn();
        await renderGraph({ onSelectNode });
        const preventSigmaDefault = vi.fn();

        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 1 } }
        });
        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 2 } }
        });
        emit('doubleClickNode', { node: 'usr_a', preventSigmaDefault });

        expect(onSelectNode).toHaveBeenCalledOnce();
        expect(preventSigmaDefault).toHaveBeenCalledOnce();
    });
});
