import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    LoadingState,
    PageBody,
    PageScaffold,
    PageToolbar
} from '@/components/layout/PageScaffold.jsx';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    configRepository,
    friendLogHistoryRepository
} from '@/repositories/index.js';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { buildFriendLogColumns } from './components/FriendLogColumns.jsx';
import { FriendLogPageTable } from './components/FriendLogPageTable.jsx';
import { FriendLogPageToolbar } from './components/FriendLogPageToolbar.jsx';
import { FriendLogEmptyState } from './components/FriendLogViewParts.jsx';
import {
    getFriendLogRowKey,
    matchesSearch,
    normalizeUserId,
    sortRows
} from './friendLogRows.js';
import {
    DEFAULT_PAGE_SIZES,
    parseTypeFilters,
    readPersistedState,
    resolvePageSize,
    sanitizeColumnOrder,
    sanitizeColumnSizing,
    sanitizeColumnVisibility,
    sanitizePageSizes,
    sanitizeSorting,
    writePersistedState
} from './friendLogState.js';

export function FriendLogPage({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const confirm = useModalStore((state) => state.confirm);

    const [persistedState] = useState(() => readPersistedState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const hydratedTypeFiltersRef = useRef(false);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const hideUnfriends = usePreferencesStore((state) => state.hideUnfriends);
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );

    const [rows, setRows] = useState([]);
    const [rowsOwnerUserId, setRowsOwnerUserId] = useState('');
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTypes, setSelectedTypes] = useState([]);
    const [deletingRowKey, setDeletingRowKey] = useState('');
    const [shiftHeld, setShiftHeld] = useState(false);
    const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZES);
    const [sorting, setSorting] = useState(() =>
        sanitizeSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolvePageSize(
            persistedState.pageSize,
            DEFAULT_PAGE_SIZES,
            DEFAULT_PAGE_SIZES[1]
        )
    }));
    const rowsOwnerUserIdRef = useRef('');

    function updateRowsOwnerUserId(ownerUserId) {
        const normalizedOwnerUserId = normalizeUserId(ownerUserId);
        rowsOwnerUserIdRef.current = normalizedOwnerUserId;
        setRowsOwnerUserId(normalizedOwnerUserId);
    }

    useEffect(() => {
        let active = true;

        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20),
            configRepository.getString('friendLogTableFilters', '[]')
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

                setSelectedTypes(parseTypeFilters(nextTypeFilters));
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
            'friendLogTableFilters',
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
    }, [searchQuery, selectedTypes, hideUnfriends]);

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

        if (!currentUserId) {
            setRows([]);
            updateRowsOwnerUserId('');
            setLoadStatus('idle');
            setDetail('No authenticated user is available for friend history.');
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');
        setRows([]);
        updateRowsOwnerUserId(currentUserId);

        friendLogHistoryRepository
            .getFriendLogHistory(currentUserId)
            .then((nextRows) => {
                if (!active) {
                    return;
                }

                setRows(Array.isArray(nextRows) ? nextRows : []);
                updateRowsOwnerUserId(currentUserId);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setRows([]);
                updateRowsOwnerUserId(currentUserId);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to load the friend history snapshot.'
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [currentUserId, refreshToken]);

    const filteredRows = useMemo(() => {
        const activeTypeSet = selectedTypes.length
            ? new Set(selectedTypes)
            : null;

        return rows.filter((row) => {
            if (hideUnfriends && row?.type === 'Unfriend') {
                return false;
            }
            if (activeTypeSet && !activeTypeSet.has(row?.type)) {
                return false;
            }
            return matchesSearch(row, searchQuery);
        });
    }, [hideUnfriends, rows, searchQuery, selectedTypes]);

    const orderedRows = useMemo(() => sortRows(filteredRows), [filteredRows]);

    async function handleDeleteRow(row, { skipConfirm = false } = {}) {
        const ownerUserId = normalizeUserId(currentUserId);
        if (
            !ownerUserId ||
            !row ||
            rowsOwnerUserId !== ownerUserId ||
            loadStatus === 'running'
        ) {
            return;
        }
        const rowKey = getFriendLogRowKey(row, ownerUserId);

        const result = skipConfirm
            ? { ok: true }
            : await confirm({
                  title: t('common.actions.confirm'),
                  description: t('confirm.delete_log'),
                  confirmText: t('common.actions.delete'),
                  cancelText: t('common.actions.cancel'),
                  destructive: true
              });

        if (!result.ok) {
            return;
        }

        if (
            normalizeUserId(useRuntimeStore.getState().auth.currentUserId) !==
                ownerUserId ||
            rowsOwnerUserIdRef.current !== ownerUserId
        ) {
            setDetail(
                'Friend history owner changed before delete; refresh and try again.'
            );
            return;
        }

        setDeletingRowKey(rowKey);
        try {
            const affectedRows = Number(
                await friendLogHistoryRepository.deleteFriendLogHistory(
                    ownerUserId,
                    row
                )
            );
            if (
                normalizeUserId(
                    useRuntimeStore.getState().auth.currentUserId
                ) !== ownerUserId ||
                rowsOwnerUserIdRef.current !== ownerUserId
            ) {
                return;
            }
            if (!Number.isFinite(affectedRows) || affectedRows <= 0) {
                setDetail(
                    'No matching friend history row was deleted; refresh and try again.'
                );
                return;
            }
            setRows((currentRows) =>
                currentRows.filter(
                    (currentRow) =>
                        getFriendLogRowKey(currentRow, ownerUserId) !== rowKey
                )
            );
            setDetail('Deleted one friend history row.');
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete the friend history row.'
            );
        } finally {
            setDeletingRowKey('');
        }
    }

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(orderedRows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [orderedRows.length, pagination.pageIndex, pagination.pageSize]);

    const columns = useMemo(
        () =>
            buildFriendLogColumns({
                currentUserId,
                deletingRowKey,
                handleDeleteRow,
                loadStatus,
                rowsOwnerUserId,
                shiftHeld,
                t
            }),
        [
            currentUserId,
            deletingRowKey,
            handleDeleteRow,
            loadStatus,
            rowsOwnerUserId,
            shiftHeld,
            t
        ]
    );

    const table = useReactTable({
        data: orderedRows,
        columns,
        state: {
            columnOrder,
            columnSizing,
            columnVisibility,
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    const hasRows = orderedRows.length > 0;
    const isLoading = loadStatus === 'running' && rows.length === 0;
    const isError = loadStatus === 'error' && rows.length === 0;

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <FriendLogPageToolbar
                    selectedTypes={selectedTypes}
                    onSelectedTypesChange={setSelectedTypes}
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    detail={userFacingErrorMessage(
                        detail,
                        'Failed to load the friend history snapshot.'
                    )}
                    currentUserId={currentUserId}
                    loadStatus={loadStatus}
                    onRefresh={() => setRefreshToken((value) => value + 1)}
                    table={table}
                    t={t}
                />
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState
                        label={t(
                            'view.friend_log.generated.loading_the_friend_history_snapshot'
                        )}
                    />
                ) : isError ? (
                    <FriendLogEmptyState
                        title={t(
                            'view.friend_log.generated.friend_history_failed_to_load'
                        )}
                        description={
                            detail || 'The history query did not complete.'
                        }
                    />
                ) : hasRows ? (
                    <FriendLogPageTable
                        table={table}
                        orderedRowsLength={orderedRows.length}
                        pagination={pagination}
                        pageSizes={pageSizes}
                        onPageSizeChange={(value) => {
                            const nextPageSize = resolvePageSize(
                                value,
                                pageSizes,
                                pagination.pageSize
                            );
                            setPagination({
                                pageIndex: 0,
                                pageSize: nextPageSize
                            });
                        }}
                        t={t}
                    />
                ) : (
                    <FriendLogEmptyState
                        title={t(
                            'view.friend_log.generated.no_friend_history_rows_match_the_current_filters'
                        )}
                        description={t(
                            'view.friend_log.generated.broaden_the_type_filters_or_search_query_to_see_more_history'
                        )}
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
