import { useEffect, useRef } from 'react';
export function useFeedPageEffects({
    DEFAULT_PAGE_SIZES,
    FEED_FILTER_TYPES,
    activeFilters,
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
    const rowsRef = useRef(rows);
    const liveMergeRequestIdRef = useRef(0);
    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);
    async function mergeRowsWithLatestLive({
        rows,
        minLiveSequence,
        favoriteUserIds,
        requestIsCurrent
    }) {
        let result = {
            rows,
            maxSequence: minLiveSequence
        };
        let previousMaxSequence = minLiveSequence;
        while (requestIsCurrent()) {
            const liveFeedSnapshot = useFeedLiveStore.getState();
            result = await feedRepository.mergeLiveRows({
                rows: result.rows,
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo),
                liveEntries: liveFeedSnapshot.entries,
                minLiveSequence: result.maxSequence,
                favoritesOnly,
                maxRows: maxFeedRows
            });
            if (!requestIsCurrent()) {
                return null;
            }
            const liveVersion = useFeedLiveStore.getState().version;
            if (
                liveVersion <= result.maxSequence ||
                result.maxSequence <= previousMaxSequence
            ) {
                return result;
            }
            previousMaxSequence = result.maxSequence;
        }
        return null;
    }
    async function prepareFullQueryRowsForCommit({
        result,
        favoriteUserIds,
        requestIsCurrent
    }) {
        let nextResult = result;
        while (requestIsCurrent()) {
            liveMergeRequestIdRef.current += 1;
            if (
                useFeedLiveStore.getState().version <= nextResult.maxSequence
            ) {
                return nextResult;
            }
            const mergedResult = await mergeRowsWithLatestLive({
                rows: nextResult.rows,
                favoriteUserIds,
                minLiveSequence: nextResult.maxSequence,
                requestIsCurrent
            });
            if (!mergedResult) {
                return null;
            }
            nextResult = mergedResult;
        }
        return null;
    }
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
        setLoadStatus('running');
        feedRepository
            .queryFeedReadModel({
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo),
                liveEntries: [],
                minLiveSequence: liveFeedSequenceAtRequestStart,
                favoritesOnly,
                maxRows: maxFeedRows
            })
            .then(async (result) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                const mergedResult = await mergeRowsWithLatestLive({
                    rows: result.rows,
                    favoriteUserIds,
                    minLiveSequence: result.maxSequence,
                    requestIsCurrent: () => requestIdRef.current === requestId
                });
                if (!mergedResult || requestIdRef.current !== requestId) {
                    return;
                }
                const commitResult = await prepareFullQueryRowsForCommit({
                    result: mergedResult,
                    favoriteUserIds,
                    requestIsCurrent: () => requestIdRef.current === requestId
                });
                if (!commitResult || requestIdRef.current !== requestId) {
                    return;
                }
                const maxSequence = Math.max(
                    commitResult.maxSequence,
                    liveFeedSequenceAtRequestStart
                );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }
                rowsRef.current = commitResult.rows;
                setRows(commitResult.rows);
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
        liveMergeRequestIdRef.current += 1;
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
            const mergeRequestId = liveMergeRequestIdRef.current + 1;
            liveMergeRequestIdRef.current = mergeRequestId;
            const minLiveSequence = lastLiveFeedSequenceRef.current;
            void mergeRowsWithLatestLive({
                rows: rowsRef.current,
                favoriteUserIds: favoritesOnly ? Array.from(favoriteIdSet) : [],
                minLiveSequence,
                requestIsCurrent: () =>
                    liveMergeRequestIdRef.current === mergeRequestId
            })
                .then((result) => {
                    if (!result) {
                        return;
                    }
                    if (liveMergeRequestIdRef.current !== mergeRequestId) {
                        return;
                    }
                    if (result.maxSequence > lastLiveFeedSequenceRef.current) {
                        lastLiveFeedSequenceRef.current = result.maxSequence;
                    }
                    rowsRef.current = result.rows;
                    setRows(result.rows);
                })
                .catch((error) => {
                    console.error(error);
                });
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
