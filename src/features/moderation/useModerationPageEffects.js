import { useEffect } from 'react';
export function useModerationPageEffects({
    DEFAULT_PAGE_SIZES,
    TYPE_FILTERS_CONFIG_KEY,
    columnOrder,
    columnOrderLocked,
    columnSizing,
    columnVisibility,
    configRepository,
    currentEndpoint,
    currentUserId,
    filteredRows,
    getTablePageSizePreference,
    getTablePageSizesPreference,
    hasWrittenPageSizeRef,
    hasWrittenSortingRef,
    hasWrittenTableStateRef,
    hydratedTypeFiltersRef,
    pagination,
    parseSelectedTypes,
    persistedState,
    preferencesHydrated,
    refreshToken,
    resolvePageSize,
    sanitizeColumnOrder,
    sanitizeColumnSizing,
    sanitizeColumnVisibility,
    sanitizePageSizes,
    sanitizeSorting,
    searchQuery,
    selectedTypes,
    setDetail,
    setLoadStatus,
    setPageSizes,
    setPagination,
    setRows,
    setSelectedTypes,
    setShiftHeld,
    sorting,
    tablePageSizesPreference,
    userFacingErrorMessage,
    vrchatModerationRepository,
    writePersistedState
}) {
    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20),
            configRepository.getString(TYPE_FILTERS_CONFIG_KEY, '[]')
        ])
            .then(([nextPageSizes, nextPageSize, nextTypeFilters]) => {
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
                setSelectedTypes(parseSelectedTypes(nextTypeFilters));
                hydratedTypeFiltersRef.current = true;
            })
            .catch(() => {
                hydratedTypeFiltersRef.current = true;
            });
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
        if (!hydratedTypeFiltersRef.current) {
            return;
        }
        void configRepository.setString(
            TYPE_FILTERS_CONFIG_KEY,
            JSON.stringify(selectedTypes)
        );
    }, [selectedTypes]);
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
    }, [searchQuery, selectedTypes]);
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        };
        const handleKeyUp = (event) => {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        };
        const handleBlur = () => setShiftHeld(false);
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
        if (!currentUserId) {
            setRows([]);
            setLoadStatus('idle');
            setDetail(
                'No authenticated user is available for the moderation snapshot.'
            );
            return () => {
                active = false;
            };
        }
        setLoadStatus('running');
        setDetail('');
        vrchatModerationRepository
            .getPlayerModerations({
                endpoint: currentEndpoint
            })
            .then(async (response) => {
                if (!active) {
                    return;
                }
                const nextRows = Array.isArray(response.json)
                    ? response.json
                    : [];
                await vrchatModerationRepository.syncLocalModerationSnapshot({
                    ownerUserId: currentUserId,
                    rows: nextRows
                });
                if (!active) {
                    return;
                }
                setRows(nextRows);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }
                setRows([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to load the moderation snapshot.'
                    )
                );
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, refreshToken]);
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
}
