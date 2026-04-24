import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
import {
    configRepository,
    GAME_LOG_FILTER_TYPES,
    gameLogRepository
} from '@/repositories/index.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
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
    SESSION_FILTER_TYPES,
    normalizeId,
    openGameLogUser
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
    const persistedState = useMemo(() => readPersistedGameLogState(), []);
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
    const todayDate = useMemo(() => new Date(), []);
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
    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(GAME_LOG_DEFAULT_PAGE_SIZES),
            configRepository.getInt(
                'tablePageSize',
                GAME_LOG_DEFAULT_PAGE_SIZES[1]
            ),
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
                    setPageSizes((current) =>
                        sanitizeGameLogPageSizes([
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
        setPagination((current) => ({
            ...current,
            pageIndex: 0,
            pageSize: resolveGameLogPageSize(
                current.pageSize,
                resolvedPageSizes
            )
        }));
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
    async function deleteGameLogRow(row, { skipConfirm = false } = {}) {
        if (!canDeleteGameLogRow(row)) {
            return;
        }
        const rowKey = getGameLogRowKey(row);
        if (!rowKey || deletingGameLogKey) {
            return;
        }
        if (!skipConfirm) {
            const detailValue = describeGameLogDetail(row);
            const result = await confirm({
                title: t('view.game_log.generated_modal.delete_game_log_row'),
                description: detailValue.primary || row.type || row.created_at,
                confirmText: t('common.actions.delete'),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
        }
        setDeletingGameLogKey(rowKey);
        try {
            await gameLogRepository.deleteGameLogEntry(row);
            setRows((currentRows) =>
                currentRows.filter(
                    (entry) => getGameLogRowKey(entry) !== rowKey
                )
            );
            toast.success(t('view.game_log.generated.game_log_row_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.game_log.generated_toast.failed_to_delete_game_log_row'
                      )
            );
        } finally {
            setDeletingGameLogKey('');
        }
    }
    async function openPreviousInstancesForRow(row) {
        const rowKey = getGameLogRowKey(row);
        const worldId = resolveWorldId(row);
        if (!worldId || loadingPreviousInstancesKey) {
            return;
        }
        setLoadingPreviousInstancesKey(rowKey || worldId);
        try {
            const instances =
                await gameLogRepository.getPreviousInstancesByWorldId({
                    worldId
                });
            const currentLocation = normalizeId(row?.location);
            const sortedInstances = [...instances].sort((left, right) => {
                if (currentLocation) {
                    if (normalizeId(left?.location) === currentLocation) {
                        return -1;
                    }
                    if (normalizeId(right?.location) === currentLocation) {
                        return 1;
                    }
                }
                return (
                    Date.parse(right?.created_at || 0) -
                    Date.parse(left?.created_at || 0)
                );
            });
            setPreviousInstancesRows(sortedInstances);
            setPreviousInstancesTitle(
                `Instance History - ${row?.worldName || 'World'}`
            );
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.game_log.generated_toast.failed_to_load_instance_history'
                      )
            );
        } finally {
            setLoadingPreviousInstancesKey('');
        }
    }
    async function copyGameLogDetail(row) {
        const text = getGameLogCopyTarget(row);
        if (!text) {
            return;
        }
        await copyTextToClipboard(text);
        toast.success(t('view.game_log.generated.copied_game_log_detail'));
    }
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
    const columns = useMemo(
        () =>
            buildGameLogColumns({
                deletingGameLogKey,
                loadingPreviousInstancesKey,
                onCopyDetail: copyGameLogDetail,
                onDeleteRow: deleteGameLogRow,
                onOpenPreviousInstances: openPreviousInstancesForRow,
                onOpenUser: openGameLogUser,
                shiftHeld,
                t
            }),
        [deletingGameLogKey, loadingPreviousInstancesKey, shiftHeld, t]
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
    function commitSearchDraft() {
        setSearchQuery(searchDraft);
    }
    function syncSessionDateDraft() {
        setSessionDateDraftFrom(isoToGameLogDateInputValue(sessionDateFrom));
        setSessionDateDraftTo(isoToGameLogDateInputValue(sessionDateTo));
    }
    function updateSessionDateDraftRange(range) {
        const nextFrom = toGameLogDateInputValue(range?.from);
        const nextTo = toGameLogDateInputValue(range?.to);
        if (!nextFrom || !nextTo) {
            setSessionDateDraftFrom(nextFrom);
            setSessionDateDraftTo(nextTo);
            return;
        }
        const [clampedFrom, clampedTo] = clampGameLogSessionDateInputRange(
            nextFrom,
            nextTo
        );
        setSessionDateDraftFrom(clampedFrom);
        setSessionDateDraftTo(clampedTo);
    }
    function applySessionDateRange() {
        if (!sessionDateDraftFrom && !sessionDateDraftTo) {
            setSessionDateFrom('');
            setSessionDateTo('');
            setSessionDatePopoverOpen(false);
            return;
        }
        const [fromInput, toInput] = clampGameLogSessionDateInputRange(
            sessionDateDraftFrom || sessionDateDraftTo,
            sessionDateDraftTo || sessionDateDraftFrom
        );
        setSessionDateDraftFrom(fromInput);
        setSessionDateDraftTo(toInput);
        setSessionDateFrom(toGameLogIsoRangeStart(fromInput));
        setSessionDateTo(toGameLogIsoRangeEnd(toInput));
        setSessionDatePopoverOpen(false);
    }
    function clearSessionDateRange() {
        setSessionDateDraftFrom('');
        setSessionDateDraftTo('');
        setSessionDateFrom('');
        setSessionDateTo('');
        setSessionDatePopoverOpen(false);
    }
    function changeViewMode(nextViewMode) {
        setSavedViewMode(nextViewMode);
        void configRepository.setString('gameLogViewMode', nextViewMode);
    }
    function toggleFavoritesOnly() {
        setActiveFavoritesOnly((current) => !current);
    }
    function handleSessionDatePopoverChange(open) {
        if (open) {
            syncSessionDateDraft();
        }
        setSessionDatePopoverOpen(open);
    }
    function clearSearch() {
        setSearchDraft('');
        setSearchQuery('');
    }
    function refreshGameLog() {
        setRefreshToken((value) => value + 1);
    }
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
