import {
    getCoreRowModel,
    getExpandedRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useTodayDate } from '@/lib/useTodayDate.js';
import {
    configRepository,
    FEED_FILTER_TYPES,
    feedRepository,
    friendLogRepository,
    gameLogRepository,
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { buildFeedColumns } from './components/FeedColumns.jsx';
import {
    buildFeedFavoriteIdSet as buildFavoriteIdSet,
    canRequestInviteFromFeedFriend,
    collectMatchingLiveFeedEntries,
    getFeedRowId,
    mergeLiveFeedEntries,
    normalizeFeedId as normalizeId,
    parseDateInput,
    resolveDisplayNameCandidate,
    resolveFeedCurrentInviteLocation as resolveCurrentInviteLocation,
    resolveFeedUserId,
    toDateInputValue,
    toIsoRangeEnd,
    toIsoRangeStart
} from './feedRows.js';
import {
    FEED_TABLE_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedFeedTableState as readPersistedState,
    resolveFeedPageSize as resolvePageSize,
    safeJsonParse,
    sanitizeFeedColumnOrder as sanitizeColumnOrder,
    sanitizeFeedColumnSizing as sanitizeColumnSizing,
    sanitizeFeedColumnVisibility as sanitizeColumnVisibility,
    sanitizeFeedPageSizes as sanitizePageSizes,
    sanitizeFeedSorting as sanitizeSorting,
    writePersistedFeedTableState as writePersistedState
} from './feedTableState.js';
import { useFeedPageActions } from './useFeedPageActions.js';
import { useFeedPageEffects } from './useFeedPageEffects.js';
export function useFeedPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            isGameRunning
        }),
        [isGameRunning, runtimeCurrentDestination, runtimeCurrentLocation]
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const remoteFavoritesById = useFavoriteStore(
        (state) => state.remoteFavoritesById
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const friendRosterLastLoadedAt = useFriendRosterStore(
        (state) => state.lastLoadedAt
    );
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const maxFeedRows = usePreferencesStore(
        (state) => state.tableLimits.maxTableSize
    );
    const favoriteGroupFilterIds = usePreferencesStore(
        (state) => state.localFavoriteFriendsGroups
    );
    const [persistedState] = useState(() => readPersistedState());
    const persistedPageSize = Number.parseInt(persistedState.pageSize, 10);
    const initialPageSizes = DEFAULT_PAGE_SIZES;
    const requestIdRef = useRef(0);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenColumnVisibilityRef = useRef(false);
    const hasWrittenTableLayoutRef = useRef(false);
    const lastLiveFeedSequenceRef = useRef(0);
    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [dateDraftFrom, setDateDraftFrom] = useState('');
    const [dateDraftTo, setDateDraftTo] = useState('');
    const [dateFilterOpen, setDateFilterOpen] = useState(false);
    const [activeFilters, setActiveFilters] = useState([]);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [rows, setRows] = useState([]);
    const [friendLogNamesById, setFriendLogNamesById] = useState({});
    const [loadStatus, setLoadStatus] = useState('idle');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [expanded, setExpanded] = useState({});
    const [pageSizes, setPageSizes] = useState(initialPageSizes);
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [previousInstancesRows, setPreviousInstancesRows] = useState([]);
    const [previousInstancesTitle, setPreviousInstancesTitle] =
        useState('Instance History');
    const [loadingPreviousInstancesKey, setLoadingPreviousInstancesKey] =
        useState('');
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
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: resolvePageSize(persistedPageSize, initialPageSizes)
    });
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const favoriteIdSet = useMemo(
        () =>
            buildFavoriteIdSet(
                remoteFavoritesById,
                localFriendFavorites,
                favoriteGroupFilterIds
            ),
        [favoriteGroupFilterIds, localFriendFavorites, remoteFavoritesById]
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const dateDraftRange = useMemo(() => {
        const from = parseDateInput(dateDraftFrom);
        const to = parseDateInput(dateDraftTo);
        return from || to
            ? {
                  from,
                  to
              }
            : undefined;
    }, [dateDraftFrom, dateDraftTo]);
    const todayDate = useTodayDate();
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );
    const canSendInviteFromFeed = Boolean(
        gameState?.isGameRunning &&
        currentInviteLocation &&
        canInviteFromCurrentLocation
    );
    const canBoopFromFeed = Boolean(currentUserSnapshot?.isBoopingEnabled);
    const activeFilterCount = dateFrom || dateTo ? 1 : 0;
    const {
        setFeedFilters,
        toggleFeedFilter,
        commitSearch,
        clearSearch,
        applyDateFilter,
        clearDateFilter,
        openPreviousInstancesForLocation,
        canUseFeedFriendLocation,
        launchFeedFriendLocation,
        selfInviteFeedFriendLocation,
        sendFeedFriendInvite,
        requestFeedFriendInvite,
        sendFeedFriendBoop,
        openFeedNewInstance
    } = useFeedPageActions({
        FEED_FILTER_TYPES,
        canInviteFromCurrentLocation,
        canRequestInviteFromFeedFriend,
        checkCanInviteSelf,
        confirm,
        currentEndpoint,
        currentInviteLocation,
        currentUserId,
        currentUserSnapshot,
        dateDraftFrom,
        dateDraftTo,
        friendsMap,
        gameLogRepository,
        loadingPreviousInstancesKey,
        normalizeId,
        notificationRepository,
        openWorldDialog,
        parseLocation,
        prompt,
        searchDraft,
        selfInviteToInstance,
        setActiveFilters,
        setDateDraftFrom,
        setDateDraftTo,
        setDateFilterOpen,
        setDateFrom,
        setDateTo,
        setLoadingPreviousInstancesKey,
        setPreviousInstancesOpen,
        setPreviousInstancesRows,
        setPreviousInstancesTitle,
        setSearchDraft,
        setSearchQuery,
        t,
        toast,
        tryOpenLaunchLocation,
        vrchatSearchRepository
    });
    useFeedPageEffects({
        DEFAULT_PAGE_SIZES,
        FEED_FILTER_TYPES,
        activeFilters,
        collectMatchingLiveFeedEntries,
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        configRepository,
        currentUserId,
        dateFilterOpen,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        feedRepository,
        friendLogNamesById,
        friendLogRepository,
        friendRosterLastLoadedAt,
        gameLogRepository,
        getTablePageSizePreference,
        getTablePageSizesPreference,
        hasWrittenColumnVisibilityRef,
        hasWrittenPageSizeRef,
        hasWrittenSortingRef,
        hasWrittenTableLayoutRef,
        isFavoritesLoaded,
        lastLiveFeedSequenceRef,
        maxFeedRows,
        mergeLiveFeedEntries,
        normalizeId,
        pagination,
        persistedPageSize,
        preferencesHydrated,
        preferencesReady,
        requestIdRef,
        resolveDisplayNameCandidate,
        resolveFeedUserId,
        resolvePageSize,
        rows,
        safeJsonParse,
        sanitizeColumnOrder,
        sanitizeColumnSizing,
        sanitizeColumnVisibility,
        sanitizePageSizes,
        sanitizeSorting,
        setDateDraftFrom,
        setDateDraftTo,
        setFavoritesOnly,
        setFeedFilters,
        setFriendLogNamesById,
        setLoadStatus,
        setPageSizes,
        setPagination,
        setPreferencesReady,
        setRows,
        sorting,
        tablePageSizesPreference,
        toIsoRangeEnd,
        toIsoRangeStart,
        useFeedLiveStore,
        writePersistedState
    });
    const columns = useMemo(
        () =>
            buildFeedColumns({
                canBoopFromFeed,
                canSendInviteFromFeed,
                canUseFeedFriendLocation,
                currentEndpoint,
                currentUserId,
                currentUserSnapshot,
                friendLogNamesById,
                friendsById,
                launchFeedFriendLocation,
                loadingPreviousInstancesKey,
                onNewInstance: openFeedNewInstance,
                onOpenPreviousInstances: openPreviousInstancesForLocation,
                requestFeedFriendInvite,
                selfInviteFeedFriendLocation,
                sendFeedFriendBoop,
                sendFeedFriendInvite,
                t
            }),
        [
            canBoopFromFeed,
            canInviteFromCurrentLocation,
            canSendInviteFromFeed,
            confirm,
            currentEndpoint,
            currentInviteLocation,
            currentUserId,
            currentUserSnapshot,
            friendsById,
            friendLogNamesById,
            friendsMap,
            launchFeedFriendLocation,
            loadingPreviousInstancesKey,
            openFeedNewInstance,
            openPreviousInstancesForLocation,
            prompt,
            requestFeedFriendInvite,
            selfInviteFeedFriendLocation,
            sendFeedFriendBoop,
            sendFeedFriendInvite,
            t
        ]
    );
    const table = useReactTable({
        data: rows,
        columns,
        state: {
            expanded,
            columnVisibility,
            columnOrder,
            columnSizing,
            sorting,
            pagination
        },
        onExpandedChange: setExpanded,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowId: (row) => getFeedRowId(row),
        getRowCanExpand: () => true,
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });
    return {
        embedded,
        t,
        toolbarState: {
            activeFilterCount,
            activeFilters,
            dateDraftFrom,
            dateDraftRange,
            dateDraftTo,
            dateFilterOpen,
            feedFilterTypes: FEED_FILTER_TYPES,
            favoritesOnly,
            searchDraft,
            table,
            todayDate
        },
        toolbarActions: {
            onApplyDateFilter: applyDateFilter,
            onClearDateFilter: clearDateFilter,
            onClearFeedFilters: () => setFeedFilters([]),
            onClearSearch: clearSearch,
            onDateFilterOpenChange: setDateFilterOpen,
            onDateRangeSelect: (range) => {
                setDateDraftFrom(toDateInputValue(range?.from));
                setDateDraftTo(toDateInputValue(range?.to));
            },
            onSearchBlur: () => commitSearch(),
            onSearchDraftChange: setSearchDraft,
            onSearchEnter: (value) => commitSearch(value),
            onToggleFavoritesOnly: () =>
                setFavoritesOnly((current) => !current),
            onToggleFeedFilter: toggleFeedFilter
        },
        tableState: {
            columns,
            currentEndpoint,
            favoritesOnly,
            isFavoritesLoaded,
            loadStatus,
            loadingPreviousInstancesKey,
            pageSizes,
            pagination,
            resolvePageSize,
            rows,
            table
        },
        tableActions: {
            onNewInstance: openFeedNewInstance,
            onOpenPreviousInstances: openPreviousInstancesForLocation,
            onPageSizeChange: setPagination,
            onPreviewImage: openImagePreview
        },
        previousInstancesDialog: {
            open: previousInstancesOpen,
            rows: previousInstancesRows,
            title: previousInstancesTitle,
            onOpenChange: setPreviousInstancesOpen,
            onRowsChange: setPreviousInstancesRows
        }
    };
}
