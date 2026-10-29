import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { assignMutualFriendCommunities } from '@/lib/mutual-friends/mutualFriendsCommunities';
import {
    applyMutualFriendsViewFilters,
    countIsolatedMutualFriendNodes,
    countUnknownMutualFriendNodes
} from '@/lib/mutual-friends/mutualFriendsFilters';
import {
    buildMutualFriendsBaseGraph,
    buildMutualFriendsCoverage
} from '@/lib/mutual-friends/mutualFriendsGraphData';
import {
    mutualFriendsCommunityPalette,
    mutualFriendsNeutralCommunityColor
} from '@/lib/mutual-friends/mutualFriendsPalette';
import { buildMutualFriendExcludePickerOptions } from '@/lib/mutual-friends/mutualFriendsPicker';
import { normalizeMutualFriendId } from '@/lib/mutual-friends/mutualFriendsSettings';
import { useMutualFriendsExclusionStore } from '@/lib/mutual-friends/useMutualFriendsExclusionStore';
import { useMutualFriendsLayoutSettings } from '@/lib/mutual-friends/useMutualFriendsLayoutSettings';
import { useMutualFriendsSigmaLifecycle } from '@/lib/mutual-friends/useMutualFriendsSigmaLifecycle';
import { commands } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useMutualGraphRevisionStore } from '@/state/mutualGraphRevisionStore';

import { useMutualFriendsGraphFetch } from './useMutualFriendsGraphFetch';
import { useMutualFriendsRuntime } from './useMutualFriendsRuntime';
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
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const selectedNodeIdRef = useRef('');
    const excludedFriendIds = useMutualFriendsExclusionStore(
        (state) => state.excludedFriendIds
    );
    const setExcludedFriendIds = useMutualFriendsExclusionStore(
        (state) => state.setExcludedFriendIds
    );
    const toggleExcludedFriendId = useMutualFriendsExclusionStore(
        (state) => state.toggleExcludedFriendId
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
        crossCommunityOnly,
        setSearchQuery,
        setMinDegree,
        toggleFocusedCommunity,
        toggleCrossCommunityOnly,
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
    const neutralCommunityColor = useMemo(
        () => mutualFriendsNeutralCommunityColor(resolvedTheme === 'dark'),
        [resolvedTheme]
    );

    const { communityIndexById, communities } = useMemo(
        () =>
            assignMutualFriendCommunities(
                baseGraph,
                communityPalette,
                neutralCommunityColor
            ),
        [baseGraph, communityPalette, neutralCommunityColor]
    );

    const namedCommunityIndexes = useMemo(
        () =>
            new Set(
                communities
                    .filter((community) => community.isNamed)
                    .map((community) => community.index)
            ),
        [communities]
    );

    const coverage = useMemo(
        () =>
            buildMutualFriendsCoverage(
                snapshot.snapshotData.meta,
                orderedFriendIds
            ),
        [orderedFriendIds, snapshot.snapshotData.meta]
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
        namedCommunityIndexes,
        resolvedTheme,
        crossCommunityOnly,
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
                toast.add({
                    type: 'warning',
                    title: t(
                        'view.charts.dynamic.could_not_load_mutuals_for_value',
                        {
                            value: selectedNode.label
                        }
                    )
                });
            } else {
                toast.add({
                    type: 'success',
                    title: t(
                        'view.charts.dynamic.refreshed_mutuals_for_value',
                        {
                            value: selectedNode.label
                        }
                    )
                });
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.charts.toast.failed_to_refresh_selected_mutuals'
                          )
            });
        } finally {
            setNodeRefreshId('');
        }
    }

    return {
        actions: {
            cancelFetch: handleCancelFetch,
            clearFilters,
            fetchGraph: handleFetchGraph,
            openNode,
            refreshPage: () => setReloadToken((value) => value + 1),
            refreshSelectedNode: handleRefreshSelectedNode,
            resetLayoutSettings,
            clearSelection: () => handleSelectNode(''),
            setMinDegree,
            setSearchQuery,
            toggleCrossCommunityOnly,
            toggleExcludedFriendId,
            toggleFocusedCommunity
        },
        exclusions: {
            excludePickerOptions,
            excludedFriendIds,
            setExcludedFriendIds
        },
        fetch: {
            fetchProgress
        },
        graph: {
            baseNodeCount: baseGraph.nodes.length,
            communities,
            communityIndexById,
            coverage,
            currentUserId,
            detail: snapshot.detail,
            edgeCount: filteredGraph.links.length,
            friendCount: orderedFriendIds.length,
            isolatedCounts: countIsolatedMutualFriendNodes(baseGraph),
            unknownCount: countUnknownMutualFriendNodes(baseGraph),
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
            crossCommunityOnly,
            filters
        }
    };
}
