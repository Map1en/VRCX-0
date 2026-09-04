import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildMutualFriendsGraphTheme } from './mutualFriendsPalette';
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
import type {
    MutualFriendGraph,
    MutualFriendsLayoutSettings
} from './mutualFriendsTypes';

interface SigmaLifecycleOptions {
    graph: MutualFriendGraph;
    layoutSettings: MutualFriendsLayoutSettings;
    communityIndexById: Map<string, number>;
    namedCommunityIndexes: ReadonlySet<number>;
    resolvedTheme: string;
    selectedNodeId: string;
    selectedNodeIdRef: { current: string };
    onSelectNode: (nodeId: string) => void;
    onOpenNode: (nodeId: string) => void;
}

export function useMutualFriendsSigmaLifecycle({
    graph,
    layoutSettings,
    communityIndexById,
    namedCommunityIndexes,
    resolvedTheme,
    selectedNodeId,
    selectedNodeIdRef,
    onSelectNode,
    onOpenNode
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

    selectNodeRef.current = onSelectNode;
    openNodeRef.current = onOpenNode;

    const isDarkMode = resolvedTheme === 'dark';
    const theme = useMemo(
        () => buildMutualFriendsGraphTheme(isDarkMode, containerRef.current),
        [isDarkMode]
    );
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const hoverCardStringsRef = useRef({
        connections: '',
        lastFetched: '',
        unavailable: ''
    });
    hoverCardStringsRef.current = {
        connections: t('view.charts.label.connections'),
        lastFetched: t('view.charts.mutual_friend.context_menu.last_fetched'),
        unavailable: t('view.charts.mutual_friend.label.mutuals_unavailable')
    };

    const {
        layoutIterations,
        layoutSpacing,
        edgeCurvature,
        communitySeparation
    } = layoutSettings;
    const layoutSettingsRef = useRef(layoutSettings);
    layoutSettingsRef.current = layoutSettings;

    const teardownGraph = useCallback(() => {
        controllerRef.current?.dispose();
        destroySigmaInstance(instanceRef, resizeObserverRef);
        controllerRef.current = null;
        graphologyRef.current = null;
    }, []);

    const setGraphElementRef = useCallback(
        (node: HTMLElement | null) => {
            if (containerRef.current && containerRef.current !== node) {
                teardownGraph();
            }
            containerRef.current = node;
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
            theme: themeRef.current
        })
            .then((builtGraph) => {
                if (!active || containerRef.current !== container) {
                    return;
                }
                if (!container.clientWidth || !container.clientHeight) {
                    retryAfterFrame();
                    return;
                }

                graphologyRef.current = builtGraph;
                controllerRef.current?.dispose();
                controllerRef.current = renderSigmaGraph({
                    graph: builtGraph,
                    container,
                    instanceRef,
                    resizeObserverRef,
                    themeRef,
                    selectedNodeIdRef,
                    onSelectNode: (nodeId) => selectNodeRef.current(nodeId),
                    onOpenNode: (nodeId) => openNodeRef.current(nodeId),
                    hoverCardStringsRef
                });
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
        namedCommunityIndexes,
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

    return {
        isLayoutRunning,
        setGraphElementRef
    };
}
