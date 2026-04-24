import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    useDeferredValue,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    DataTableHeader,
    DataTablePagination,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import {
    LoadingState,
    PageBody,
    PageFooter,
    PageScaffold,
    PageToolbar
} from '@/components/layout/PageScaffold.jsx';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { useTodayDate } from '@/lib/useTodayDate.js';
import {
    configRepository,
    GAME_LOG_FILTER_TYPES,
    gameLogRepository
} from '@/repositories/index.js';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { TableBody, TableRow } from '@/ui/shadcn/table';

import { buildGameLogColumns } from './components/GameLogColumns.jsx';
import {
    GameLogEmptyState,
    GameLogSessionsView,
    SESSION_FILTER_TYPES
} from './components/GameLogTableParts.jsx';
import { GameLogToolbar } from './components/GameLogToolbar.jsx';
import {
    clampGameLogSessionDateInputRange,
    isoToGameLogDateInputValue,
    parseGameLogDateInput,
    toGameLogDateInputValue,
    toGameLogIsoRangeEnd,
    toGameLogIsoRangeStart
} from './gameLogDateRange.js';
import {
    annotateGameLogSessionEvent as annotateSessionEvent,
    buildGameLogFavoriteIdSet as buildFavoriteIdSet,
    canDeleteGameLogRow,
    describeGameLogDetail,
    getGameLogCopyTarget,
    getGameLogRowKey,
    resolveGameLogWorldId as resolveWorldId
} from './gameLogRows.js';
import {
    GAME_LOG_DEFAULT_PAGE_SIZES,
    GAME_LOG_STRETCH_COLUMN_ID,
    readPersistedGameLogState,
    resolveGameLogPageSize,
    sanitizeGameLogColumnOrder,
    sanitizeGameLogColumnSizing,
    sanitizeGameLogColumnVisibility,
    sanitizeGameLogPageSizes,
    sanitizeGameLogSorting,
    safeJsonParse,
    writePersistedGameLogState
} from './gameLogState.js';
import { normalizeId, openGameLogUser } from './gameLogUserLookup.js';
import { useGameLogPageActions } from './useGameLogPageActions.js';
import { useGameLogPageEffects } from './useGameLogPageEffects.js';
function getGameLogColumnStyle(column) {
    if (column?.id !== GAME_LOG_STRETCH_COLUMN_ID) {
        return undefined;
    }
    return {
        width: undefined
    };
}
export function useGameLogPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const isGameRunning = useRuntimeStore((state) =>
        Boolean(state.gameState.isGameRunning)
    );
    const confirm = useModalStore((state) => state.confirm);
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const gameLogDisabled = usePreferencesStore(
        (state) => state.gameLogDisabled
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const [persistedState] = useState(() => readPersistedGameLogState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const preferencesReadyRef = useRef(false);
    const requestIdRef = useRef(0);
    const [rows, setRows] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [deletingGameLogKey, setDeletingGameLogKey] = useState('');
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [previousInstancesRows, setPreviousInstancesRows] = useState([]);
    const [previousInstancesTitle, setPreviousInstancesTitle] =
        useState('Instance History');
    const [loadingPreviousInstancesKey, setLoadingPreviousInstancesKey] =
        useState('');
    const [shiftHeld, setShiftHeld] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [tableSelectedTypes, setTableSelectedTypes] = useState([]);
    const [sessionSelectedTypes, setSessionSelectedTypes] = useState([]);
    const [tableFavoritesOnly, setTableFavoritesOnly] = useState(false);
    const [sessionFavoritesOnly, setSessionFavoritesOnly] = useState(false);
    const [sessionDateFrom, setSessionDateFrom] = useState('');
    const [sessionDateTo, setSessionDateTo] = useState('');
    const [sessionDateDraftFrom, setSessionDateDraftFrom] = useState('');
    const [sessionDateDraftTo, setSessionDateDraftTo] = useState('');
    const [sessionDatePopoverOpen, setSessionDatePopoverOpen] = useState(false);
    const [pageSizes, setPageSizes] = useState(GAME_LOG_DEFAULT_PAGE_SIZES);
    const [sessionLimit, setSessionLimit] = useState(
        GAME_LOG_DEFAULT_PAGE_SIZES[1]
    );
    const [savedViewMode, setSavedViewMode] = useState('sessions');
    const [sorting, setSorting] = useState(() =>
        sanitizeGameLogSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeGameLogColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeGameLogColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeGameLogColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolveGameLogPageSize(
            persistedState.pageSize,
            GAME_LOG_DEFAULT_PAGE_SIZES,
            GAME_LOG_DEFAULT_PAGE_SIZES[1]
        )
    }));
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const sessionDateDraftRange = useMemo(() => {
        const from = parseGameLogDateInput(sessionDateDraftFrom);
        const to = parseGameLogDateInput(sessionDateDraftTo);
        return from || to
            ? {
                  from,
                  to
              }
            : undefined;
    }, [sessionDateDraftFrom, sessionDateDraftTo]);
    const todayDate = useTodayDate();
    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(localFriendFavorites),
        [localFriendFavorites]
    );
    const friendIdSet = useMemo(
        () => new Set(Object.keys(friendsById || {})),
        [friendsById]
    );
    const availableFilterTypes =
        savedViewMode === 'sessions'
            ? SESSION_FILTER_TYPES
            : GAME_LOG_FILTER_TYPES;
    const tableQueryFilterTypes = useMemo(
        () =>
            tableSelectedTypes.filter((type) =>
                GAME_LOG_FILTER_TYPES.includes(type)
            ),
        [tableSelectedTypes]
    );
    const sessionQueryFilterTypes = useMemo(
        () =>
            sessionSelectedTypes.filter((type) =>
                SESSION_FILTER_TYPES.includes(type)
            ),
        [sessionSelectedTypes]
    );
    const queryFilterTypes =
        savedViewMode === 'sessions'
            ? sessionQueryFilterTypes
            : tableQueryFilterTypes;
    const favoritesOnly =
        savedViewMode === 'sessions'
            ? sessionFavoritesOnly
            : tableFavoritesOnly;
    const setActiveSelectedTypes =
        savedViewMode === 'sessions'
            ? setSessionSelectedTypes
            : setTableSelectedTypes;
    const setActiveFavoritesOnly =
        savedViewMode === 'sessions'
            ? setSessionFavoritesOnly
            : setTableFavoritesOnly;
    const annotatedSessions = useMemo(
        () =>
            sessions.map((session) => ({
                ...session,
                events: (session.events ?? []).map((event) =>
                    annotateSessionEvent(event, favoriteIdSet, friendIdSet)
                )
            })),
        [favoriteIdSet, friendIdSet, sessions]
    );
    const annotatedRows = useMemo(
        () =>
            rows.map((row) => {
                const normalizedUserId = normalizeId(row?.userId);
                return {
                    ...row,
                    isFavorite: normalizedUserId
                        ? favoriteIdSet.has(normalizedUserId)
                        : false,
                    isFriend: normalizedUserId
                        ? friendIdSet.has(normalizedUserId)
                        : false
                };
            }),
        [favoriteIdSet, friendIdSet, rows]
    );
    const {
        deleteGameLogRow,
        openPreviousInstancesForRow,
        copyGameLogDetail,
        commitSearchDraft,
        updateSessionDateDraftRange,
        applySessionDateRange,
        clearSessionDateRange,
        changeViewMode,
        toggleFavoritesOnly,
        handleSessionDatePopoverChange,
        clearSearch,
        refreshGameLog
    } = useGameLogPageActions({
        canDeleteGameLogRow,
        clampGameLogSessionDateInputRange,
        configRepository,
        confirm,
        copyTextToClipboard,
        deletingGameLogKey,
        describeGameLogDetail,
        gameLogRepository,
        getGameLogCopyTarget,
        getGameLogRowKey,
        isoToGameLogDateInputValue,
        loadingPreviousInstancesKey,
        normalizeId,
        resolveWorldId,
        searchDraft,
        sessionDateDraftFrom,
        sessionDateDraftTo,
        sessionDateFrom,
        sessionDateTo,
        setActiveFavoritesOnly,
        setDeletingGameLogKey,
        setLoadingPreviousInstancesKey,
        setPreviousInstancesOpen,
        setPreviousInstancesRows,
        setPreviousInstancesTitle,
        setRefreshToken,
        setRows,
        setSavedViewMode,
        setSearchDraft,
        setSearchQuery,
        setSessionDateDraftFrom,
        setSessionDateDraftTo,
        setSessionDateFrom,
        setSessionDatePopoverOpen,
        setSessionDateTo,
        t,
        toGameLogDateInputValue,
        toGameLogIsoRangeEnd,
        toGameLogIsoRangeStart,
        toast
    });
    useGameLogPageEffects({
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
    });
    const columns = useMemo(
        () =>
            buildGameLogColumns({
                deletingGameLogKey,
                loadingPreviousInstancesKey,
                onCopyDetail: copyGameLogDetail,
                onDeleteRow: deleteGameLogRow,
                onOpenPreviousInstances: openPreviousInstancesForRow,
                onOpenUser: (row) => openGameLogUser(row, t),
                shiftHeld,
                t
            }),
        [
            copyGameLogDetail,
            deleteGameLogRow,
            deletingGameLogKey,
            loadingPreviousInstancesKey,
            openPreviousInstancesForRow,
            shiftHeld,
            t
        ]
    );
    const table = useReactTable({
        data: annotatedRows,
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
    const pageCount = Math.max(1, table.getPageCount());
    const isLoading =
        loadStatus === 'running' &&
        (savedViewMode === 'sessions'
            ? sessions.length === 0
            : rows.length === 0);
    const isLoadingMoreSessions =
        loadStatus === 'running' &&
        savedViewMode === 'sessions' &&
        sessions.length > 0;
    const hasMoreSessions =
        savedViewMode === 'sessions' &&
        sessions.length >= sessionLimit &&
        sessionLimit < 1000;
    const isError =
        loadStatus === 'error' &&
        (savedViewMode === 'sessions'
            ? sessions.length === 0
            : rows.length === 0);
    const hasRows = annotatedRows.length > 0;
    const hasSessions = annotatedSessions.length > 0;
    return {
        PageScaffold,
        embedded,
        PageToolbar,
        GameLogToolbar,
        savedViewMode,
        favoritesOnly,
        availableFilterTypes,
        queryFilterTypes,
        changeViewMode,
        toggleFavoritesOnly,
        setActiveSelectedTypes,
        sessionDatePopoverOpen,
        handleSessionDatePopoverChange,
        sessionDateFrom,
        sessionDateTo,
        sessionDateDraftFrom,
        sessionDateDraftTo,
        sessionDateDraftRange,
        todayDate,
        updateSessionDateDraftRange,
        clearSessionDateRange,
        applySessionDateRange,
        searchDraft,
        setSearchDraft,
        commitSearchDraft,
        clearSearch,
        currentUserId,
        gameLogDisabled,
        loadStatus,
        refreshGameLog,
        table,
        t,
        detail,
        userFacingErrorMessage,
        PageBody,
        isLoading,
        LoadingState,
        isError,
        GameLogEmptyState,
        hasSessions,
        GameLogSessionsView,
        annotatedSessions,
        isGameRunning,
        hasMoreSessions,
        isLoadingMoreSessions,
        deferredSearchQuery,
        setSessionLimit,
        pagination,
        isFavoritesLoaded,
        hasRows,
        DataTableSurface,
        DataTableHeader,
        getGameLogColumnStyle,
        TableBody,
        TableRow,
        ResizableTableCell,
        PageFooter,
        annotatedRows,
        DataTablePagination,
        pageCount,
        pageSizes,
        resolveGameLogPageSize,
        setPagination,
        PreviousInstancesTableDialog,
        previousInstancesOpen,
        setPreviousInstancesOpen,
        previousInstancesTitle,
        previousInstancesRows,
        setPreviousInstancesRows
    };
}
