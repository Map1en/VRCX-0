import { useEffect } from 'react';
export function useGameLogPageEffects({
    GAME_LOG_DEFAULT_PAGE_SIZES,
    GAME_LOG_FILTER_TYPES,
    SESSION_FILTER_TYPES,
    addGameLogEventCount,
    annotatedRows,
    columnOrder,
    columnOrderLocked,
    columnSizing,
    columnVisibility,
    configRepository,
    currentUserId,
    deferredSearchQuery,
    favoriteIdSet,
    favoritesOnly,
    gameLogDisabled,
    gameLogRepository,
    getTablePageSizePreference,
    getTablePageSizesPreference,
    hasWrittenPageSizeRef,
    hasWrittenSortingRef,
    hasWrittenTableStateRef,
    isFavoritesLoaded,
    isoToGameLogDateInputValue,
    pagination,
    persistedState,
    preferencesHydrated,
    preferencesReady,
    preferencesReadyRef,
    queryFilterTypes,
    refreshToken,
    requestIdRef,
    resolveGameLogPageSize,
    safeJsonParse,
    sanitizeGameLogColumnOrder,
    sanitizeGameLogColumnSizing,
    sanitizeGameLogColumnVisibility,
    sanitizeGameLogPageSizes,
    sanitizeGameLogSorting,
    savedViewMode,
    searchQuery,
    sessionDateFrom,
    sessionDatePopoverOpen,
    sessionDateTo,
    sessionFavoritesOnly,
    sessionLimit,
    sessionSelectedTypes,
    setDetail,
    setLoadStatus,
    setPageSizes,
    setPagination,
    setPreferencesReady,
    setRows,
    setSavedViewMode,
    setSearchDraft,
    setSessionDateDraftFrom,
    setSessionDateDraftTo,
    setSessionDateFrom,
    setSessionDateTo,
    setSessionFavoritesOnly,
    setSessionLimit,
    setSessionSelectedTypes,
    setSessions,
    setShiftHeld,
    setTableFavoritesOnly,
    setTableSelectedTypes,
    sorting,
    t,
    tableFavoritesOnly,
    tablePageSizesPreference,
    tableSelectedTypes,
    userFacingErrorMessage,
    writePersistedGameLogState
}) {
    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        }
        function handleKeyUp(event) {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        }
        function handleBlur() {
            setShiftHeld(false);
        }
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);
    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(GAME_LOG_DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20),
            configRepository.getString('gameLogTableFilters', '[]'),
            configRepository.getBool('VRCX_gameLogTableVIPFilter', false),
            configRepository.getString('gameLogSessionsFilters', '[]'),
            configRepository.getBool('VRCX_gameLogSessionsVIPFilter', false),
            configRepository.getString('gameLogSessionsDateFrom', ''),
            configRepository.getString('gameLogSessionsDateTo', ''),
            configRepository.getString('gameLogViewMode', 'sessions')
        ])
            .then(
                ([
                    nextPageSizes,
                    nextPageSize,
                    nextTableTypeFilters,
                    nextTableFavoritesOnly,
                    nextSessionTypeFilters,
                    nextSessionFavoritesOnly,
                    nextSessionDateFrom,
                    nextSessionDateTo,
                    nextSavedViewMode
                ]) => {
                    if (!active) {
                        return;
                    }
                    const resolvedPageSizes =
                        sanitizeGameLogPageSizes(nextPageSizes);
                    const parsedPersistedPageSize = Number.parseInt(
                        persistedState.pageSize,
                        10
                    );
                    const hasPersistedPageSize =
                        Number.isFinite(parsedPersistedPageSize) &&
                        parsedPersistedPageSize > 0;
                    const resolvedConfiguredPageSize = resolveGameLogPageSize(
                        nextPageSize,
                        resolvedPageSizes,
                        GAME_LOG_DEFAULT_PAGE_SIZES[1]
                    );
                    const resolvedActivePageSize = hasPersistedPageSize
                        ? resolveGameLogPageSize(
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
                    setSessionLimit(resolvedActivePageSize);
                    const parsedTableFilters =
                        safeJsonParse(nextTableTypeFilters);
                    const parsedSessionFilters = safeJsonParse(
                        nextSessionTypeFilters
                    );
                    setTableSelectedTypes(
                        Array.isArray(parsedTableFilters)
                            ? parsedTableFilters.filter((entry) =>
                                  GAME_LOG_FILTER_TYPES.includes(entry)
                              )
                            : []
                    );
                    setSessionSelectedTypes(
                        Array.isArray(parsedSessionFilters)
                            ? parsedSessionFilters.filter((entry) =>
                                  SESSION_FILTER_TYPES.includes(entry)
                              )
                            : []
                    );
                    setTableFavoritesOnly(Boolean(nextTableFavoritesOnly));
                    setSessionFavoritesOnly(Boolean(nextSessionFavoritesOnly));
                    setSessionDateFrom(String(nextSessionDateFrom || ''));
                    setSessionDateTo(String(nextSessionDateTo || ''));
                    setSessionDateDraftFrom(
                        isoToGameLogDateInputValue(nextSessionDateFrom)
                    );
                    setSessionDateDraftTo(
                        isoToGameLogDateInputValue(nextSessionDateTo)
                    );
                    setSavedViewMode(
                        nextSavedViewMode === 'sessions' ||
                            nextSavedViewMode === 'table'
                            ? nextSavedViewMode
                            : 'table'
                    );
                    preferencesReadyRef.current = true;
                    setPreferencesReady(true);
                }
            )
            .catch(() => {
                if (!active) {
                    return;
                }
                preferencesReadyRef.current = true;
                setPreferencesReady(true);
            });
        return () => {
            active = false;
        };
    }, [persistedState.pageSize]);
    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizeGameLogPageSizes(
            tablePageSizesPreference
        );
        setPageSizes(resolvedPageSizes);
        setPagination((current) => {
            const pageSize = resolveGameLogPageSize(
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
        setSessionLimit((current) =>
            resolveGameLogPageSize(current, resolvedPageSizes)
        );
    }, [preferencesHydrated, tablePageSizesPreference]);
    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        void configRepository.setString(
            'VRCX_gameLogTableFilters',
            JSON.stringify(tableSelectedTypes)
        );
    }, [tableSelectedTypes]);
    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        void configRepository.setBool(
            'VRCX_gameLogTableVIPFilter',
            tableFavoritesOnly
        );
    }, [tableFavoritesOnly]);
    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        void configRepository.setString(
            'VRCX_gameLogSessionsFilters',
            JSON.stringify(sessionSelectedTypes)
        );
    }, [sessionSelectedTypes]);
    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        void configRepository.setBool(
            'VRCX_gameLogSessionsVIPFilter',
            sessionFavoritesOnly
        );
    }, [sessionFavoritesOnly]);
    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        void configRepository.setString(
            'VRCX_gameLogSessionsDateFrom',
            sessionDateFrom
        );
    }, [sessionDateFrom]);
    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        void configRepository.setString(
            'VRCX_gameLogSessionsDateTo',
            sessionDateTo
        );
    }, [sessionDateTo]);
    useEffect(() => {
        setSearchDraft(searchQuery);
    }, [searchQuery]);
    useEffect(() => {
        if (sessionDatePopoverOpen) {
            return;
        }
        setSessionDateDraftFrom(isoToGameLogDateInputValue(sessionDateFrom));
        setSessionDateDraftTo(isoToGameLogDateInputValue(sessionDateTo));
    }, [sessionDateFrom, sessionDatePopoverOpen, sessionDateTo]);
    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }
        writePersistedGameLogState({
            sorting: sanitizeGameLogSorting(sorting)
        });
    }, [sorting]);
    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        writePersistedGameLogState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);
    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writePersistedGameLogState({
            columnVisibility: sanitizeGameLogColumnVisibility(columnVisibility),
            columnOrder: sanitizeGameLogColumnOrder(columnOrder),
            columnSizing: sanitizeGameLogColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);
    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
        setSessionLimit(pagination.pageSize);
    }, [
        deferredSearchQuery,
        pagination.pageSize,
        savedViewMode,
        sessionDateFrom,
        sessionDateTo,
        sessionFavoritesOnly,
        sessionSelectedTypes,
        tableFavoritesOnly,
        tableSelectedTypes
    ]);
    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!preferencesReady || !currentUserId) {
            if (!currentUserId) {
                setRows([]);
                setSessions([]);
                setLoadStatus('idle');
                setDetail(
                    t(
                        'view.game_log.generated.no_authenticated_user_is_available_for_the_game_log_snapshot'
                    )
                );
            }
            return;
        }
        if (gameLogDisabled) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail(t('view.game_log.generated.game_log_is_disabled'));
            return;
        }
        if (favoritesOnly && !isFavoritesLoaded) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail(
                t('view.game_log.generated.favorites_are_still_hydrating')
            );
            return;
        }
        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];
        setLoadStatus('running');
        setDetail('');
        gameLogRepository[
            savedViewMode === 'sessions'
                ? 'queryLatestSessions'
                : 'queryGameLog'
        ]({
            currentUserId,
            search: deferredSearchQuery,
            filters: queryFilterTypes,
            favoriteUserIds,
            dateFrom: savedViewMode === 'sessions' ? sessionDateFrom : '',
            dateTo: savedViewMode === 'sessions' ? sessionDateTo : '',
            limit:
                savedViewMode === 'sessions'
                    ? sessionLimit
                    : pagination.pageSize
        })
            .then((nextResult) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                if (savedViewMode === 'sessions') {
                    setSessions(Array.isArray(nextResult) ? nextResult : []);
                    setRows([]);
                } else {
                    setRows(Array.isArray(nextResult) ? nextResult : []);
                    setSessions([]);
                }
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows([]);
                setSessions([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        t('view.game_log.generated.game_log_failed_to_load')
                    )
                );
            });
    }, [
        addGameLogEventCount,
        currentUserId,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        gameLogDisabled,
        isFavoritesLoaded,
        pagination.pageSize,
        preferencesReady,
        queryFilterTypes,
        refreshToken,
        savedViewMode,
        sessionDateFrom,
        sessionDateTo,
        sessionLimit
    ]);
    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(annotatedRows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [annotatedRows.length, pagination.pageIndex, pagination.pageSize]);
}
