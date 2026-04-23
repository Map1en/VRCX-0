import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    RefreshCwIcon,
    SearchIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import {
    LoadingState,
    PageBody,
    PageFooter,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    configRepository,
    friendLogHistoryRepository
} from '@/repositories/index.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Spinner } from '@/ui/shadcn/spinner';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';
import { appI18n } from '@/services/i18nService.js';
import {
    FRIEND_LOG_TYPES,
    FriendLogEmptyState,
    FriendLogTypeFilterDropdown,
    SortButton,
    renderUserCell
} from './components/FriendLogViewParts.jsx';

const DEFAULT_PAGE_SIZES = [10, 25, 50];
const DEFAULT_SORTING = [];
const COLUMN_IDS = [
    'spacer',
    'created_at',
    'type',
    'displayName',
    'action',
    'trailing'
];
const STORAGE_KEY = 'vrcx:table:friendLog';

function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function readPersistedState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

function writePersistedState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedState();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                ...current,
                ...patch,
                updatedAt: Date.now()
            })
        );
    } catch {
        // Persisted table state is optional.
    }
}

function sanitizeSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }

    return value.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            COLUMN_IDS.includes(entry.id)
    );
}

function sanitizePageSizes(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(entry, 10))
                .filter((entry) => Number.isFinite(entry) && entry > 0)
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : DEFAULT_PAGE_SIZES;
}

function sanitizeColumnVisibility(value) {
    const visibility = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const columnId of COLUMN_IDS) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }

    return visibility;
}

function sanitizeColumnOrder(value) {
    if (!Array.isArray(value)) {
        return COLUMN_IDS;
    }

    const orderedColumns = value.filter((columnId) =>
        COLUMN_IDS.includes(columnId)
    );
    const missingColumns = COLUMN_IDS.filter(
        (columnId) => !orderedColumns.includes(columnId)
    );
    return [...orderedColumns, ...missingColumns];
}

function sanitizeColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const columnId of COLUMN_IDS) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}

function resolvePageSize(candidate, allowed, fallback = DEFAULT_PAGE_SIZES[1]) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        if (allowed.includes(parsed)) {
            return parsed;
        }

        if (allowed.includes(fallback)) {
            return fallback;
        }

        return allowed[0] ?? DEFAULT_PAGE_SIZES[0];
    }

    if (allowed.includes(fallback)) {
        return fallback;
    }

    return allowed[0] ?? DEFAULT_PAGE_SIZES[0];
}

function parseTypeFilters(value) {
    const parsed = safeJsonParse(value);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.filter(
        (entry) => typeof entry === 'string' && FRIEND_LOG_TYPES.includes(entry)
    );
}

function sortRows(rows) {
    return rows.slice().sort((left, right) => {
        const leftTs = Date.parse(left?.created_at ?? '');
        const rightTs = Date.parse(right?.created_at ?? '');
        if (
            Number.isFinite(leftTs) &&
            Number.isFinite(rightTs) &&
            leftTs !== rightTs
        ) {
            return rightTs - leftTs;
        }

        const leftId = Number.parseInt(left?.rowId ?? 0, 10) || 0;
        const rightId = Number.parseInt(right?.rowId ?? 0, 10) || 0;
        return rightId - leftId;
    });
}

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getFriendLogRowKey(row, ownerUserId = '') {
    const owner = normalizeUserId(ownerUserId);
    const rowId = Number.parseInt(row?.rowId ?? 0, 10) || 0;
    if (rowId > 0) {
        return `${owner}:row:${rowId}`;
    }

    return `${owner}:composite:${row?.created_at || ''}:${row?.type || ''}:${row?.userId || ''}`;
}

function matchesSearch(row, searchQuery) {
    if (!searchQuery) {
        return true;
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }

    return String(row?.displayName ?? '')
        .toLowerCase()
        .includes(query);
}

export function FriendLogPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const confirm = useModalStore((state) => state.confirm);

    const persistedState = useMemo(() => readPersistedState(), []);
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
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1]),
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

                setPageSizes((current) =>
                    sanitizePageSizes([
                        ...current,
                        ...resolvedPageSizes,
                        resolvedConfiguredPageSize,
                        resolvedActivePageSize
                    ])
                );

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
        setPagination((current) => ({
            ...current,
            pageIndex: 0,
            pageSize: resolvePageSize(current.pageSize, resolvedPageSizes)
        }));
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
                  title: appI18n.t('common.actions.confirm'),
                  description: t('confirm.delete_log'),
                  confirmText: appI18n.t('common.actions.delete'),
                  cancelText: appI18n.t('common.actions.cancel'),
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
        () => [
            {
                id: 'spacer',
                size: 20,
                minSize: 0,
                maxSize: 20,
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null
            },
            {
                id: 'created_at',
                size: 120,
                accessorFn: (row) => row?.created_at || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.date')}
                    />
                ),
                sortingFn: (rowA, rowB) => {
                    const leftTs = Date.parse(rowA.original?.created_at ?? '');
                    const rightTs = Date.parse(rowB.original?.created_at ?? '');
                    if (
                        Number.isFinite(leftTs) &&
                        Number.isFinite(rightTs) &&
                        leftTs !== rightTs
                    ) {
                        return leftTs - rightTs;
                    }

                    return (
                        (Number.parseInt(rowA.original?.rowId ?? 0, 10) || 0) -
                        (Number.parseInt(rowB.original?.rowId ?? 0, 10) || 0)
                    );
                },
                cell: ({ row }) => {
                    const createdAt = row.original?.created_at || '';
                    return (
                        <span
                            className="text-sm"
                            title={formatDateFilter(createdAt, 'long')}
                        >
                            {formatDateFilter(createdAt, 'short')}
                        </span>
                    );
                }
            },
            {
                id: 'type',
                size: 160,
                accessorFn: (row) => row?.type || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.type')}
                    />
                ),
                cell: ({ row }) => (
                    <Badge variant="outline" className="text-muted-foreground">
                        {friendLogTypeLabel(row.original?.type, t) ||
                            row.original?.type ||
                            ''}
                    </Badge>
                )
            },
            {
                id: 'displayName',
                size: 260,
                minSize: 80,
                accessorFn: (row) => row?.displayName || row?.userId || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.user')}
                    />
                ),
                sortingFn: (rowA, rowB) =>
                    String(
                        rowA.original?.displayName ||
                            rowA.original?.userId ||
                            ''
                    ).localeCompare(
                        String(
                            rowB.original?.displayName ||
                                rowB.original?.userId ||
                                ''
                        ),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }) => renderUserCell(row.original)
            },
            {
                id: 'action',
                size: 80,
                maxSize: 80,
                enableSorting: false,
                accessorFn: (row) => getFriendLogRowKey(row, rowsOwnerUserId),
                header: () => t('table.friendLog.action'),
                cell: ({ row }) => {
                    const rowKey = getFriendLogRowKey(
                        row.original,
                        rowsOwnerUserId
                    );
                    return (
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={"Delete"}
                                disabled={
                                    !currentUserId ||
                                    rowsOwnerUserId !==
                                        normalizeUserId(currentUserId) ||
                                    loadStatus === 'running' ||
                                    deletingRowKey === rowKey
                                }
                                onClick={(event) =>
                                    handleDeleteRow(row.original, {
                                        skipConfirm: shiftHeld || event.shiftKey
                                    })
                                }
                            >
                                {deletingRowKey === rowKey ? (
                                    <Spinner data-icon="inline-start" />
                                ) : shiftHeld ? (
                                    <XIcon
                                        data-icon="inline-start"
                                        className="text-destructive"
                                    />
                                ) : (
                                    <Trash2Icon data-icon="inline-start" />
                                )}
                            </Button>
                        </div>
                    );
                }
            },
            {
                id: 'trailing',
                size: 5,
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null
            }
        ],
        [
            currentUserId,
            deletingRowKey,
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
                <PageToolbarRow className="xl:justify-between">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <FriendLogTypeFilterDropdown
                            value={selectedTypes}
                            onChange={setSelectedTypes}
                        />
                        <InputGroup className="min-w-56 flex-1">
                            <InputGroupAddon>
                                <SearchIcon />
                            </InputGroupAddon>
                            <InputGroupInput
                                value={searchQuery}
                                onChange={(event) =>
                                    setSearchQuery(event.target.value)
                                }
                                placeholder={t(
                                    'view.friend_log.search_placeholder'
                                )}
                            />
                        </InputGroup>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title={t('common.actions.refresh')}
                            aria-label={"Refresh friend history"}
                            disabled={
                                !currentUserId || loadStatus === 'running'
                            }
                            onClick={() =>
                                setRefreshToken((value) => value + 1)
                            }
                        >
                            {loadStatus === 'running' ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <RefreshCwIcon data-icon="inline-start" />
                            )}
                        </Button>
                    </div>
                    <TableColumnVisibilityMenu table={table} />
                </PageToolbarRow>
                {detail ? (
                    <div className="text-muted-foreground text-sm">
                        {userFacingErrorMessage(
                            detail,
                            'Failed to load the friend history snapshot.'
                        )}
                    </div>
                ) : null}
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState label={t('view.friend_log.generated.loading_the_friend_history_snapshot')} />
                ) : isError ? (
                    <FriendLogEmptyState
                        title={t('view.friend_log.generated.friend_history_failed_to_load')}
                        description={
                            detail || 'The history query did not complete.'
                        }
                    />
                ) : hasRows ? (
                    <>
                        <DataTableSurface>
                            <DataTableScrollArea wideTable>
                                <Table className="w-max min-w-full">
                                    <DataTableHeader table={table} />
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow
                                                key={
                                                    row.original?.rowId ||
                                                    row.id
                                                }
                                            >
                                                {row
                                                    .getVisibleCells()
                                                    .map((cell) => (
                                                        <ResizableTableCell
                                                            key={cell.id}
                                                            cell={cell}
                                                        />
                                                    ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </DataTableScrollArea>
                        </DataTableSurface>

                        <PageFooter>
                            <div className="text-muted-foreground text-sm">
                                {t('view.friend_log.generated.showing')}{' '}
                                <span className="text-foreground font-medium">
                                    {table.getRowModel().rows.length}
                                </span>{' '}
                                {t('view.friend_log.generated.of')}{' '}
                                <span className="text-foreground font-medium">
                                    {orderedRows.length}
                                </span>{' '}
                                {t('view.friend_log.generated.log_row')}{orderedRows.length === 1 ? '' : 's'}
                            </div>
                            <DataTablePagination
                                table={table}
                                pageIndex={pagination.pageIndex}
                                pageSize={pagination.pageSize}
                                pageSizes={pageSizes}
                                pageSizeLabel={t(
                                    'table.pagination.rows_per_page'
                                )}
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
                            />
                        </PageFooter>
                    </>
                ) : (
                    <FriendLogEmptyState
                        title={t('view.friend_log.generated.no_friend_history_rows_match_the_current_filters')}
                        description={t('view.friend_log.generated.broaden_the_type_filters_or_search_query_to_see_more_history')}
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
