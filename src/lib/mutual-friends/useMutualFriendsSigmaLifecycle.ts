import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import { buildMutualFriendsGraphTheme } from '@/lib/mutual-friends/mutualFriendsPalette';
import type {
    MutualFriendGraph,
    MutualFriendsLayoutSettings
} from '@/lib/mutual-friends/mutualFriendsTypes';

import {
    applyMutualFriendsCommunitySeparation,
    applyMutualFriendsEdgeCurvature,
    applyMutualFriendsGraphTheme,
    buildSigmaGraph,
    destroySigmaInstance,
    renderSigmaGraph,
    type MutualFriendsSigmaGraph,
    type SigmaGraphController,
    type SigmaInstance
} from './mutualFriendsSigmaGraph';

interface SigmaLifecycleOptions {
    graph: MutualFriendGraph;
    layoutSettings: MutualFriendsLayoutSettings;
    communityIndexById: ReadonlyMap<string, number>;
    namedCommunityIndexes: ReadonlySet<number>;
    resolvedTheme: string;
    crossCommunityOnly: boolean;
    selectedNodeId: string;
    selectedNodeIdRef: { current: string };
    onSelectNode: (nodeId: string) => void;
    onOpenNode?: (nodeId: string) => void;
    forceLabels?: boolean;
    minNodeSize?: number;
    emphasizedNodeId?: string;
    nodeImageUrlById?: ReadonlyMap<string, string>;
    nodeImagesOnHover?: boolean;
}

const NO_NODE_IMAGES: ReadonlyMap<string, string> = new Map();

export function useMutualFriendsSigmaLifecycle({
    graph,
    layoutSettings,
    communityIndexById,
    namedCommunityIndexes,
    resolvedTheme,
    crossCommunityOnly,
    selectedNodeId,
    selectedNodeIdRef,
    onSelectNode,
    onOpenNode,
    forceLabels = false,
    minNodeSize,
    emphasizedNodeId,
    nodeImageUrlById = NO_NODE_IMAGES,
    nodeImagesOnHover = false
}: SigmaLifecycleOptions) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLElement | null>(null);
    const instanceRef = useRef<SigmaInstance | null>(null);
    const controllerRef = useRef<SigmaGraphController | null>(null);
    const graphologyRef = useRef<MutualFriendsSigmaGraph | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const pendingRenderFrameRef = useRef(0);
    const selectNodeRef = useRef(onSelectNode);
    const openNodeRef = useRef(onOpenNode);
    const [renderRetryToken, setRenderRetryToken] = useState(0);
    const [isLayoutRunning, setIsLayoutRunning] = useState(false);
    const [containerElement, setContainerElement] =
        useState<HTMLElement | null>(null);

    const isDarkMode = resolvedTheme === 'dark';
    const theme = useMemo(
        () => buildMutualFriendsGraphTheme(isDarkMode, containerElement),
        [containerElement, isDarkMode]
    );
    const themeRef = useRef(theme);
    const crossCommunityOnlyRef = useRef(crossCommunityOnly);
    const nodeImageUrlByIdRef = useRef(nodeImageUrlById);
    const hoverCardStrings = {
        connections: t('view.charts.label.connections'),
        lastFetched: t('view.charts.mutual_friend.context_menu.last_fetched'),
        unavailable: t('view.charts.mutual_friend.label.mutuals_unavailable')
    };
    const hoverCardStringsRef = useRef(hoverCardStrings);

    const {
        layoutIterations,
        layoutSpacing,
        edgeCurvature,
        communitySeparation
    } = layoutSettings;
    const layoutSettingsRef = useRef(layoutSettings);

    useLayoutEffect(() => {
        selectNodeRef.current = onSelectNode;
        openNodeRef.current = onOpenNode;
        themeRef.current = theme;
        crossCommunityOnlyRef.current = crossCommunityOnly;
        nodeImageUrlByIdRef.current = nodeImageUrlById;
        hoverCardStringsRef.current = hoverCardStrings;
        layoutSettingsRef.current = layoutSettings;
    });

    const teardownGraph = useCallback(() => {
        const controller = controllerRef.current;
        controllerRef.current = null;
        graphologyRef.current = null;
        controller?.dispose();
        destroySigmaInstance(instanceRef, resizeObserverRef);
    }, []);

    const setGraphElementRef = useCallback(
        (node: HTMLElement | null) => {
            if (containerRef.current && containerRef.current !== node) {
                teardownGraph();
            }
            containerRef.current = node;
            setContainerElement(node);
        },
        [teardownGraph]
    );

    useEffect(() => {
        return () => {
            if (pendingRenderFrameRef.current) {
                cancelAnimationFrame(pendingRenderFrameRef.current);
                pendingRenderFrameRef.current = 0;
            }
            teardownGraph();
        };
    }, [teardownGraph]);

    const retryAfterFrame = useCallback(() => {
        if (pendingRenderFrameRef.current) {
            return;
        }
        pendingRenderFrameRef.current = requestAnimationFrame(() => {
            pendingRenderFrameRef.current = 0;
            setRenderRetryToken((current) => current + 1);
        });
    }, []);

    useEffect(() => {
        if (!graph.nodes.length) {
            teardownGraph();
            return undefined;
        }

        const container = containerRef.current;
        if (!container) {
            return undefined;
        }
        if (!container.clientWidth || !container.clientHeight) {
            retryAfterFrame();
            return undefined;
        }

        let active = true;
        setIsLayoutRunning(true);
        buildSigmaGraph({
            graph,
            layoutSettings: {
                ...layoutSettingsRef.current,
                layoutIterations,
                layoutSpacing
            },
            communityIndexById,
            namedCommunityIndexes,
            theme: themeRef.current,
            forceLabels,
            minNodeSize,
            emphasizedNodeId
        })
            .then((builtGraph) => {
                if (!active || containerRef.current !== container) {
                    return;
                }
                if (!container.clientWidth || !container.clientHeight) {
                    retryAfterFrame();
                    return;
                }

                teardownGraph();
                controllerRef.current = renderSigmaGraph({
                    graph: builtGraph,
                    container,
                    instanceRef,
                    resizeObserverRef,
                    themeRef,
                    selectedNodeIdRef,
                    crossCommunityOnlyRef,
                    onSelectNode: (nodeId) => selectNodeRef.current(nodeId),
                    onOpenNode: (nodeId) => openNodeRef.current?.(nodeId),
                    hoverCardStringsRef,
                    nodeImageUrlByIdRef,
                    nodeImagesOnHover
                });
                graphologyRef.current = builtGraph;
            })
            .catch((error: unknown) => {
                if (active) {
                    console.warn(
                        '[MutualFriendsPage] Failed to render mutual graph.',
                        error
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setIsLayoutRunning(false);
                }
            });

        return () => {
            active = false;
        };
    }, [
        graph,
        communityIndexById,
        emphasizedNodeId,
        forceLabels,
        minNodeSize,
        namedCommunityIndexes,
        nodeImagesOnHover,
        layoutIterations,
        layoutSpacing,
        renderRetryToken,
        retryAfterFrame,
        selectedNodeIdRef,
        teardownGraph
    ]);

    useEffect(() => {
        const builtGraph = graphologyRef.current;
        if (!builtGraph) {
            return;
        }
        const settings = { ...layoutSettingsRef.current };
        applyMutualFriendsCommunitySeparation(builtGraph, settings);
        applyMutualFriendsEdgeCurvature(builtGraph, settings);
        applyMutualFriendsGraphTheme(builtGraph, theme);
        controllerRef.current?.applyTheme();
    }, [communitySeparation, edgeCurvature, theme]);

    useEffect(() => {
        controllerRef.current?.applySelection(selectedNodeId);
    }, [selectedNodeId]);

    useEffect(() => {
        controllerRef.current?.applyEdgeEmphasis();
    }, [crossCommunityOnly]);

    const appliedNodeImageUrlByIdRef = useRef(nodeImageUrlById);
    useEffect(() => {
        const previous = appliedNodeImageUrlByIdRef.current;
        appliedNodeImageUrlByIdRef.current = nodeImageUrlById;
        if (
            previous.size === nodeImageUrlById.size &&
            [...nodeImageUrlById].every(
                ([node, url]) => previous.get(node) === url
            )
        ) {
            return;
        }
        controllerRef.current?.applyNodeImages();
    }, [nodeImageUrlById]);

    return {
        isLayoutRunning,
        setGraphElementRef
    };
}
