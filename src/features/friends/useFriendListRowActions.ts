import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';
import { openUserDialog } from '@/services/dialogService';
import {
    openFriendProfileLoadDialog,
    startFriendProfileLoad
} from '@/services/friendProfileLoadService';
import friendRelationshipService from '@/services/friendRelationshipService';
import {
    startMutualGraphFetch,
    startMutualGraphFetchStatusPolling
} from '@/services/mutualGraphFetchService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    type FriendListRow,
    normalizeFriendListId as normalizeId
} from './friendListRows';

type MutualProgress = {
    current: number;
    total: number;
};

export function useFriendListRowActions({
    filteredRows,
    resetTableLayout,
    rosterRows,
    selectedFriendIds,
    setDeletingFriendIds,
    setIsBulkDeleting,
    setMutualProgress,
    setSelectedFriendIds
}: {
    filteredRows: FriendListRow[];
    resetTableLayout(): void;
    rosterRows: FriendListRow[];
    selectedFriendIds: Set<string>;
    setDeletingFriendIds: Dispatch<SetStateAction<Set<string>>>;
    setIsBulkDeleting(value: boolean): void;
    setMutualProgress(value: MutualProgress): void;
    setSelectedFriendIds: Dispatch<SetStateAction<Set<string>>>;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const applyFriendPatch = useFriendRosterStore(
        (state) => state.applyFriendPatch
    );
    const confirm = useModalStore((state) => state.confirm);
    const mutualGraphRunId = useRuntimeStore(
        (state) => state.mutualGraph.runId
    );
    const mutualGraphStatus = useRuntimeStore(
        (state) => state.mutualGraph.status
    );
    const mutualGraphOwnerUserId = useRuntimeStore(
        (state) => state.mutualGraph.ownerUserId
    );
    const mutualGraphProcessedFriends = useRuntimeStore(
        (state) => state.mutualGraph.processedFriends
    );
    const mutualGraphTotalFriends = useRuntimeStore(
        (state) => state.mutualGraph.totalFriends
    );
    const friendProfileLoadStatus = useRuntimeStore(
        (state) => state.friendProfileLoad.status
    );
    const handledMutualGraphRunRef = useRef(0);
    const isMutualFetching =
        mutualGraphOwnerUserId === currentUserId &&
        (mutualGraphStatus === 'running' || mutualGraphStatus === 'cancelling');
    const isLoadingUserDetails =
        friendProfileLoadStatus === 'running' ||
        friendProfileLoadStatus === 'cancelling';

    useEffect(() => {
        if (!isMutualFetching) {
            return;
        }
        setMutualProgress({
            current: mutualGraphProcessedFriends,
            total: mutualGraphTotalFriends
        });
    }, [
        isMutualFetching,
        mutualGraphProcessedFriends,
        mutualGraphTotalFriends,
        setMutualProgress
    ]);

    useEffect(() => {
        if (
            !currentUserId ||
            !mutualGraphRunId ||
            mutualGraphOwnerUserId !== currentUserId ||
            handledMutualGraphRunRef.current === mutualGraphRunId
        ) {
            return;
        }

        if (mutualGraphStatus === 'completed') {
            handledMutualGraphRunRef.current = mutualGraphRunId;
            applyCachedMutualFriendStats(currentUserId).catch((error) => {
                console.warn(
                    '[FriendListPage] Failed to apply mutual graph cache',
                    error
                );
            });
            return;
        }

        if (mutualGraphStatus === 'error') {
            handledMutualGraphRunRef.current = mutualGraphRunId;
        }
    }, [
        currentUserId,
        mutualGraphOwnerUserId,
        mutualGraphRunId,
        mutualGraphStatus,
        t
    ]);

    function setFriendDeleting(userId: unknown, isDeleting: boolean) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        setDeletingFriendIds((current) => {
            const next = new Set(current);
            if (isDeleting) {
                next.add(normalizedUserId);
            } else {
                next.delete(normalizedUserId);
            }
            return next;
        });
    }

    function toggleSelectedFriend(userId: unknown) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        setSelectedFriendIds((current) => {
            const next = new Set(current);
            if (next.has(normalizedUserId)) {
                next.delete(normalizedUserId);
            } else {
                next.add(normalizedUserId);
            }
            return next;
        });
    }

    async function deleteFriendById(userId: unknown) {
        const normalizedUserId = normalizeId(userId);
        const friend = friendsById[normalizedUserId];
        if (!normalizedUserId || !friend || !currentUserId) {
            return {
                stale: false,
                deleted: false
            };
        }
        setFriendDeleting(normalizedUserId, true);
        try {
            const result = await friendRelationshipService.deleteFriend({
                friend,
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                currentUserId
            });
            if (!result.stale) {
                setSelectedFriendIds((current) => {
                    const next = new Set(current);
                    next.delete(normalizedUserId);
                    return next;
                });
                if (result.localError) {
                    toast.warning(
                        t(
                            'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
                        )
                    );
                } else {
                    toast.success(
                        t('view.friends.dynamic.unfriended_value', {
                            value: friend.displayName || normalizedUserId
                        })
                    );
                }
            }
            return {
                ...result,
                deleted: !result.stale
            };
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.toast.failed_to_unfriend_value', {
                          value: friend.displayName || normalizedUserId
                      })
            );
            return {
                stale: false,
                deleted: false
            };
        } finally {
            setFriendDeleting(normalizedUserId, false);
        }
    }

    async function confirmDeleteFriend(friend: FriendListRow) {
        const normalizedUserId = normalizeId(friend?.id);
        if (!normalizedUserId) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.modal.unfriend_user'),
            description: friend?.displayName || normalizedUserId,
            confirmText: t('view.friends.modal.unfriend'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        await deleteFriendById(normalizedUserId);
    }

    async function bulkUnfriendSelected() {
        const selectedRows = filteredRows.filter((friend) =>
            selectedFriendIds.has(normalizeId(friend?.id))
        );
        if (!selectedRows.length) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.dynamic.unfriend_value_friends', {
                value: selectedRows.length
            }),
            description: selectedRows
                .map((friend) => friend.displayName || normalizeId(friend.id))
                .slice(0, 30)
                .join('\n'),
            confirmText: t('view.friends.modal.unfriend'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setIsBulkDeleting(true);
        try {
            let deletedCount = 0;
            for (const friend of selectedRows) {
                const deleteResult = await deleteFriendById(friend.id);
                if (deleteResult.stale) {
                    break;
                }
                if (deleteResult.deleted) {
                    deletedCount += 1;
                }
            }
            if (deletedCount > 0) {
                toast.success(
                    t('view.friends.dynamic.unfriended_value_friends', {
                        value: deletedCount
                    })
                );
            }
        } finally {
            setIsBulkDeleting(false);
        }
    }

    function loadFriendUserDetails() {
        if (isLoadingUserDetails) {
            openFriendProfileLoadDialog();
            return;
        }
        startFriendProfileLoad().catch((error: unknown) => {
            console.warn(
                '[FriendListPage] Failed to start friend profile loading',
                error
            );
            toast.error(
                t('view.friend_list.error.failed_to_load_friend_details')
            );
        });
    }

    async function applyCachedMutualFriendStats(ownerUserId: string) {
        const { snapshot, meta } =
            await mutualGraphPersistenceRepository.getSnapshot(ownerUserId);
        for (const friend of rosterRows) {
            const friendId = normalizeId(friend?.id);
            if (!friendId) {
                continue;
            }
            const mutualIds =
                snapshot instanceof Map ? snapshot.get(friendId) : [];
            const metadata = meta instanceof Map ? meta.get(friendId) : null;
            applyFriendPatch({
                userId: friendId,
                patch: {
                    $mutualCount: Array.isArray(mutualIds)
                        ? mutualIds.length
                        : 0,
                    $mutualOptedOut: Boolean(metadata?.optedOut)
                },
                stateBucket: friend.stateBucket || friend.state || 'offline'
            });
        }
    }

    async function loadMutualFriends() {
        if (!currentUserId || isMutualFetching) {
            return;
        }
        if (currentUserSnapshot?.hasSharedConnectionsOptOut) {
            toast.warning(
                t(
                    'view.friend_list.label.shared_connections_are_opted_out_for_the_current_account'
                )
            );
            return;
        }
        const friendSnapshot = rosterRows.filter((friend) =>
            normalizeId(friend?.id)
        );
        if (!friendSnapshot.length) {
            toast.info(
                t(
                    'view.friend_list.empty.no_friends_are_available_for_mutual_friends_loading'
                )
            );
            return;
        }
        setMutualProgress({
            current: 0,
            total: friendSnapshot.length
        });
        try {
            await startMutualGraphFetch({
                ownerUserId: currentUserId,
                endpoint: currentEndpoint,
                friendIds: friendSnapshot.map((friend) =>
                    normalizeId(friend?.id)
                )
            });
            startMutualGraphFetchStatusPolling();
            toast.info(t('view.charts.mutual_friend.prompt.message'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.charts.toast.failed_to_fetch_mutual_friends_graph'
                      )
            );
        }
    }

    function openFriendDetails(friend: FriendListRow) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined
        });
    }

    return {
        confirmDeleteFriend,
        isMutualFetching,
        isLoadingUserDetails,
        bulkUnfriendSelected,
        loadFriendUserDetails,
        loadMutualFriends,
        openFriendDetails,
        resetFriendListTableLayout: resetTableLayout,
        toggleSelectedFriend
    };
}
