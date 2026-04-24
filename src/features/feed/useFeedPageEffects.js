import { useEffect } from 'react';
export function useFeedPageEffects({
    DEFAULT_PAGE_SIZES,
    FEED_FILTER_TYPES,
    activeFilters,
    collectMatchingLiveFeedEntries,
    columnOrder,
    columnOrderLocked,
    columnSizing,
    columnVisibility,
    configRepository,
    currentUserId,
    dateFilterOpen,
    dateFrom,
    dateTo,
    deferredSearchQuery,
    favoriteIdSet,
    favoritesOnly,
    feedRepository,
    friendLogNamesById,
    friendLogRepository,
    friendRosterLastLoadedAt,
    gameLogRepository,
    getTablePageSizePreference,
    getTablePageSizesPreference,
    hasWrittenColumnVisibilityRef,
    hasWrittenPageSizeRef,
    hasWrittenSortingRef,
    hasWrittenTableLayoutRef,
    isFavoritesLoaded,
    lastLiveFeedSequenceRef,
    maxFeedRows,
    mergeLiveFeedEntries,
    normalizeId,
    pagination,
    persistedPageSize,
    preferencesHydrated,
    preferencesReady,
    requestIdRef,
    resolveDisplayNameCandidate,
    resolveFeedUserId,
    resolvePageSize,
    rows,
    safeJsonParse,
    sanitizeColumnOrder,
    sanitizeColumnSizing,
    sanitizeColumnVisibility,
    sanitizePageSizes,
    sanitizeSorting,
    setDateDraftFrom,
    setDateDraftTo,
    setFavoritesOnly,
    setFeedFilters,
    setFriendLogNamesById,
    setLoadStatus,
    setPageSizes,
    setPagination,
    setPreferencesReady,
    setRows,
    sorting,
    tablePageSizesPreference,
    toIsoRangeEnd,
    toIsoRangeStart,
    useFeedLiveStore,
    writePersistedState
}) {
    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId]);
    useEffect(() => {
        let active = true;
        const normalizedCurrentUserId = normalizeId(currentUserId);
        if (!normalizedCurrentUserId) {
            setFriendLogNamesById({});
            return () => {
                active = false;
            };
        }
        friendLogRepository
            .getFriendLogCurrent(normalizedCurrentUserId)
            .then((entries) => {
                if (!active) {
                    return;
                }
                const nextNamesById = {};
                for (const entry of Array.isArray(entries) ? entries : []) {
                    const userId = normalizeId(entry?.userId);
                    const displayName = resolveDisplayNameCandidate(
                        entry?.displayName,
                        userId
                    );
                    if (userId && displayName) {
                        nextNamesById[userId] = displayName;
                    }
                }
                setFriendLogNamesById(nextNamesById);
            })
            .catch(() => {
                if (active) {
                    setFriendLogNamesById({});
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, friendRosterLastLoadedAt]);
    useEffect(() => {
        const missingUserIds = [];
        const seenUserIds = new Set();
        for (const row of rows) {
            const userId = resolveFeedUserId(row);
            if (
                !userId ||
                friendLogNamesById[userId] ||
                seenUserIds.has(userId)
            ) {
                continue;
            }
            if (resolveDisplayNameCandidate(row?.displayName, userId)) {
                continue;
            }
            seenUserIds.add(userId);
            missingUserIds.push(userId);
            if (missingUserIds.length >= 100) {
                break;
            }
        }
        if (missingUserIds.length === 0) {
            return undefined;
        }
        let active = true;
        gameLogRepository
            .getAllUserStats({
                userIds: missingUserIds
            })
            .then((statsRows) => {
                if (!active) {
                    return;
                }
                setFriendLogNamesById((current) => {
                    let changed = false;
                    const nextNamesById = {
                        ...current
                    };
                    for (const row of Array.isArray(statsRows)
                        ? statsRows
                        : []) {
                        const userId = normalizeId(row?.userId);
                        const displayName = resolveDisplayNameCandidate(
                            row?.displayName,
                            userId
                        );
                        if (userId && displayName && !nextNamesById[userId]) {
                            nextNamesById[userId] = displayName;
                            changed = true;
                        }
                    }
                    return changed ? nextNamesById : current;
                });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [friendLogNamesById, rows]);
    useEffect(() => {
        if (dateFilterOpen) {
            setDateDraftFrom(dateFrom);
            setDateDraftTo(dateTo);
        }
    }, [dateFilterOpen, dateFrom, dateTo]);
    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('feedTableFilters', '[]'),
            configRepository.getBool('VRCX_feedTableVIPFilter', false),
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([savedFilters, savedVip, savedPageSizes, savedPageSize]) => {
                if (!active) {
                    return;
                }
                const parsedFilters = safeJsonParse(savedFilters);
                const nextPageSizes = sanitizePageSizes(savedPageSizes);
                const resolvedSavedPageSize = resolvePageSize(
                    savedPageSize,
                    nextPageSizes
                );
                const resolvedActivePageSize = Number.isFinite(
                    persistedPageSize
                )
                    ? resolvePageSize(
                          persistedPageSize,
                          nextPageSizes,
                          resolvedSavedPageSize
                      )
                    : resolvedSavedPageSize;
                setFeedFilters(
                    Array.isArray(parsedFilters)
                        ? parsedFilters.filter((filter) =>
                              FEED_FILTER_TYPES.includes(filter)
                          )
                        : []
                );
                setFavoritesOnly(Boolean(savedVip));
                setPageSizes(nextPageSizes);
                setPagination((current) => ({
                    ...current,
                    pageSize: resolvedActivePageSize
                }));
                setPreferencesReady(true);
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setPreferencesReady(true);
            });
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const nextPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(nextPageSizes);
        setPagination((current) => {
            const pageSize = resolvePageSize(current.pageSize, nextPageSizes);
            return pageSize === current.pageSize
                ? current
                : {
                      ...current,
                      pageSize
                  };
        });
    }, [preferencesHydrated, tablePageSizesPreference]);
    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        void configRepository.setString(
            'VRCX_feedTableFilters',
            JSON.stringify(activeFilters)
        );
    }, [activeFilters, preferencesReady]);
    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        void configRepository.setBool('VRCX_feedTableVIPFilter', favoritesOnly);
    }, [favoritesOnly, preferencesReady]);
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
        if (!hasWrittenColumnVisibilityRef.current) {
            hasWrittenColumnVisibilityRef.current = true;
            return;
        }
        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility)
        });
    }, [columnVisibility]);
    useEffect(() => {
        if (!hasWrittenTableLayoutRef.current) {
            hasWrittenTableLayoutRef.current = true;
            return;
        }
        writePersistedState({
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing]);
    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [activeFilters, dateFrom, dateTo, deferredSearchQuery, favoritesOnly]);
    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setLoadStatus('idle');
            return;
        }
        if (favoritesOnly && !isFavoritesLoaded) {
            requestIdRef.current += 1;
            setLoadStatus('idle');
            setRows([]);
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];
        const liveFeedSequenceAtRequestStart =
            useFeedLiveStore.getState().version;
        const liveFeedContext = {
            currentUserId,
            activeFilters,
            dateFrom,
            dateTo,
            favoriteIdSet,
            favoritesOnly,
            search: deferredSearchQuery
        };
        setLoadStatus('running');
        feedRepository
            .queryFeed({
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo)
            })
            .then((nextRows) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                const liveFeedSnapshot = useFeedLiveStore.getState();
                const { matchingEntries, maxSequence } =
                    collectMatchingLiveFeedEntries(
                        liveFeedSnapshot.entries,
                        liveFeedSequenceAtRequestStart,
                        liveFeedContext
                    );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }
                setRows(
                    mergeLiveFeedEntries(nextRows, matchingEntries, maxFeedRows)
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows([]);
                setLoadStatus('error');
                console.error(error);
            });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        isFavoritesLoaded,
        maxFeedRows,
        preferencesReady
    ]);
    useEffect(() => {
        if (!preferencesReady || !currentUserId) {
            return undefined;
        }
        return useFeedLiveStore.subscribe((state, previousState) => {
            if (
                state.version === previousState?.version ||
                state.entries.length === 0
            ) {
                return;
            }
            const { matchingEntries, maxSequence } =
                collectMatchingLiveFeedEntries(
                    state.entries,
                    lastLiveFeedSequenceRef.current,
                    {
                        currentUserId,
                        activeFilters,
                        dateFrom,
                        dateTo,
                        favoriteIdSet,
                        favoritesOnly,
                        search: deferredSearchQuery
                    }
                );
            if (maxSequence > lastLiveFeedSequenceRef.current) {
                lastLiveFeedSequenceRef.current = maxSequence;
            }
            if (!matchingEntries.length) {
                return;
            }
            setRows((current) =>
                mergeLiveFeedEntries(current, matchingEntries, maxFeedRows)
            );
        });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        maxFeedRows,
        preferencesReady
    ]);
    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(rows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [pagination.pageIndex, pagination.pageSize, rows.length]);
}
