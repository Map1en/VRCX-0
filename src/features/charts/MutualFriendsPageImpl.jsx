import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { mutualGraphRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';

import {
    MutualFriendsFetchProgress,
    MutualFriendsGraphStage,
    MutualFriendsToolbar
} from './components/MutualFriendsGraphSections.jsx';
import {
    buildMutualFriendsBaseGraph,
    filterMutualFriendsGraph
} from './mutual-friends/mutualFriendsGraphData.js';
import {
    buildMutualFriendExcludePickerOptions,
    buildMutualFriendNodePickerOptions,
    filterMutualFriendPickerOptions
} from './mutual-friends/mutualFriendsPicker.js';
import {
    normalizeExcludedMutualFriendIds,
    normalizeMutualFriendId,
    readExcludedMutualFriendIds,
    writeExcludedMutualFriendIds
} from './mutual-friends/mutualFriendsSettings.js';
import {
    buildSigmaGraph,
    destroySigmaInstance,
    fetchMutualFriendIds,
    renderSigmaGraph
} from './mutual-friends/mutualFriendsSigmaGraph.js';
import { useMutualFriendsGraphFetch } from './mutual-friends/useMutualFriendsGraphFetch.js';
import { useMutualFriendsLayoutSettings } from './mutual-friends/useMutualFriendsLayoutSettings.js';

export function MutualFriendsPage() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const confirm = useModalStore((state) => state.confirm);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);

    const [status, setStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [snapshotData, setSnapshotData] = useState({
        snapshot: new Map(),
        meta: new Map()
    });
    const { layoutSettings, resetLayoutSettings, setLayoutSetting } =
        useMutualFriendsLayoutSettings();
    const searchQuery = '';
    const [nodePickerOpen, setNodePickerOpen] = useState(false);
    const [nodeSearchQuery, setNodeSearchQuery] = useState('');
    const [excludeSearchQuery, setExcludeSearchQuery] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const [excludedFriendIds, setExcludedFriendIds] = useState(
        readExcludedMutualFriendIds
    );
    const [nodeRefreshId, setNodeRefreshId] = useState('');
    const [reloadToken, setReloadToken] = useState(0);

    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const selectedNodeIdRef = useRef('');
    const currentUserIdRef = useRef(currentUserId);
    const pendingRenderFrameRef = useRef(0);
    const [renderRetryToken, setRenderRetryToken] = useState(0);

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
    }, [currentUserId]);

    const setGraphElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            destroySigmaInstance(chartInstanceRef, resizeObserverRef);
        }
        chartElementRef.current = node;
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
                setDetail(
                    'Reading the cached mutual-friends graph from the local database.'
                );
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
        writeExcludedMutualFriendIds(excludedFriendIds);
    }, [excludedFriendIds]);

    useEffect(() => {
        return () => {
            if (pendingRenderFrameRef.current) {
                cancelAnimationFrame(pendingRenderFrameRef.current);
                pendingRenderFrameRef.current = 0;
            }
            destroySigmaInstance(chartInstanceRef, resizeObserverRef);
        };
    }, []);

    const baseGraph = useMemo(
        () =>
            buildMutualFriendsBaseGraph(
                snapshotData.snapshot,
                snapshotData.meta,
                friendsById,
                excludedFriendIds
            ),
        [
            excludedFriendIds,
            friendsById,
            snapshotData.meta,
            snapshotData.snapshot
        ]
    );

    const filteredGraph = useMemo(
        () => filterMutualFriendsGraph(baseGraph, searchQuery),
        [baseGraph, searchQuery]
    );

    const nodeOptions = useMemo(
        () => buildMutualFriendNodePickerOptions(baseGraph.nodes, friendsById),
        [baseGraph.nodes, friendsById]
    );

    const excludePickerOptions = useMemo(
        () =>
            buildMutualFriendExcludePickerOptions(
                snapshotData.snapshot,
                friendsById,
                currentUserId
            ),
        [currentUserId, friendsById, snapshotData.snapshot]
    );

    const filteredNodeOptions = useMemo(
        () => filterMutualFriendPickerOptions(nodeOptions, nodeSearchQuery),
        [nodeOptions, nodeSearchQuery]
    );

    const excludedFriendIdSet = useMemo(
        () => new Set(normalizeExcludedMutualFriendIds(excludedFriendIds)),
        [excludedFriendIds]
    );

    const filteredExcludeOptions = useMemo(
        () =>
            filterMutualFriendPickerOptions(
                excludePickerOptions,
                excludeSearchQuery
            ),
        [excludePickerOptions, excludeSearchQuery]
    );

    const selectedNode = useMemo(
        () =>
            baseGraph.nodes.find((node) => node.id === selectedNodeId) || null,
        [baseGraph.nodes, selectedNodeId]
    );

    useEffect(() => {
        if (!filteredGraph.nodes.length) {
            selectedNodeIdRef.current = '';
            setSelectedNodeId('');
            return;
        }

        if (
            filteredGraph.nodes.some(
                (node) => node.id === selectedNodeIdRef.current
            )
        ) {
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

        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) {
            if (!pendingRenderFrameRef.current) {
                pendingRenderFrameRef.current = requestAnimationFrame(() => {
                    pendingRenderFrameRef.current = 0;
                    setRenderRetryToken((current) => current + 1);
                });
            }
            return undefined;
        }

        let active = true;
        const isDarkMode = resolvedTheme === 'dark';
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

                const nextRect = container.getBoundingClientRect();
                if (!nextRect.width || !nextRect.height) {
                    if (!pendingRenderFrameRef.current) {
                        pendingRenderFrameRef.current = requestAnimationFrame(
                            () => {
                                pendingRenderFrameRef.current = 0;
                                setRenderRetryToken((current) => current + 1);
                            }
                        );
                    }
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
                    console.warn(
                        '[MutualFriendsPage] Failed to render mutual graph.',
                        error
                    );
                }
            });

        return () => {
            active = false;
        };
    }, [
        filteredGraph.links,
        filteredGraph.nodes,
        layoutSettings,
        renderRetryToken,
        resolvedTheme,
        t
    ]);

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
        chartInstanceRef.current?.refresh?.();
    }, [selectedNodeId]);

    const edgeCount = filteredGraph.links.length;
    const nodeCount = filteredGraph.nodes.length;
    const excludedCount = excludedFriendIds.length;

    async function reloadSnapshot(nextDetail, expectedUserId = currentUserId) {
        if (!expectedUserId || currentUserIdRef.current !== expectedUserId) {
            return;
        }

        setStatus('running');
        try {
            const result =
                await mutualGraphRepository.getSnapshot(expectedUserId);
            if (currentUserIdRef.current !== expectedUserId) {
                return;
            }
            setSnapshotData(result);
            setStatus('ready');
            setDetail(
                nextDetail ||
                    'Reading the cached mutual-friends graph from the local database.'
            );
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

    const {
        fetchProgress,
        handleCancelFetch,
        handleFetchGraph,
        progressPercent
    } = useMutualFriendsGraphFetch({
        currentUserId,
        currentUserIdRef,
        friendsById,
        orderedFriendIds,
        reloadSnapshot,
        setDetail,
        setStatus,
        t
    });

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
            current.includes(selectedNode.id)
                ? current
                : [...current, selectedNode.id]
        );
    }

    function selectNode(friendId) {
        const nextValue = normalizeMutualFriendId(friendId);
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
        const normalizedId = normalizeMutualFriendId(friendId);
        if (!normalizedId) {
            return;
        }
        setExcludedFriendIds((current) => {
            const normalizedCurrent = normalizeExcludedMutualFriendIds(current);
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
                title: t(
                    'view.charts.generated_modal.refresh_non_friend_mutuals'
                ),
                description: t(
                    'view.charts.generated_modal.this_node_is_not_currently_in_the_friend_roster_'
                ),
                confirmText: t('common.actions.refresh'),
                cancelText: t('common.actions.cancel')
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
            await mutualGraphRepository.updateMutualsForFriend(
                ownerUserId,
                selectedNode.id,
                mutualIds
            );
            await mutualGraphRepository.upsertMeta(
                ownerUserId,
                selectedNode.id,
                {
                    optedOut: false
                }
            );
            await reloadSnapshot(
                `Refreshed mutuals for ${selectedNode.label}.`,
                ownerUserId
            );
            toast.success(
                t('view.charts.generated_dynamic.refreshed_mutuals_for_value', {
                    value: selectedNode.label
                })
            );
        } catch (error) {
            if (error?.status === 403 || error?.status === 404) {
                if (currentUserIdRef.current !== ownerUserId) {
                    return;
                }
                await mutualGraphRepository.upsertMeta(
                    ownerUserId,
                    selectedNode.id,
                    {
                        optedOut: true
                    }
                );
                await reloadSnapshot(
                    `${selectedNode.label} has opted out of shared connections.`,
                    ownerUserId
                );
                toast.warning(
                    t(
                        'view.charts.generated_dynamic.value_has_opted_out_of_shared_connections',
                        { value: selectedNode.label }
                    )
                );
                return;
            }

            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.charts.generated_toast.failed_to_refresh_selected_mutuals'
                      )
            );
        } finally {
            setNodeRefreshId('');
        }
    }

    function handleResetLayoutAndHidden() {
        resetLayoutSettings();
        setExcludedFriendIds([]);
    }

    return (
        <div
            id="chart"
            className="x-container flex h-full min-h-0 flex-col overflow-y-auto p-6"
        >
            <div className="mt-0 flex min-h-0 flex-1 flex-col items-center pt-12">
                <MutualFriendsToolbar
                    baseNodeCount={baseGraph.nodes.length}
                    currentUserId={currentUserId}
                    edgeCount={edgeCount}
                    excludeSearchQuery={excludeSearchQuery}
                    excludedCount={excludedCount}
                    excludedFriendIdSet={excludedFriendIdSet}
                    fetchProgress={fetchProgress}
                    filteredExcludeOptions={filteredExcludeOptions}
                    filteredNodeOptions={filteredNodeOptions}
                    friendCount={orderedFriendIds.length}
                    layoutSettings={layoutSettings}
                    nodeCount={nodeCount}
                    nodePickerOpen={nodePickerOpen}
                    nodeRefreshId={nodeRefreshId}
                    nodeSearchQuery={nodeSearchQuery}
                    onCancelFetch={handleCancelFetch}
                    onExcludeSearchQueryChange={setExcludeSearchQuery}
                    onFetchGraph={handleFetchGraph}
                    onHideSelectedNode={handleHideSelectedNode}
                    onNodePickerOpenChange={setNodePickerOpen}
                    onNodeSearchQueryChange={setNodeSearchQuery}
                    onOpenSelectedNode={handleOpenSelectedNode}
                    onRefreshPage={() => setReloadToken((value) => value + 1)}
                    onRefreshSelectedNode={handleRefreshSelectedNode}
                    onResetLayoutAndHidden={handleResetLayoutAndHidden}
                    onSelectNode={selectNode}
                    onToggleExcludedFriendId={toggleExcludedFriendId}
                    selectedNode={selectedNode}
                    selectedNodeId={selectedNodeId}
                    setLayoutSetting={setLayoutSetting}
                    t={t}
                />

                <MutualFriendsFetchProgress
                    fetchProgress={fetchProgress}
                    progressPercent={progressPercent}
                />

                <div className="mt-3 w-full flex-1">
                    <MutualFriendsGraphStage
                        baseNodeCount={baseGraph.nodes.length}
                        detail={detail}
                        filteredNodeCount={filteredGraph.nodes.length}
                        onGraphElementRef={setGraphElementRef}
                        status={status}
                        t={t}
                    />
                </div>
            </div>
        </div>
    );
}
