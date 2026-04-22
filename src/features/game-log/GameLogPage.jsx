import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    CalendarRangeIcon,
    CopyIcon,
    ExternalLinkIcon,
    FileTextIcon,
    LogsIcon,
    RefreshCwIcon,
    SearchIcon,
    StarIcon,
    Table2Icon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import {
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    DataTableHeader,
    DataTablePagination,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import {
    LoadingState,
    PageBody,
    PageFooter,
    PageScaffold,
    PageToolbar
} from '@/components/layout/PageScaffold.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import { copyTextToClipboard, openExternalLink } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import {
    configRepository,
    GAME_LOG_FILTER_TYPES,
    gameLogRepository
} from '@/repositories/index.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';
import { TableBody, TableRow } from '@/ui/shadcn/table';

import {
    clampGameLogSessionDateInputRange,
    GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS,
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
    GAME_LOG_DETAILLESS_TYPES,
    getGameLogCopyTarget,
    getGameLogExternalTarget,
    getGameLogRowKey,
    resolveGameLogWorldId as resolveWorldId,
    resolveGameLogWorldTarget as resolveWorldTarget,
    shouldLinkGameLogPrimaryDetailToWorld as shouldLinkPrimaryDetailToWorld
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
    writePersistedGameLogState
} from './gameLogState.js';
import { appI18n } from '@/services/i18nService.js';

import {
    EmptyTableValue,
    GameLogEmptyState,
    GameLogLocationDetail,
    GameLogSessionsView,
    SESSION_FILTER_TYPES,
    SortButton,
    TypeFilterDropdown,
    TypeFilterToggleGroup,
    normalizeId,
    openGameLogUser
} from './components/GameLogTableParts.jsx';

function getGameLogColumnStyle(column) {
    if (column?.id !== GAME_LOG_STRETCH_COLUMN_ID) {
        return undefined;
    }

    return { width: undefined };
}

export function GameLogPage({ embedded = false } = {}) {
    const { t } = useI18n();
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
        return from || to ? { from, to } : undefined;
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
                    'No authenticated user is available for the game log snapshot.'
                );
            }
            return;
        }

        if (gameLogDisabled) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail('Game log ingestion is disabled.');
            return;
        }

        if (favoritesOnly && !isFavoritesLoaded) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail('Favorites are still hydrating.');
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
                        'Failed to load the game log snapshot.'
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
                title: appI18n.t('view.game_log.generated_modal.delete_game_log_row'),
                description: detailValue.primary || row.type || row.created_at,
                confirmText: appI18n.t('common.actions.delete'),
                cancelText: appI18n.t('common.actions.cancel'),
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
                    : appI18n.t('view.game_log.generated_toast.failed_to_delete_game_log_row')
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
                    : appI18n.t('view.game_log.generated_toast.failed_to_load_instance_history')
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
                size: 140,
                accessorFn: (row) => row?.created_at || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.gameLog.date')}
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
                size: 150,
                accessorFn: (row) => row?.type || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.gameLog.type')}
                    />
                ),
                cell: ({ row }) => {
                    const worldTarget = resolveWorldTarget(row.original);
                    const typeLabel = row.original?.type
                        ? t(`view.game_log.filters.${row.original.type}`)
                        : '';
                    if (row.original?.type !== 'Location' && worldTarget) {
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto p-0"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openWorldDialog({
                                        worldId: worldTarget,
                                        title:
                                            row.original?.worldName ||
                                            worldTarget
                                    });
                                }}
                            >
                                <Badge
                                    variant="outline"
                                    className="text-muted-foreground"
                                >
                                    {typeLabel}
                                </Badge>
                            </Button>
                        );
                    }

                    return (
                        <Badge
                            variant="outline"
                            className="text-muted-foreground"
                        >
                            {typeLabel}
                        </Badge>
                    );
                }
            },
            {
                id: 'displayName',
                size: 200,
                accessorFn: (row) => row?.displayName || row?.userId || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.gameLog.user')}
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
                cell: ({ row }) => {
                    const displayName = row.original?.displayName || '';
                    const userId = normalizeId(row.original?.userId);
                    const canOpenUser = Boolean(
                        displayName && (userId || row.original?.displayName)
                    );
                    return (
                        <div className="flex min-w-0 items-center gap-1 text-sm">
                            {canOpenUser ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="hover:text-primary h-auto min-w-0 p-0 text-left text-sm"
                                    onClick={() =>
                                        void openGameLogUser(row.original)
                                    }
                                >
                                    <span className="truncate">
                                        {displayName}
                                    </span>
                                </Button>
                            ) : (
                                <span className="truncate">{displayName}</span>
                            )}
                            {row.original?.isFriend ? (
                                <span className="shrink-0">
                                    {row.original?.isFavorite ? '⭐' : '💚'}
                                </span>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'detail',
                minSize: 150,
                accessorFn: (row) => {
                    const detailValue = describeGameLogDetail(row);
                    return [detailValue.primary, detailValue.secondary]
                        .filter(Boolean)
                        .join(' ');
                },
                enableSorting: false,
                header: () => t('table.gameLog.detail'),
                cell: ({ row }) => {
                    const detailValue = describeGameLogDetail(row.original);
                    const worldTarget = resolveWorldTarget(row.original);
                    if (
                        row.original?.type === 'Location' ||
                        row.original?.type === 'PortalSpawn'
                    ) {
                        return (
                            <GameLogLocationDetail
                                row={row.original}
                                detailValue={detailValue}
                                worldTarget={worldTarget}
                                onPreviousInstances={(targetRow) =>
                                    void openPreviousInstancesForRow(targetRow)
                                }
                            />
                        );
                    }
                    if (GAME_LOG_DETAILLESS_TYPES.has(row.original?.type)) {
                        return <EmptyTableValue />;
                    }
                    const canOpenWorld =
                        worldTarget &&
                        shouldLinkPrimaryDetailToWorld(row.original);
                    const externalTarget = getGameLogExternalTarget(
                        row.original
                    );
                    const copyTarget = getGameLogCopyTarget(row.original);
                    if (
                        !detailValue.primary &&
                        !detailValue.secondary &&
                        !externalTarget &&
                        !copyTarget
                    ) {
                        return <EmptyTableValue />;
                    }
                    return (
                        <div
                            className="flex min-w-0 items-center gap-1.5 text-sm"
                            title={[detailValue.primary, detailValue.secondary]
                                .filter(Boolean)
                                .join(' · ')}
                        >
                            {canOpenWorld ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="hover:text-primary h-auto min-w-0 p-0 text-left text-sm"
                                    onClick={() =>
                                        openWorldDialog({
                                            worldId: worldTarget,
                                            title:
                                                row.original?.worldName ||
                                                detailValue.primary ||
                                                worldTarget
                                        })
                                    }
                                >
                                    <span className="truncate">
                                        {detailValue.primary}
                                    </span>
                                </Button>
                            ) : (
                                <span className="min-w-0 truncate">
                                    {detailValue.primary}
                                </span>
                            )}
                            {detailValue.secondary ? (
                                <span className="text-muted-foreground min-w-0 truncate text-xs">
                                    {detailValue.secondary}
                                </span>
                            ) : null}
                            {externalTarget || copyTarget ? (
                                <div className="ml-auto flex shrink-0 items-center gap-1">
                                    {externalTarget ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={"Open link"}
                                            className="size-6 p-0"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void openExternalLink(
                                                    externalTarget
                                                );
                                            }}
                                        >
                                            <ExternalLinkIcon data-icon="inline-start" />
                                        </Button>
                                    ) : null}
                                    {copyTarget ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={"Copy detail"}
                                            className="size-6 p-0"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void copyGameLogDetail(
                                                    row.original
                                                );
                                            }}
                                        >
                                            <CopyIcon data-icon="inline-start" />
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'action',
                size: 90,
                minSize: 90,
                maxSize: 90,
                header: () => t('table.gameLog.action'),
                enableSorting: false,
                cell: ({ row }) => {
                    const rowKey = getGameLogRowKey(row.original);
                    const canDelete = canDeleteGameLogRow(row.original);
                    const canShowPrevious =
                        row.original?.type === 'Location' &&
                        resolveWorldId(row.original);

                    if (!canDelete && !canShowPrevious) {
                        return <EmptyTableValue align="right" />;
                    }

                    return (
                        <div className="flex items-center justify-end gap-2">
                            {canDelete ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={
                                        shiftHeld
                                            ? 'Delete game log row without confirmation'
                                            : 'Delete game log row'
                                    }
                                    className="text-muted-foreground hover:text-destructive size-6 p-0"
                                    disabled={deletingGameLogKey === rowKey}
                                    onClick={(event) =>
                                        void deleteGameLogRow(row.original, {
                                            skipConfirm:
                                                shiftHeld || event.shiftKey
                                        })
                                    }
                                >
                                    {deletingGameLogKey === rowKey ? (
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
                            ) : null}
                            {canShowPrevious ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={"Show instance history"}
                                    className="text-muted-foreground hover:text-foreground size-6 p-0"
                                    disabled={
                                        loadingPreviousInstancesKey === rowKey
                                    }
                                    onClick={() =>
                                        void openPreviousInstancesForRow(
                                            row.original
                                        )
                                    }
                                >
                                    {loadingPreviousInstancesKey === rowKey ? (
                                        <Spinner data-icon="inline-start" />
                                    ) : (
                                        <FileTextIcon data-icon="inline-start" />
                                    )}
                                </Button>
                            ) : null}
                        </div>
                    );
                }
            }
        ],
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

    function renderViewModeToggle() {
        return (
            <div className="flex shrink-0 rounded-md border p-0.5">
                <Button
                    type="button"
                    size="icon"
                    variant={savedViewMode === 'sessions' ? 'default' : 'ghost'}
                    title={t('view.game_log.generated.sessions')}
                    aria-label={"Show sessions"}
                    onClick={() => {
                        setSavedViewMode('sessions');
                        void configRepository.setString(
                            'gameLogViewMode',
                            'sessions'
                        );
                    }}
                >
                    <LogsIcon data-icon="inline-start" />
                </Button>
                <Button
                    type="button"
                    size="icon"
                    variant={savedViewMode === 'table' ? 'default' : 'ghost'}
                    title={t('view.game_log.generated.table')}
                    aria-label={"Show table"}
                    onClick={() => {
                        setSavedViewMode('table');
                        void configRepository.setString(
                            'gameLogViewMode',
                            'table'
                        );
                    }}
                >
                    <Table2Icon data-icon="inline-start" />
                </Button>
            </div>
        );
    }

    function renderFavoritesToggle() {
        return (
            <Button
                type="button"
                variant={favoritesOnly ? 'default' : 'outline'}
                size="icon"
                title={t('view.game_log.generated.favorites_only')}
                aria-label={"Favorites only"}
                onClick={() => setActiveFavoritesOnly((current) => !current)}
            >
                <StarIcon data-icon="inline-start" />
            </Button>
        );
    }

    function renderSessionDateFilter() {
        return (
            <Popover
                open={sessionDatePopoverOpen}
                onOpenChange={(open) => {
                    if (open) {
                        syncSessionDateDraft();
                    }
                    setSessionDatePopoverOpen(open);
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                            'h-8 shrink-0 gap-1.5',
                            (sessionDateFrom || sessionDateTo) &&
                                'bg-accent text-accent-foreground'
                        )}
                        title={t('view.game_log.generated.session_date_range')}
                        aria-label={"Session date range"}
                    >
                        <CalendarRangeIcon data-icon="inline-start" />
                        {sessionDateFrom || sessionDateTo ? (
                            <Badge
                                variant="secondary"
                                className="ml-0.5 h-4.5 min-w-4.5 rounded-full px-1 text-xs"
                            >
                                1
                            </Badge>
                        ) : null}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto" align="start">
                    <Calendar
                        mode="range"
                        numberOfMonths={2}
                        max={GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS}
                        selected={sessionDateDraftRange}
                        disabled={{ after: todayDate }}
                        onSelect={updateSessionDateDraftRange}
                    />
                    <div className="flex items-center justify-between gap-4 px-3 pb-3">
                        <div className="text-muted-foreground min-w-0 text-xs">
                            {[
                                sessionDateDraftFrom || '...',
                                sessionDateDraftTo || '...'
                            ].join(' - ')}
                            <span className="ml-2">
                                {t('view.game_log.generated.max')} {GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS} {t('view.game_log.generated.days')}
                            </span>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={clearSessionDateRange}
                            >
                                {t('common.actions.clear')}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={applySessionDateRange}
                            >
                                {t('common.actions.confirm')}
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        );
    }

    function renderSearchInput(className = 'min-w-56 flex-1') {
        return (
            <InputGroup className={className}>
                <InputGroupAddon>
                    <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    onBlur={commitSearchDraft}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            commitSearchDraft();
                        }
                    }}
                    placeholder={t('common.actions.search')}
                />
                {searchDraft ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            aria-label={"Clear search"}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                                setSearchDraft('');
                                setSearchQuery('');
                            }}
                        >
                            <XIcon data-icon="icon" />
                        </InputGroupButton>
                    </InputGroupAddon>
                ) : null}
            </InputGroup>
        );
    }

    function renderTableControls() {
        return (
            <div className="flex shrink-0 items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title={t('common.actions.refresh')}
                    aria-label={"Refresh game log"}
                    disabled={
                        !currentUserId ||
                        gameLogDisabled ||
                        loadStatus === 'running'
                    }
                    onClick={() => setRefreshToken((value) => value + 1)}
                >
                    {loadStatus === 'running' ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                    )}
                </Button>
                {savedViewMode === 'table' ? (
                    <TableColumnVisibilityMenu table={table} />
                ) : null}
            </div>
        );
    }

    return (
        <PageScaffold embedded={embedded}>
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                <PageToolbar>
                    {savedViewMode === 'table' ? (
                        <div className="overflow-hidden pb-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <div className="flex shrink-0 items-center gap-2">
                                    {renderViewModeToggle()}
                                    {renderFavoritesToggle()}
                                </div>
                                <div className="min-w-44">
                                    <TypeFilterDropdown
                                        types={availableFilterTypes}
                                        selectedTypes={queryFilterTypes}
                                        onSelectedTypesChange={
                                            setActiveSelectedTypes
                                        }
                                    />
                                </div>
                                {renderSearchInput('ml-auto w-60 shrink-0')}
                                {renderTableControls()}
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-hidden pb-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {renderViewModeToggle()}
                                {renderFavoritesToggle()}
                                {renderSessionDateFilter()}
                                <TypeFilterToggleGroup
                                    types={availableFilterTypes}
                                    selectedTypes={queryFilterTypes}
                                    onSelectedTypesChange={
                                        setActiveSelectedTypes
                                    }
                                    className="flex shrink-0 items-center gap-1"
                                />
                                {renderSearchInput('ml-auto w-60 shrink-0')}
                                {renderTableControls()}
                            </div>
                        </div>
                    )}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                'Failed to load the game log snapshot.'
                            )}
                        </div>
                    ) : null}
                </PageToolbar>

                <PageBody>
                    {isLoading ? (
                        <LoadingState label={t('view.game_log.generated.loading_the_game_log_snapshot')} />
                    ) : isError ? (
                        <GameLogEmptyState
                            title={t('view.game_log.generated.game_log_failed_to_load')}
                            description={
                                detail || 'The game log query did not complete.'
                            }
                        />
                    ) : gameLogDisabled ? (
                        <GameLogEmptyState
                            title={t('view.game_log.generated.game_log_is_disabled')}
                            description={t('view.game_log.generated.enable_game_log_ingestion_in_settings_before_this_page_can_l')}
                        />
                    ) : savedViewMode === 'sessions' ? (
                        hasSessions ? (
                            <GameLogSessionsView
                                sessions={annotatedSessions}
                                isGameRunning={isGameRunning}
                                hasMore={hasMoreSessions}
                                isLoadingMore={isLoadingMoreSessions}
                                autoFill={
                                    Boolean(deferredSearchQuery.trim()) &&
                                    !sessionDateFrom &&
                                    !sessionDateTo
                                }
                                autoFillKey={`${deferredSearchQuery}:${sessionDateFrom}:${sessionDateTo}:${queryFilterTypes.join(',')}:${favoritesOnly}`}
                                onLoadMore={() =>
                                    setSessionLimit((current) =>
                                        Math.min(
                                            current + pagination.pageSize,
                                            1000
                                        )
                                    )
                                }
                            />
                        ) : (
                            <GameLogEmptyState
                                title={t('view.game_log.generated.no_game_log_sessions_match_the_current_filters')}
                                description={
                                    favoritesOnly && !isFavoritesLoaded
                                        ? 'Favorites are still hydrating.'
                                        : 'Broaden the filters or search query to see more recent sessions.'
                                }
                            />
                        )
                    ) : hasRows ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
                            <DataTableSurface className="overflow-x-hidden overflow-y-auto">
                                <table className="w-full table-fixed caption-bottom text-sm">
                                    <DataTableHeader
                                        table={table}
                                        getHeaderStyle={getGameLogColumnStyle}
                                    />
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow
                                                key={
                                                    row.original?.rowId != null
                                                        ? `${row.original.type}:${row.original.rowId}`
                                                        : row.id
                                                }
                                            >
                                                {row
                                                    .getVisibleCells()
                                                    .map((cell) => (
                                                        <ResizableTableCell
                                                            key={cell.id}
                                                            cell={cell}
                                                            style={getGameLogColumnStyle(
                                                                cell.column
                                                            )}
                                                        />
                                                    ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </table>
                            </DataTableSurface>

                            <PageFooter>
                                <div className="text-muted-foreground text-sm">
                                    {t('view.game_log.generated.showing')}{' '}
                                    <span className="text-foreground font-medium">
                                        {table.getRowModel().rows.length}
                                    </span>{' '}
                                    {t('view.game_log.generated.of')}{' '}
                                    <span className="text-foreground font-medium">
                                        {annotatedRows.length}
                                    </span>{' '}
                                    {t('view.game_log.generated.game_log_row')}
                                    {annotatedRows.length === 1 ? '' : 's'}
                                </div>
                                <DataTablePagination
                                    table={table}
                                    pageIndex={pagination.pageIndex}
                                    pageCount={pageCount}
                                    pageSize={pagination.pageSize}
                                    pageSizes={pageSizes}
                                    pageSizeLabel={t(
                                        'table.pagination.rows_per_page'
                                    )}
                                    onPageSizeChange={(value) => {
                                        const nextPageSize =
                                            resolveGameLogPageSize(
                                                value,
                                                pageSizes,
                                                pagination.pageSize
                                            );
                                        setPagination({
                                            pageIndex: 0,
                                            pageSize: nextPageSize
                                        });
                                        setSessionLimit(nextPageSize);
                                    }}
                                />
                            </PageFooter>
                        </div>
                    ) : (
                        <GameLogEmptyState
                            title={t('view.game_log.generated.no_game_log_rows_match_the_current_filters')}
                            description={
                                favoritesOnly && !isFavoritesLoaded
                                    ? 'Favorites are still hydrating.'
                                    : 'Broaden the filters or search query to see more results.'
                            }
                        />
                    )}
                </PageBody>
            </div>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={previousInstancesTitle}
                instances={previousInstancesRows}
                variant="world"
                onRowsChange={setPreviousInstancesRows}
            />
        </PageScaffold>
    );
}
