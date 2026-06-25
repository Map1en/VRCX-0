import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';
import { useModalStore } from '@/state/modalStore';

import {
    buildMutualFriendsBaseGraph,
    filterMutualFriendsGraph
} from './mutualFriendsGraphData';
import {
    buildMutualFriendExcludePickerOptions,
    buildMutualFriendNodePickerOptions,
    filterMutualFriendPickerOptions
} from './mutualFriendsPicker';
import {
    normalizeExcludedMutualFriendIds,
    normalizeMutualFriendId,
    readExcludedMutualFriendIds,
    writeExcludedMutualFriendIds
} from './mutualFriendsSettings';
import { fetchMutualFriendIds } from './mutualFriendsSigmaGraph';
import { useMutualFriendsGraphFetch } from './useMutualFriendsGraphFetch';
import { useMutualFriendsLayoutSettings } from './useMutualFriendsLayoutSettings';
import { useMutualFriendsRuntime } from './useMutualFriendsRuntime';
import { useMutualFriendsSigmaLifecycle } from './useMutualFriendsSigmaLifecycle';
import { useMutualFriendsSnapshot } from './useMutualFriendsSnapshot';

export function useMutualFriendsPageState() {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const {
        currentUserId,
        currentUserEndpoint,
        friendsById,
        orderedFriendIds,
        resolvedTheme
    } = useMutualFriendsRuntime();
    const currentUserIdRef = useRef(currentUserId);
    const [nodePickerOpen, setNodePickerOpen] = useState(false);
    const [nodeSearchQuery, setNodeSearchQuery] = useState('');
    const [excludeSearchQuery, setExcludeSearchQuery] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const selectedNodeIdRef = useRef('');
    const [excludedFriendIds, setExcludedFriendIds] = useState(
        readExcludedMutualFriendIds
    );
    const [nodeRefreshId, setNodeRefreshId] = useState('');
    const [reloadToken, setReloadToken] = useState(0);
    const { layoutSettings, resetLayoutSettings, setLayoutSetting } =
        useMutualFriendsLayoutSettings();

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
    }, [currentUserId]);

    const snapshot = useMutualFriendsSnapshot({
        currentUserId,
        currentUserIdRef,
        reloadToken
    });

    useEffect(() => {
        writeExcludedMutualFriendIds(excludedFriendIds);
    }, [excludedFriendIds]);

    const baseGraph = useMemo(
        () =>
            buildMutualFriendsBaseGraph(
                snapshot.snapshotData.snapshot,
                snapshot.snapshotData.meta,
                friendsById,
                excludedFriendIds
            ),
        [
            excludedFriendIds,
            friendsById,
            snapshot.snapshotData.meta,
            snapshot.snapshotData.snapshot
        ]
    );

    const filteredGraph = useMemo(
        () => filterMutualFriendsGraph(baseGraph, ''),
        [baseGraph]
    );

    const nodeOptions = useMemo(
        () => buildMutualFriendNodePickerOptions(baseGraph.nodes, friendsById),
        [baseGraph.nodes, friendsById]
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
                excludeSearchQuery,
                undefined,
                excludedFriendIdSet
            ),
        [excludePickerOptions, excludeSearchQuery, excludedFriendIdSet]
    );

    const selectedNode = useMemo(
        () =>
            baseGraph.nodes.find((node: any) => node.id === selectedNodeId) ||
            null,
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
                (node: any) => node.id === selectedNodeIdRef.current
            )
        ) {
            return;
        }

        const nextSelectedNodeId = filteredGraph.nodes[0].id;
        selectedNodeIdRef.current = nextSelectedNodeId;
        setSelectedNodeId(nextSelectedNodeId);
    }, [filteredGraph.nodes]);

    const sigma = useMutualFriendsSigmaLifecycle({
        filteredGraph,
        layoutSettings,
        resolvedTheme,
        selectedNodeId,
        selectedNodeIdRef,
        setSelectedNodeId
    });

    const { fetchProgress, handleCancelFetch, handleFetchGraph } =
        useMutualFriendsGraphFetch({
            currentUserId,
            currentUserEndpoint,
            currentUserIdRef,
            friendsById,
            orderedFriendIds,
            reloadSnapshot: snapshot.reloadSnapshot,
            setDetail: snapshot.setDetail,
            setStatus: snapshot.setStatus
        });

    function selectNode(friendId: any) {
        const nextValue = normalizeMutualFriendId(friendId);
        selectedNodeIdRef.current = nextValue;
        setSelectedNodeId(nextValue);
        sigma.focusNode(nextValue);
    }

    function toggleExcludedFriendId(friendId: any) {
        const normalizedId = normalizeMutualFriendId(friendId);
        if (!normalizedId) {
            return;
        }
        setExcludedFriendIds((current: any) => {
            const normalizedCurrent = normalizeExcludedMutualFriendIds(current);
            if (normalizedCurrent.includes(normalizedId)) {
                return normalizedCurrent.filter(
                    (id: any) => id !== normalizedId
                );
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
            const mutualIds = await fetchMutualFriendIds(selectedNode.id);
            if (currentUserIdRef.current !== ownerUserId) {
                return;
            }
            await mutualGraphPersistenceRepository.updateMutualsForFriend(
                ownerUserId,
                selectedNode.id,
                mutualIds
            );
            await mutualGraphPersistenceRepository.upsertMeta(
                ownerUserId,
                selectedNode.id,
                {
                    optedOut: false
                }
            );
            await snapshot.reloadSnapshot(
                `Refreshed mutuals for ${selectedNode.label}.`,
                ownerUserId
            );
            toast.success(
                t('view.charts.dynamic.refreshed_mutuals_for_value', {
                    value: selectedNode.label
                })
            );
        } catch (error) {
            const status = (error as { status?: number })?.status;
            if (status === 403 || status === 404) {
                if (currentUserIdRef.current !== ownerUserId) {
                    return;
                }
                await mutualGraphPersistenceRepository.upsertMeta(
                    ownerUserId,
                    selectedNode.id,
                    {
                        optedOut: true
                    }
                );
                await snapshot.reloadSnapshot(
                    `${selectedNode.label} has opted out of shared connections.`,
                    ownerUserId
                );
                toast.warning(
                    t(
                        'view.charts.dynamic.value_has_opted_out_of_shared_connections',
                        { value: selectedNode.label }
                    )
                );
                return;
            }

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
    }

    return {
        actions: {
            cancelFetch: handleCancelFetch,
            fetchGraph: handleFetchGraph,
            refreshPage: () => setReloadToken((value: any) => value + 1),
            refreshSelectedNode: handleRefreshSelectedNode,
            resetLayoutAndHidden: handleResetLayoutAndHidden,
            selectNode,
            toggleExcludedFriendId
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
            baseGraph,
            currentUserId,
            detail: snapshot.detail,
            edgeCount: filteredGraph.links.length,
            filteredGraph,
            friendCount: orderedFriendIds.length,
            nodeCount: filteredGraph.nodes.length,
            setGraphElementRef: sigma.setGraphElementRef,
            status: snapshot.status
        },
        layout: {
            layoutSettings,
            setLayoutSetting
        },
        picker: {
            filteredNodeOptions,
            nodePickerOpen,
            nodeRefreshId,
            nodeSearchQuery,
            selectedNode,
            selectedNodeId,
            setNodePickerOpen,
            setNodeSearchQuery
        }
    };
}
