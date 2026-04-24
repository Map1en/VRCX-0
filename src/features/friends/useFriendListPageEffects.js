import { useEffect } from 'react';
export function useFriendListPageEffects({
    DEFAULT_PAGE_SIZES,
    activeSearchFilterIds,
    applyFriendPatches,
    buildUserStatsById,
    bulkUnfriendMode,
    columnOrder,
    columnOrderLocked,
    columnSizing,
    columnVisibility,
    currentUserId,
    favoritesOnly,
    filteredRows,
    gameLogRepository,
    getTablePageSizePreference,
    getTablePageSizesPreference,
    hasWrittenPageSizeRef,
    hasWrittenSortingRef,
    hasWrittenTableStateRef,
    isFavoritesLoaded,
    memoRepository,
    mutualGraphRepository,
    normalizeId,
    pagination,
    persistedState,
    preferencesHydrated,
    resolvePageSize,
    rosterRows,
    rosterStatsKey,
    sanitizeColumnOrder,
    sanitizeColumnSizing,
    sanitizeColumnVisibility,
    sanitizePageSizes,
    sanitizeSorting,
    searchQuery,
    setFavoritesOnly,
    setPageSizes,
    setPagination,
    setSelectedFriendIds,
    setUserMemoById,
    setUserNoteById,
    sorting,
    statsHydrationRequestRef,
    tablePageSizesPreference,
    writePersistedState
}) {
    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([nextPageSizes, nextPageSize]) => {
                if (!active) {
                    return;
                }
                const resolvedPageSizes = sanitizePageSizes(nextPageSizes);
                const parsedPersistedPageSize = Number.parseInt(
                    persistedState.pageSize,
                    10
                );
                const hasPersistedPageSize =
                    Number.isFinite(parsedPersistedPageSize) &&
                    parsedPersistedPageSize > 0;
                const resolvedConfiguredPageSize = resolvePageSize(
                    nextPageSize,
                    resolvedPageSizes,
                    DEFAULT_PAGE_SIZES[1]
                );
                const resolvedActivePageSize = hasPersistedPageSize
                    ? resolvePageSize(
                          parsedPersistedPageSize,
                          resolvedPageSizes,
                          resolvedConfiguredPageSize
                      )
                    : resolvedConfiguredPageSize;
                setPageSizes(resolvedPageSizes);
                setPagination((current) => ({
                    ...current,
                    pageSize: resolvedActivePageSize
                }));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [persistedState.pageSize]);
    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(resolvedPageSizes);
        setPagination((current) => {
            const pageSize = resolvePageSize(
                current.pageSize,
                resolvedPageSizes
            );
            return pageSize === current.pageSize
                ? current
                : {
                      ...current,
                      pageSize
                  };
        });
    }, [preferencesHydrated, tablePageSizesPreference]);
    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }
        writePersistedState({
            sorting: sanitizeSorting(sorting)
        });
    }, [sorting]);
    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        writePersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);
    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility),
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);
    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [searchQuery, favoritesOnly, activeSearchFilterIds]);
    useEffect(() => {
        if (!isFavoritesLoaded && favoritesOnly) {
            setFavoritesOnly(false);
        }
    }, [favoritesOnly, isFavoritesLoaded]);
    useEffect(() => {
        let active = true;
        Promise.all([
            memoRepository.getAllUserMemos(),
            memoRepository.getAllUserNotes(currentUserId)
        ])
            .then(([memoRows, noteRows]) => {
                if (!active) {
                    return;
                }
                const nextMemos = new Map();
                for (const row of Array.isArray(memoRows) ? memoRows : []) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextMemos.set(userId, row?.memo || '');
                    }
                }
                const nextNotes = new Map();
                for (const row of Array.isArray(noteRows) ? noteRows : []) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextNotes.set(userId, row?.note || '');
                    }
                }
                setUserMemoById(nextMemos);
                setUserNoteById(nextNotes);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId]);
    useEffect(() => {
        if (!rosterRows.length) {
            return undefined;
        }
        let active = true;
        const requestId = statsHydrationRequestRef.current + 1;
        statsHydrationRequestRef.current = requestId;
        const userIds = rosterRows
            .map((friend) => normalizeId(friend?.id))
            .filter(Boolean);
        const displayNames = rosterRows
            .map((friend) => String(friend?.displayName || '').trim())
            .filter(Boolean);
        const mutualSnapshotPromise = currentUserId
            ? mutualGraphRepository
                  .getSnapshot(currentUserId)
                  .then(({ snapshot, meta }) => {
                      const countMap = new Map();
                      for (const [friendId, mutualIds] of snapshot) {
                          countMap.set(friendId, mutualIds.length);
                      }
                      return [countMap, meta];
                  })
            : Promise.resolve([new Map(), new Map()]);
        Promise.all([
            gameLogRepository.getAllUserStats({
                userIds,
                displayNames
            }),
            mutualSnapshotPromise
        ])
            .then(([statsRows, [mutualCountMap, mutualMetaMap]]) => {
                if (!active || statsHydrationRequestRef.current !== requestId) {
                    return;
                }
                const statsById = buildUserStatsById(statsRows, rosterRows);
                const patches = [];
                for (const friend of rosterRows) {
                    const friendId = normalizeId(friend?.id);
                    if (!friendId) {
                        continue;
                    }
                    const stats = statsById.get(friendId);
                    const mutualCount =
                        Number.parseInt(
                            mutualCountMap instanceof Map
                                ? mutualCountMap.get(friendId)
                                : 0,
                            10
                        ) || 0;
                    const mutualOptedOut = Boolean(
                        mutualMetaMap instanceof Map
                            ? mutualMetaMap.get(friendId)?.optedOut
                            : false
                    );
                    const patch = {
                        $mutualCount: mutualCount,
                        $mutualOptedOut: mutualOptedOut
                    };
                    if (stats) {
                        patch.$joinCount = stats.joinCount;
                        patch.$lastSeen = stats.lastSeen;
                        patch.$timeSpent = stats.timeSpent;
                    }
                    if (
                        (stats &&
                            (friend.$joinCount !== patch.$joinCount ||
                                friend.$lastSeen !== patch.$lastSeen ||
                                friend.$timeSpent !== patch.$timeSpent)) ||
                        (Number.parseInt(friend.$mutualCount ?? 0, 10) || 0) !==
                            mutualCount ||
                        Boolean(friend.$mutualOptedOut) !== mutualOptedOut
                    ) {
                        patches.push({
                            userId: friendId,
                            patch,
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                    }
                }
                if (patches.length) {
                    applyFriendPatches(patches);
                }
            })
            .catch((error) => {
                console.warn(
                    '[FriendListPage] Failed to hydrate friend stats',
                    error
                );
            });
        return () => {
            active = false;
        };
    }, [applyFriendPatches, currentUserId, rosterStatsKey]);
    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(filteredRows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [filteredRows.length, pagination.pageIndex, pagination.pageSize]);
    useEffect(() => {
        if (!bulkUnfriendMode) {
            setSelectedFriendIds(new Set());
        }
    }, [bulkUnfriendMode]);
    useEffect(() => {
        const visibleFriendIds = new Set(
            filteredRows
                .map((friend) => normalizeId(friend?.id))
                .filter(Boolean)
        );
        setSelectedFriendIds((current) => {
            const next = new Set(
                [...current].filter((friendId) =>
                    visibleFriendIds.has(friendId)
                )
            );
            return next.size === current.size ? current : next;
        });
    }, [filteredRows]);
}
