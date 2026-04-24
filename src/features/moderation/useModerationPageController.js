import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService.js';
import { moderationTypes } from '@/shared/constants';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { buildModerationColumns } from './components/ModerationColumns.jsx';
import { ModerationPageTable } from './components/ModerationPageTable.jsx';
import { ModerationPageToolbar } from './components/ModerationPageToolbar.jsx';
import { ModerationEmptyState } from './components/ModerationViewParts.jsx';
import { useModerationPageActions } from './useModerationPageActions.js';
import { useModerationPageEffects } from './useModerationPageEffects.js';
const DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
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
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
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
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size) => Number.isFinite(size) && size > 0)
        : DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }
    if (pageSizes.includes(fallback)) {
        return fallback;
    }
    return nearestPageSize(Number(fallback) || fallbackPageSize);
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
    const [persistedState] = useState(() => readPersistedState());
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
    const getModerationTypeLabel = useCallback(
        (type) => resolveModerationTypeLabel(type, t),
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
    useModerationPageEffects({
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
    });
    const { handleDeleteModeration, openModerationUser } =
        useModerationPageActions({
            confirm,
            currentEndpoint,
            currentUserId,
            getModerationRowKey,
            isSameModerationRow,
            openUserDialog,
            rows,
            setDeletingModerationKey,
            setDetail,
            setRows,
            t,
            useRuntimeStore,
            vrchatModerationRepository
        });
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
