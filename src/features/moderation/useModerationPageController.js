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
    vrchatModerationRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { moderationTypes } from '@/shared/constants';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { buildModerationColumns } from './components/ModerationColumns.jsx';
import { ModerationPageTable } from './components/ModerationPageTable.jsx';
import { ModerationPageToolbar } from './components/ModerationPageToolbar.jsx';
import { ModerationEmptyState } from './components/ModerationViewParts.jsx';
const DEFAULT_PAGE_SIZES = [10, 25, 50];
const DEFAULT_SORTING = [
    {
        id: 'created',
        desc: true
    }
];
const COLUMN_IDS = [
    'spacer',
    'created',
    'type',
    'sourceDisplayName',
    'targetDisplayName',
    'action',
    'trailing'
];
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
        // Ignore persistence failures; table state can fall back to defaults.
    }
}
function sanitizeSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }
    const filtered = value.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            COLUMN_IDS.includes(entry.id)
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
        String(row?.sourceDisplayName ?? '')
            .toLowerCase()
            .includes(query) ||
        String(row?.targetDisplayName ?? '')
            .toLowerCase()
            .includes(query)
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
export function useModerationPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const confirm = useModalStore((state) => state.confirm);
    const persistedState = useMemo(() => readPersistedState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const hydratedTypeFiltersRef = useRef(false);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
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
    const filteredRows = useMemo(() => {
        const activeTypeSet = selectedTypes.length
            ? new Set(selectedTypes)
            : null;
        return rows.filter((row) => {
            if (activeTypeSet && !activeTypeSet.has(row?.type)) {
                return false;
            }
            return matchesSearch(row, searchQuery);
        });
    }, [rows, searchQuery, selectedTypes]);
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
    const handleDeleteModeration = async (
        row,
        { skipConfirm = false } = {}
    ) => {
        const ownerUserId = currentUserId;
        if (!ownerUserId || row?.sourceUserId !== ownerUserId) {
            return;
        }
        const result = skipConfirm
            ? {
                  ok: true
              }
            : await confirm({
                  title: t('common.actions.confirm'),
                  description: `Continue? Moderation ${row.type || ''}`.trim(),
                  destructive: true,
                  confirmText: t('common.actions.delete'),
                  cancelText: t('common.actions.cancel')
              });
        if (
            !result.ok ||
            useRuntimeStore.getState().auth.currentUserId !== ownerUserId
        ) {
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
            const nextRows = rows.filter(
                (entry) => !isSameModerationRow(entry, row)
            );
            setRows(nextRows);
            await vrchatModerationRepository.syncLocalModerationSnapshot({
                ownerUserId,
                rows: nextRows
            });
            setDetail(
                t('view.moderation.generated_dynamic.deleted_value_for_value', {
                    value: row.type || 'moderation',
                    value2: row.targetDisplayName || row.targetUserId
                })
            );
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete moderation.'
            );
        } finally {
            setDeletingModerationKey((currentKey) =>
                currentKey === rowKey ? '' : currentKey
            );
        }
    };
    function openModerationUser({ userId, title }) {
        if (!userId) {
            return;
        }
        openUserDialog({
            userId,
            title
        });
    }
    const columns = useMemo(
        () =>
            buildModerationColumns({
                currentUserId,
                deletingModerationKey,
                getModerationRowKey,
                getModerationTypeLabel,
                onDeleteModeration: handleDeleteModeration,
                onOpenUser: openModerationUser,
                shiftHeld,
                t
            }),
        [
            currentUserId,
            deletingModerationKey,
            getModerationTypeLabel,
            handleDeleteModeration,
            openModerationUser,
            shiftHeld,
            t
        ]
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
    return {
        PageScaffold,
        embedded,
        PageToolbar,
        ModerationPageToolbar,
        selectedTypes,
        setSelectedTypes,
        getModerationTypeLabel,
        normalizeSelectedTypes,
        searchQuery,
        setSearchQuery,
        userFacingErrorMessage,
        detail,
        currentUserId,
        loadStatus,
        setRefreshToken,
        table,
        t,
        PageBody,
        isLoading,
        LoadingState,
        isError,
        ModerationEmptyState,
        hasRows,
        ModerationPageTable,
        filteredRows,
        pagination,
        pageSizes,
        resolvePageSize,
        setPagination
    };
}
