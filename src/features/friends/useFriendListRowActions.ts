import {
    useEffect,
    useRef,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import friendRelationshipService from '@/services/friendRelationshipService';
import {
    startMutualGraphFetch,
    startMutualGraphFetchStatusPolling
} from '@/services/mutualGraphFetchService';
import {
    executeWithBackoff,
    isBackoffCancelledError
} from '@/shared/utils/retry';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { normalizeFriendListId as normalizeId } from './friendListRows';

const FRIEND_PROFILE_LOAD_CONCURRENCY = 3;
const FRIEND_PROFILE_LOAD_MAX_RETRIES = 4;
const FRIEND_PROFILE_LOAD_BASE_DELAY_MS = 500;

function isRateLimitedError(error: any) {
    return (
        error?.status === 429 || String(error?.message || '').includes('429')
    );
}

export function useFriendListRowActions({
    cancelUserLoadRef,
    filteredRows,
    isLoadingUserDetails,
    resetTableLayout,
    rosterRows,
    selectedFriendIds,
    setDeletingFriendIds,
    setIsBulkDeleting,
    setIsLoadingUserDetails,
    setMutualProgress,
    setSelectedFriendIds,
    setUserLoadProgress
}: {
    cancelUserLoadRef: MutableRefObject<boolean>;
    filteredRows: any[];
    isLoadingUserDetails: boolean;
    resetTableLayout(): void;
    rosterRows: any[];
    selectedFriendIds: Set<unknown>;
    setDeletingFriendIds: Dispatch<SetStateAction<Set<unknown>>>;
    setIsBulkDeleting(value: boolean): void;
    setIsLoadingUserDetails(value: boolean): void;
    setMutualProgress(value: any): void;
    setSelectedFriendIds: Dispatch<SetStateAction<Set<unknown>>>;
    setUserLoadProgress(value: any): void;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const applyFriendPatch = useFriendRosterStore(
        (state: any) => state.applyFriendPatch
    );
    const confirm = useModalStore((state: any) => state.confirm);
    const mutualGraphRunId = useRuntimeStore(
        (state: any) => state.mutualGraph.runId
    );
    const mutualGraphStatus = useRuntimeStore(
        (state: any) => state.mutualGraph.status
    );
    const mutualGraphOwnerUserId = useRuntimeStore(
        (state: any) => state.mutualGraph.ownerUserId
    );
    const mutualGraphProcessedFriends = useRuntimeStore(
        (state: any) => state.mutualGraph.processedFriends
    );
    const mutualGraphTotalFriends = useRuntimeStore(
        (state: any) => state.mutualGraph.totalFriends
    );
    const handledMutualGraphRunRef = useRef(0);
    const isMutualFetching =
        mutualGraphOwnerUserId === currentUserId &&
        (mutualGraphStatus === 'running' || mutualGraphStatus === 'cancelling');

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
            applyCachedMutualFriendStats(currentUserId).catch((error: any) => {
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

    function setFriendDeleting(userId: any, isDeleting: any) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        setDeletingFriendIds((current: any) => {
            const next = new Set(current);
            if (isDeleting) {
                next.add(normalizedUserId);
            } else {
                next.delete(normalizedUserId);
            }
            return next;
        });
    }

    function toggleSelectedFriend(userId: any) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        setSelectedFriendIds((current: any) => {
            const next = new Set(current);
            if (next.has(normalizedUserId)) {
                next.delete(normalizedUserId);
            } else {
                next.add(normalizedUserId);
            }
            return next;
        });
    }

    async function deleteFriendById(userId: any) {
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
                setSelectedFriendIds((current: any) => {
                    const next = new Set(current);
                    next.delete(normalizedUserId);
                    return next;
                });
                toast.success(
                    t('view.friends.dynamic.unfriended_value', {
                        value: friend.displayName || normalizedUserId
                    })
                );
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

    async function confirmDeleteFriend(friend: any) {
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
        const selectedRows = filteredRows.filter((friend: any) =>
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
                .map((friend: any) => friend.displayName || friend.id)
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

    async function loadFriendUserDetails() {
        if (isLoadingUserDetails) {
            return;
        }
        const rowsToFetch = rosterRows.filter(
            (friend: any) => normalizeId(friend?.id) && !friend?.date_joined
        );
        if (!rowsToFetch.length) {
            toast.success(
                t('view.friend_list.label.friend_details_are_already_loaded')
            );
            return;
        }
        cancelUserLoadRef.current = false;
        setIsLoadingUserDetails(true);
        setUserLoadProgress({
            current: 0,
            total: rowsToFetch.length,
            open: true,
            cancelled: false
        });
        let loadedCount = 0;
        let nextRowIndex = 0;
        try {
            async function loadNextFriendProfile() {
                while (!cancelUserLoadRef.current) {
                    const friend = rowsToFetch[nextRowIndex];
                    nextRowIndex += 1;
                    if (!friend) {
                        return;
                    }

                    const friendId = normalizeId(friend?.id);
                    try {
                        const profile = await executeWithBackoff(
                            () =>
                                userProfileRepository.getUserProfile({
                                    userId: friendId,
                                    endpoint: currentEndpoint
                                }),
                            {
                                maxRetries: FRIEND_PROFILE_LOAD_MAX_RETRIES,
                                baseDelay: FRIEND_PROFILE_LOAD_BASE_DELAY_MS,
                                shouldRetry: isRateLimitedError,
                                isCancelled: () => cancelUserLoadRef.current
                            }
                        );
                        if (!cancelUserLoadRef.current && profile?.id) {
                            applyFriendPatch({
                                userId: friendId,
                                patch: profile,
                                stateBucket:
                                    friend.stateBucket ||
                                    friend.state ||
                                    'offline'
                            });
                            loadedCount += 1;
                        }
                    } catch (error) {
                        if (
                            isBackoffCancelledError(error) ||
                            cancelUserLoadRef.current
                        ) {
                            return;
                        }
                        console.warn(
                            '[FriendListPage] Failed to load friend profile',
                            friendId,
                            error
                        );
                    } finally {
                        setUserLoadProgress((current: any) => ({
                            ...current,
                            current: Math.min(
                                current.total,
                                current.current + 1
                            )
                        }));
                    }
                }
            }

            const workerCount = Math.min(
                FRIEND_PROFILE_LOAD_CONCURRENCY,
                rowsToFetch.length
            );
            await Promise.all(
                Array.from({ length: workerCount }, () =>
                    loadNextFriendProfile()
                )
            );
            if (cancelUserLoadRef.current) {
                toast.warning(
                    t(
                        'view.friend_list.success.friend_detail_loading_cancelled'
                    )
                );
                return;
            }
            toast.success(
                t('view.friends.dynamic.loaded_value_friend_profiles', {
                    value: loadedCount
                })
            );
        } finally {
            setIsLoadingUserDetails(false);
            if (!cancelUserLoadRef.current) {
                setUserLoadProgress((current: any) => ({
                    ...current,
                    open: false
                }));
            }
        }
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
        const friendSnapshot = rosterRows.filter((friend: any) =>
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
                friendIds: friendSnapshot.map((friend: any) =>
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

    function openFriendDetails(friend: any) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined
        });
    }

    return {
        confirmDeleteFriend,
        isMutualFetching,
        bulkUnfriendSelected,
        loadFriendUserDetails,
        loadMutualFriends,
        openFriendDetails,
        resetFriendListTableLayout: resetTableLayout,
        toggleSelectedFriend
    };
}
