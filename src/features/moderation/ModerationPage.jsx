import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    RefreshCwIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';

import { formatDateFilter } from '@/lib/dateTime.js';
import {
    ResizableTableCell
} from '@/components/data-table/ResizableTableParts.jsx';
import {
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import {
    EmptyState,
    LoadingState,
    PageBody,
    PageFooter,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold.jsx';
import { configRepository, vrchatModerationRepository } from '@/repositories/index.js';
import { moderationTypes } from '@/shared/constants';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableRow
} from '@/ui/shadcn/table';
import { useI18n } from '@/app/hooks/use-i18n.js';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { openUserDialog } from '@/services/dialogService.js';

const DEFAULT_PAGE_SIZES = [10, 25, 50];
const DEFAULT_SORTING = [{ id: 'created', desc: true }];
const COLUMN_IDS = ['spacer', 'created', 'type', 'sourceDisplayName', 'targetDisplayName', 'action', 'trailing'];
const STORAGE_KEY = 'vrcx:table:moderation';
const TYPE_FILTERS_CONFIG_KEY = 'VRCX_playerModerationTableFilters';
const TYPE_LABELS = {
    block: 'Block',
    unblock: 'Unblock',
    mute: 'Mute',
    unmute: 'Unmute',
    interactOn: 'Interact On',
    interactOff: 'Interact Off',
    muteChat: 'Mute Chat',
    unmuteChat: 'Unmute Chat'
};

function resolveModerationTypeLabel(type, t) {
    const value = String(type || '');
    if (!value) {
        return '';
    }

    const key = `view.moderation.filters.${value}`;
    const label = t(key);
    return label && label !== key ? label : TYPE_LABELS[value] || value;
}

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

    const filtered = value.filter(
        (entry) => entry && typeof entry.id === 'string' && COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : DEFAULT_SORTING;
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

    const orderedColumns = value.filter((columnId) => COLUMN_IDS.includes(columnId));
    const missingColumns = COLUMN_IDS.filter((columnId) => !orderedColumns.includes(columnId));
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

function normalizeSelectedTypes(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(
        (entry) => typeof entry === 'string' && moderationTypes.includes(entry)
    );
}

function parseSelectedTypes(value) {
    return normalizeSelectedTypes(safeJsonParse(value));
}

function matchesSearch(row, searchQuery) {
    if (!searchQuery) {
        return true;
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }

    return (
        String(row?.sourceDisplayName ?? '').toLowerCase().includes(query) ||
        String(row?.targetDisplayName ?? '').toLowerCase().includes(query)
    );
}

function getModerationRowKey(row) {
    if (row?.id) {
        return String(row.id);
    }

    return [
        row?.type || '',
        row?.sourceUserId || '',
        row?.targetUserId || '',
        row?.created || ''
    ].join(':');
}

function isSameModerationRow(left, right) {
    if (left?.id && right?.id) {
        return left.id === right.id;
    }

    return (
        left?.type === right?.type &&
        left?.sourceUserId === right?.sourceUserId &&
        left?.targetUserId === right?.targetUserId &&
        left?.created === right?.created
    );
}

function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto justify-start px-0 py-0 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => column.toggleSorting(direction === 'asc')}>
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

function ModerationEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

function ModerationTypeFilterDropdown({ value, onChange, getTypeLabel = (type) => TYPE_LABELS[type] || type }) {
    const selectedTypes = Array.isArray(value) ? value : [];
    const label = selectedTypes.length
        ? `${selectedTypes.length} moderation filters`
        : 'Moderation filters';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-0 flex-1 justify-start truncate">
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuGroup>
                    {moderationTypes.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={selectedTypes.includes(type)}
                            onCheckedChange={(checked) => {
                                const next = checked
                                    ? [...selectedTypes, type]
                                    : selectedTypes.filter((entry) => entry !== type);
                                onChange(normalizeSelectedTypes(next));
                            }}
                            onSelect={(event) => event.preventDefault()}>
                            {getTypeLabel(type)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function ModerationPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const confirm = useModalStore((state) => state.confirm);

    const persistedState = useMemo(() => readPersistedState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const hydratedTypeFiltersRef = useRef(false);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const tablePageSizesPreference = usePreferencesStore((state) => state.tablePageSizes);

    const [rows, setRows] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);
    const [deletingModerationKey, setDeletingModerationKey] = useState('');
    const [shiftHeld, setShiftHeld] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTypes, setSelectedTypes] = useState([]);
    const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZES);
    const getModerationTypeLabel = useMemo(
        () => (type) => resolveModerationTypeLabel(type, t),
        [t]
    );
    const [sorting, setSorting] = useState(() => sanitizeSorting(persistedState.sorting));
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() => sanitizeColumnOrder(persistedState.columnOrder));
    const [columnSizing, setColumnSizing] = useState(() => sanitizeColumnSizing(persistedState.columnSizing));
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

    useEffect(() => {
        let active = true;

        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1]),
            configRepository.getString(TYPE_FILTERS_CONFIG_KEY, '[]')
        ])
            .then(([nextPageSizes, nextPageSize, nextTypeFilters]) => {
                if (!active) {
                    return;
                }

                const resolvedPageSizes = sanitizePageSizes(nextPageSizes);
                const parsedPersistedPageSize = Number.parseInt(persistedState.pageSize, 10);
                const hasPersistedPageSize =
                    Number.isFinite(parsedPersistedPageSize) && parsedPersistedPageSize > 0;
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
            setDetail('No authenticated user is available for the moderation snapshot.');
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        vrchatModerationRepository
            .getPlayerModerations({ endpoint: currentEndpoint })
            .then(async (response) => {
                if (!active) {
                    return;
                }

                const nextRows = Array.isArray(response.json) ? response.json : [];
                await vrchatModerationRepository.syncLocalModerationSnapshot(nextRows);
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
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the moderation snapshot.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, refreshToken]);

    const filteredRows = useMemo(() => {
        const activeTypeSet = selectedTypes.length ? new Set(selectedTypes) : null;

        return rows.filter((row) => {
            if (activeTypeSet && !activeTypeSet.has(row?.type)) {
                return false;
            }

            return matchesSearch(row, searchQuery);
        });
    }, [rows, searchQuery, selectedTypes]);

    useEffect(() => {
        const maxPageIndex = Math.max(0, Math.ceil(filteredRows.length / pagination.pageSize) - 1);
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [filteredRows.length, pagination.pageIndex, pagination.pageSize]);

    const handleDeleteModeration = async (row, { skipConfirm = false } = {}) => {
        const ownerUserId = currentUserId;
        if (!ownerUserId || row?.sourceUserId !== ownerUserId) {
            return;
        }

        const result = skipConfirm
            ? { ok: true }
            : await confirm({
                title: 'Confirm',
                description: `Continue? Moderation ${row.type || ''}`.trim(),
                destructive: true,
                confirmText: 'Delete',
                cancelText: 'Cancel'
            });

        if (!result.ok || useRuntimeStore.getState().auth.currentUserId !== ownerUserId) {
            return;
        }

        const rowKey = getModerationRowKey(row);
        setDeletingModerationKey(rowKey);

        try {
            await vrchatModerationRepository.deletePlayerModeration({
                endpoint: currentEndpoint,
                moderated: row.targetUserId,
                type: row.type
            });

            if (useRuntimeStore.getState().auth.currentUserId !== ownerUserId) {
                return;
            }

            const nextRows = rows.filter((entry) => !isSameModerationRow(entry, row));
            setRows(nextRows);
            await vrchatModerationRepository.syncLocalModerationSnapshot(nextRows);
            setDetail(`Deleted ${row.type || 'moderation'} for ${row.targetDisplayName || row.targetUserId}.`);
        } catch (error) {
            setDetail(error instanceof Error ? error.message : 'Failed to delete moderation.');
        } finally {
            setDeletingModerationKey((currentKey) => (currentKey === rowKey ? '' : currentKey));
        }
    };

    const columns = useMemo(
        () => [
            {
                id: 'spacer',
                size: 20,
                minSize: 0,
                maxSize: 20,
                enableSorting: false,
                enableHiding: false,
                header: () => null,
                cell: () => null
            },
            {
                id: 'created',
                size: 120,
                meta: { label: t('table.moderation.date') },
                accessorFn: (row) => row?.created || '',
                header: ({ column }) => <SortButton column={column} label={t('table.moderation.date')} />,
                sortingFn: (rowA, rowB) => {
                    const leftTs = Date.parse(rowA.original?.created ?? '');
                    const rightTs = Date.parse(rowB.original?.created ?? '');
                    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
                        return leftTs - rightTs;
                    }

                    return String(rowA.original?.id || '').localeCompare(String(rowB.original?.id || ''));
                },
                cell: ({ row }) => {
                    const createdAt = row.original?.created || '';
                    return (
                        <span className="text-sm" title={formatDateFilter(createdAt, 'long')}>
                            {formatDateFilter(createdAt, 'short')}
                        </span>
                    );
                }
            },
            {
                id: 'type',
                size: 140,
                meta: { label: t('table.moderation.type') },
                accessorFn: (row) => row?.type || '',
                header: ({ column }) => <SortButton column={column} label={t('table.moderation.type')} />,
                cell: ({ row }) => (
                    <Badge variant="outline" className="text-muted-foreground">
                        {getModerationTypeLabel(row.original?.type)}
                    </Badge>
                )
            },
            {
                id: 'sourceDisplayName',
                size: 120,
                meta: { label: t('table.moderation.source') },
                accessorFn: (row) => row?.sourceDisplayName || row?.sourceUserId || '',
                header: ({ column }) => <SortButton column={column} label={t('table.moderation.source')} />,
                sortingFn: (rowA, rowB) =>
                    String(
                        rowA.original?.sourceDisplayName || rowA.original?.sourceUserId || ''
                    ).localeCompare(
                        String(rowB.original?.sourceDisplayName || rowB.original?.sourceUserId || ''),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }) => (
                    <Button
                        type="button"
                        variant="link"
                        className="block h-auto w-full min-w-0 truncate p-0 pr-2.5 text-left text-sm font-normal"
                        disabled={!row.original?.sourceUserId}
                        onClick={() =>
                            openUserDialog({
                                userId: row.original?.sourceUserId,
                                title:
                                    row.original?.sourceDisplayName ||
                                    row.original?.sourceUserId
                            })
                        }>
                        {row.original?.sourceDisplayName || row.original?.sourceUserId || ''}
                    </Button>
                )
            },
            {
                id: 'targetDisplayName',
                size: 260,
                minSize: 80,
                meta: { label: t('table.moderation.target'), stretch: true },
                accessorFn: (row) => row?.targetDisplayName || row?.targetUserId || '',
                header: ({ column }) => <SortButton column={column} label={t('table.moderation.target')} />,
                sortingFn: (rowA, rowB) =>
                    String(
                        rowA.original?.targetDisplayName || rowA.original?.targetUserId || ''
                    ).localeCompare(
                        String(rowB.original?.targetDisplayName || rowB.original?.targetUserId || ''),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }) => (
                    <Button
                        type="button"
                        variant="link"
                        className="block h-auto w-full min-w-0 whitespace-normal p-0 pr-2.5 text-left text-sm font-normal break-words"
                        disabled={!row.original?.targetUserId}
                        onClick={() =>
                            openUserDialog({
                                userId: row.original?.targetUserId,
                                title:
                                    row.original?.targetDisplayName ||
                                    row.original?.targetUserId
                            })
                        }>
                        {row.original?.targetDisplayName || row.original?.targetUserId || ''}
                    </Button>
                )
            },
            {
                id: 'action',
                size: 80,
                minSize: 80,
                maxSize: 80,
                enableSorting: false,
                meta: { label: t('table.moderation.action') },
                accessorFn: (row) => getModerationRowKey(row),
                header: () => (
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('table.moderation.action')}
                    </span>
                ),
                cell: ({ row }) => {
                    const original = row.original;
                    const rowKey = getModerationRowKey(original);
                    const canDelete =
                        Boolean(currentUserId) && original?.sourceUserId === currentUserId;
                    const isDeleting = deletingModerationKey === rowKey;

                    if (!canDelete) {
                        return null;
                    }

                    return (
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={t('common.actions.delete')}
                                disabled={isDeleting}
                                onClick={() =>
                                    handleDeleteModeration(original, { skipConfirm: shiftHeld })
                                }>
                                {isDeleting ? (
                                    <Spinner data-icon="inline-start" />
                                ) : shiftHeld ? (
                                    <XIcon data-icon="inline-start" className="text-destructive" />
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
                enableHiding: false,
                header: () => null,
                cell: () => null
            }
        ],
        [currentUserId, deletingModerationKey, getModerationTypeLabel, handleDeleteModeration, shiftHeld, t]
    );

    const table = useReactTable({
        data: filteredRows,
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

    const hasRows = filteredRows.length > 0;
    const isLoading = loadStatus === 'running' && rows.length === 0;
    const isError = loadStatus === 'error' && rows.length === 0;

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <PageToolbarRow>
                    <ModerationTypeFilterDropdown
                        value={selectedTypes}
                        onChange={setSelectedTypes}
                        getTypeLabel={getModerationTypeLabel}
                    />
                    <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search"
                        className="h-9 min-w-32 flex-1 sm:max-w-40"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Refresh moderation snapshot"
                        disabled={!currentUserId || loadStatus === 'running'}
                        onClick={() => setRefreshToken((value) => value + 1)}>
                        {loadStatus === 'running' ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                    </Button>
                    <TableColumnVisibilityMenu table={table} />
                </PageToolbarRow>

                {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState label="Loading the moderation snapshot" />
                ) : isError ? (
                    <ModerationEmptyState
                        title="Moderation snapshot failed to load"
                        description={detail || 'The moderation request did not complete.'}
                    />
                ) : hasRows ? (
                    <>
                        <DataTableSurface>
                            <DataTableScrollArea>
                                <Table className="app-data-table table-fixed">
                                    <DataTableHeader table={table} />
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow key={row.original?.id || row.id}>
                                                {row.getVisibleCells().map((cell) => (
                                                    <ResizableTableCell key={cell.id} cell={cell} />
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </DataTableScrollArea>
                        </DataTableSurface>

                        <PageFooter>
                            <div className="text-sm text-muted-foreground">
                                Showing{' '}
                                <span className="font-medium text-foreground">
                                    {table.getRowModel().rows.length}
                                </span>{' '}
                                of{' '}
                                <span className="font-medium text-foreground">
                                    {filteredRows.length}
                                </span>{' '}
                                moderation row{filteredRows.length === 1 ? '' : 's'}
                            </div>
                            <DataTablePagination
                                table={table}
                                pageIndex={pagination.pageIndex}
                                pageSize={pagination.pageSize}
                                pageSizes={pageSizes}
                                pageSizeLabel={t('table.pagination.rows_per_page')}
                                onPageSizeChange={(value) => {
                                    const nextPageSize = resolvePageSize(value, pageSizes, pagination.pageSize);
                                    setPagination({
                                        pageIndex: 0,
                                        pageSize: nextPageSize
                                    });
                                }}
                            />
                        </PageFooter>
                    </>
                ) : (
                    <ModerationEmptyState
                        title="No moderation rows match the current filters"
                        description="Broaden the type filters or search query to see more results."
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
