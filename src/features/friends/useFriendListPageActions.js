export function useFriendListPageActions({
    applyFriendPatch,
    cancelUserLoadRef,
    confirm,
    createRateLimiter,
    currentEndpoint,
    currentUserId,
    currentUserSnapshot,
    executeWithBackoff,
    filteredRows,
    friendRelationshipService,
    friendsById,
    isLoadingUserDetails,
    isMutualFetching,
    mutualGraphRepository,
    normalizeId,
    openUserDialog,
    rosterRows,
    selectedFriendIds,
    setColumnOrder,
    setColumnSizing,
    setColumnVisibility,
    setDeletingFriendIds,
    setIsBulkDeleting,
    setIsLoadingUserDetails,
    setIsMutualFetching,
    setMutualProgress,
    setSelectedFriendIds,
    setUserLoadProgress,
    t,
    toast,
    vrchatFriendRepository
}) {
    function setFriendDeleting(userId, isDeleting) {
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
    function toggleSelectedFriend(userId) {
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
    async function deleteFriendById(userId) {
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
                toast.success(
                    t('view.friends.generated_dynamic.unfriended_value', {
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
                    : t(
                          'view.friends.generated_toast.failed_to_unfriend_value',
                          {
                              value: friend.displayName || normalizedUserId
                          }
                      )
            );
            return {
                stale: false,
                deleted: false
            };
        } finally {
            setFriendDeleting(normalizedUserId, false);
        }
    }
    async function confirmDeleteFriend(friend) {
        const normalizedUserId = normalizeId(friend?.id);
        if (!normalizedUserId) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.generated_modal.unfriend_user'),
            description: friend?.displayName || normalizedUserId,
            confirmText: t('view.friends.generated_modal.unfriend'),
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
            title: t('view.friends.generated_dynamic.unfriend_value_friends', {
                value: selectedRows.length
            }),
            description: selectedRows
                .map((friend) => friend.displayName || friend.id)
                .slice(0, 30)
                .join('\n'),
            confirmText: t('view.friends.generated_modal.unfriend'),
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
                    t(
                        'view.friends.generated_dynamic.unfriended_value_friends',
                        {
                            value: deletedCount
                        }
                    )
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
            (friend) => normalizeId(friend?.id) && !friend?.date_joined
        );
        if (!rowsToFetch.length) {
            toast.success(
                t(
                    'view.friend_list.generated.friend_details_are_already_loaded'
                )
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
        try {
            for (const friend of rowsToFetch) {
                if (cancelUserLoadRef.current) {
                    break;
                }
                const friendId = normalizeId(friend?.id);
                try {
                    const response = await vrchatFriendRepository.getUser({
                        userId: friendId,
                        endpoint: currentEndpoint
                    });
                    if (response?.json?.id) {
                        applyFriendPatch({
                            userId: friendId,
                            patch: response.json,
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                        loadedCount += 1;
                    }
                } catch (error) {
                    console.warn(
                        '[FriendListPage] Failed to load friend profile',
                        friendId,
                        error
                    );
                } finally {
                    setUserLoadProgress((current) => ({
                        ...current,
                        current: Math.min(current.total, current.current + 1)
                    }));
                }
            }
            if (cancelUserLoadRef.current) {
                toast.warning(
                    t(
                        'view.friend_list.generated.friend_detail_loading_cancelled'
                    )
                );
                return;
            }
            toast.success(
                t(
                    'view.friends.generated_dynamic.loaded_value_friend_profiles',
                    {
                        value: loadedCount
                    }
                )
            );
        } finally {
            setIsLoadingUserDetails(false);
            if (!cancelUserLoadRef.current) {
                setUserLoadProgress((current) => ({
                    ...current,
                    open: false
                }));
            }
        }
    }
    function cancelFriendUserDetailsLoad() {
        cancelUserLoadRef.current = true;
        setUserLoadProgress((current) => ({
            ...current,
            open: false,
            cancelled: true
        }));
    }
    async function fetchMutualFriendIds(friendId, rateLimiter) {
        const collected = [];
        let offset = 0;
        while (true) {
            await rateLimiter.wait();
            const response = await executeWithBackoff(
                () =>
                    mutualGraphRepository.getMutualFriends({
                        friendId,
                        offset,
                        n: 100
                    }),
                {
                    maxRetries: 4,
                    baseDelay: 500,
                    shouldRetry: (error) =>
                        error?.status === 429 ||
                        String(error?.message || '').includes('429')
                }
            );
            const rows = Array.isArray(response?.json) ? response.json : [];
            collected.push(
                ...rows
                    .map((entry) =>
                        normalizeId(
                            typeof entry === 'string' ? entry : entry?.id
                        )
                    )
                    .filter(Boolean)
            );
            if (rows.length < 100) {
                break;
            }
            offset += rows.length;
        }
        return collected;
    }
    async function loadMutualFriends() {
        if (!currentUserId || isMutualFetching) {
            return;
        }
        if (currentUserSnapshot?.hasSharedConnectionsOptOut) {
            toast.warning(
                t(
                    'view.friend_list.generated.shared_connections_are_opted_out_for_the_current_account'
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
                    'view.friend_list.generated.no_friends_are_available_for_mutual_friends_loading'
                )
            );
            return;
        }
        const rateLimiter = createRateLimiter({
            limitPerInterval: 5,
            intervalMs: 1000
        });
        const entries = new Map();
        const metaEntries = new Map();
        setIsMutualFetching(true);
        setMutualProgress({
            current: 0,
            total: friendSnapshot.length
        });
        try {
            for (let index = 0; index < friendSnapshot.length; index += 1) {
                const friend = friendSnapshot[index];
                const friendId = normalizeId(friend?.id);
                try {
                    const mutualIds = await fetchMutualFriendIds(
                        friendId,
                        rateLimiter
                    );
                    entries.set(friendId, mutualIds);
                    metaEntries.set(friendId, {
                        optedOut: false
                    });
                    applyFriendPatch({
                        userId: friendId,
                        patch: {
                            $mutualCount: mutualIds.length,
                            $mutualOptedOut: false
                        },
                        stateBucket:
                            friend.stateBucket || friend.state || 'offline'
                    });
                } catch (error) {
                    if (error?.status === 403 || error?.status === 404) {
                        metaEntries.set(friendId, {
                            optedOut: true
                        });
                        applyFriendPatch({
                            userId: friendId,
                            patch: {
                                $mutualCount: 0,
                                $mutualOptedOut: true
                            },
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                    } else {
                        console.warn(
                            '[FriendListPage] Skipping mutual friend fetch',
                            friendId,
                            error
                        );
                    }
                } finally {
                    setMutualProgress({
                        current: index + 1,
                        total: friendSnapshot.length
                    });
                }
            }
            await mutualGraphRepository.bulkUpsertMeta(
                currentUserId,
                metaEntries
            );
            await mutualGraphRepository.saveSnapshot(currentUserId, entries);
            toast.success(
                t('view.friend_list.generated.mutual_friends_loaded')
            );
        } finally {
            setIsMutualFetching(false);
        }
    }
    function resetFriendListTableLayout() {
        setColumnVisibility({});
        setColumnOrder([]);
        setColumnSizing({});
    }
    function openFriendDetails(friend) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined
        });
    }
    return {
        toggleSelectedFriend,
        confirmDeleteFriend,
        bulkUnfriendSelected,
        loadFriendUserDetails,
        cancelFriendUserDetailsLoad,
        loadMutualFriends,
        resetFriendListTableLayout,
        openFriendDetails
    };
}
