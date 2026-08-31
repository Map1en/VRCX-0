import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';
import { useModalStore } from '@/state/modalStore';
import { useMutualGraphRevisionStore } from '@/state/mutualGraphRevisionStore';

import { assignMutualFriendCommunities } from './mutualFriendsCommunities';
import {
    applyMutualFriendsViewFilters,
    countIsolatedMutualFriendNodes
} from './mutualFriendsFilters';
import { buildMutualFriendsBaseGraph } from './mutualFriendsGraphData';
import { mutualFriendsCommunityPalette } from './mutualFriendsPalette';
import {
    buildMutualFriendExcludePickerOptions,
    filterMutualFriendPickerOptions
} from './mutualFriendsPicker';
import {
    normalizeExcludedMutualFriendIds,
    normalizeMutualFriendId,
    readExcludedMutualFriendIds,
    writeExcludedMutualFriendIds
} from './mutualFriendsSettings';
import { useMutualFriendsGraphFetch } from './useMutualFriendsGraphFetch';
import { useMutualFriendsLayoutSettings } from './useMutualFriendsLayoutSettings';
import { useMutualFriendsRuntime } from './useMutualFriendsRuntime';
import { useMutualFriendsSigmaLifecycle } from './useMutualFriendsSigmaLifecycle';
import { useMutualFriendsSnapshot } from './useMutualFriendsSnapshot';
import { useMutualFriendsViewFilters } from './useMutualFriendsViewFilters';

export function useMutualFriendsPageState() {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const {
        currentUserId,
        friendsById,
        friendLabelsById,
        orderedFriendIds,
        resolvedTheme
    } = useMutualFriendsRuntime();
    const currentUserIdRef = useRef(currentUserId);
    const [excludeSearchQuery, setExcludeSearchQuery] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const selectedNodeIdRef = useRef('');
    const [excludedFriendIds, setExcludedFriendIds] = useState(
        readExcludedMutualFriendIds
    );
    const [nodeRefreshId, setNodeRefreshId] = useState('');
    const [reloadToken, setReloadToken] = useState(0);
    const backfillRevision = useMutualGraphRevisionStore((state) =>
        state.ownerUserId === currentUserId ? state.revision : 0
    );
    const { layoutSettings, resetLayoutSettings, setLayoutSetting } =
        useMutualFriendsLayoutSettings();
    const {
        filters,
        setSearchQuery,
        setMinDegree,
        toggleFocusedCommunity,
        clearFilters
    } = useMutualFriendsViewFilters();

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
    }, [currentUserId]);

    const snapshot = useMutualFriendsSnapshot({
        currentUserId,
        currentUserIdRef,
        reloadToken: reloadToken + backfillRevision
    });

    useEffect(() => {
        writeExcludedMutualFriendIds(excludedFriendIds);
    }, [excludedFriendIds]);

    const baseGraph = useMemo(
        () =>
            buildMutualFriendsBaseGraph(
                snapshot.snapshotData.snapshot,
                snapshot.snapshotData.meta,
                friendLabelsById,
                excludedFriendIds
            ),
        [
            excludedFriendIds,
            friendLabelsById,
            snapshot.snapshotData.meta,
            snapshot.snapshotData.snapshot
        ]
    );

    const communityPalette = useMemo(
        () => mutualFriendsCommunityPalette(resolvedTheme === 'dark'),
        [resolvedTheme]
    );

    const { communityIndexById, communities } = useMemo(
        () => assignMutualFriendCommunities(baseGraph, communityPalette),
        [baseGraph, communityPalette]
    );

    const filteredGraph = useMemo(
        () =>
            applyMutualFriendsViewFilters(
                baseGraph,
                filters,
                communityIndexById
            ),
        [baseGraph, communityIndexById, filters]
    );

    const excludePickerOptions = useMemo(
        () =>
            buildMutualFriendExcludePickerOptions(
                snapshot.snapshotData.snapshot,
                friendsById,
                currentUserId
            ),
        [currentUserId, friendsById, snapshot.snapshotData.snapshot]
    );

    const excludedFriendIdSet = useMemo(
        () => new Set(normalizeExcludedMutualFriendIds(excludedFriendIds)),
        [excludedFriendIds]
    );

    const filteredExcludeOptions = useMemo(
        () =>
            filterMutualFriendPickerOptions(
                excludePickerOptions,
                excludeSearchQuery,
                undefined,
                excludedFriendIdSet
            ),
        [excludePickerOptions, excludeSearchQuery, excludedFriendIdSet]
    );

    const selectedNode = useMemo(
        () =>
            baseGraph.nodes.find((node) => node.id === selectedNodeId) ?? null,
        [baseGraph.nodes, selectedNodeId]
    );

    useEffect(() => {
        if (
            !selectedNodeIdRef.current ||
            filteredGraph.nodes.some(
                (node) => node.id === selectedNodeIdRef.current
            )
        ) {
            return;
        }
        selectedNodeIdRef.current = '';
        setSelectedNodeId('');
    }, [filteredGraph.nodes]);

    const openNode = useCallback(
        (nodeId: string) => {
            const node = baseGraph.nodes.find((item) => item.id === nodeId);
            openUserDialog({ userId: nodeId, title: node?.label });
        },
        [baseGraph.nodes]
    );

    const handleSelectNode = useCallback((nodeId: string) => {
        const nextValue = normalizeMutualFriendId(nodeId);
        selectedNodeIdRef.current = nextValue;
        setSelectedNodeId(nextValue);
    }, []);

    const sigma = useMutualFriendsSigmaLifecycle({
        graph: filteredGraph,
        layoutSettings,
        communityIndexById,
        resolvedTheme,
        selectedNodeId,
        selectedNodeIdRef,
        onSelectNode: handleSelectNode,
        onOpenNode: openNode
    });

    const { fetchProgress, handleCancelFetch, handleFetchGraph } =
        useMutualFriendsGraphFetch({
            currentUserId,
            reloadSnapshot: snapshot.reloadSnapshot,
            setDetail: snapshot.setDetail
        });

    function toggleExcludedFriendId(friendId: string) {
        const normalizedId = normalizeMutualFriendId(friendId);
        if (!normalizedId) {
            return;
        }
        setExcludedFriendIds((current) => {
            const normalizedCurrent = normalizeExcludedMutualFriendIds(current);
            return normalizedCurrent.includes(normalizedId)
                ? normalizedCurrent.filter((id) => id !== normalizedId)
                : [...normalizedCurrent, normalizedId];
        });
    }

    async function handleRefreshSelectedNode() {
        if (!currentUserId || !selectedNode?.id || nodeRefreshId) {
            return;
        }
        const ownerUserId = currentUserId;

        if (!friendsById[selectedNode.id]) {
            const result = await confirm({
                title: t('view.charts.modal.refresh_non_friend_mutuals'),
                description: t(
                    'view.charts.modal.this_node_is_not_currently_in_the_friend_roster_continue_refreshing_its_mutual_friends_cache'
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
            const result = await commands.appMutualGraphFriendRefresh({
                ownerUserId,
                friendId: selectedNode.id
            });
            if (currentUserIdRef.current !== ownerUserId) {
                return;
            }
            await snapshot.reloadSnapshot('', ownerUserId);
            if (result.status === 'optedOut') {
                toast.warning(
                    t('view.charts.dynamic.could_not_load_mutuals_for_value', {
                        value: selectedNode.label
                    })
                );
            } else {
                toast.success(
                    t('view.charts.dynamic.refreshed_mutuals_for_value', {
                        value: selectedNode.label
                    })
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.charts.toast.failed_to_refresh_selected_mutuals')
            );
        } finally {
            setNodeRefreshId('');
        }
    }

    function handleResetLayoutAndHidden() {
        resetLayoutSettings();
        setExcludedFriendIds([]);
        clearFilters();
    }

    return {
        actions: {
            cancelFetch: handleCancelFetch,
            clearFilters,
            fetchGraph: handleFetchGraph,
            openNode,
            refreshPage: () => setReloadToken((value) => value + 1),
            refreshSelectedNode: handleRefreshSelectedNode,
            resetLayoutAndHidden: handleResetLayoutAndHidden,
            clearSelection: () => handleSelectNode(''),
            setMinDegree,
            setSearchQuery,
            toggleExcludedFriendId,
            toggleFocusedCommunity
        },
        exclusions: {
            excludeSearchQuery,
            excludedCount: excludedFriendIds.length,
            excludedFriendIdSet,
            filteredExcludeOptions,
            setExcludeSearchQuery
        },
        fetch: {
            fetchProgress
        },
        graph: {
            baseNodeCount: baseGraph.nodes.length,
            communities,
            communityIndexById,
            currentUserId,
            detail: snapshot.detail,
            edgeCount: filteredGraph.links.length,
            friendCount: orderedFriendIds.length,
            isolatedCount: countIsolatedMutualFriendNodes(baseGraph),
            isLayoutRunning: sigma.isLayoutRunning,
            nodeCount: filteredGraph.nodes.length,
            setGraphElementRef: sigma.setGraphElementRef,
            status: snapshot.status
        },
        layout: {
            layoutSettings,
            setLayoutSetting
        },
        selection: {
            communityIndex: selectedNode
                ? (communityIndexById.get(selectedNode.id) ?? null)
                : null,
            isRefreshing: Boolean(
                selectedNode && nodeRefreshId === selectedNode.id
            ),
            node: selectedNode,
            user: selectedNode ? (friendsById[selectedNode.id] ?? null) : null
        },
        view: {
            filters
        }
    };
}
