import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageScaffold } from '@/components/layout/PageScaffold.jsx';
import {
    gameLogRepository,
    memoRepository,
    mutualGraphRepository,
    vrchatFriendRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import friendRelationshipService from '@/services/friendRelationshipService.js';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService.js';
import { executeWithBackoff } from '@/shared/utils/retry.js';
import { createRateLimiter } from '@/shared/utils/throttle.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { buildFriendListColumns } from './components/FriendListColumns.jsx';
import { FriendListTable } from './components/FriendListTable.jsx';
import { FriendListToolbar } from './components/FriendListToolbar.jsx';
import { FriendListUserLoadDialog } from './components/FriendListUserLoadDialog.jsx';
import {
    buildFriendListFavoriteIdSet as buildFavoriteIdSet,
    buildFriendListUserStatsById as buildUserStatsById,
    filterFriendListRows,
    normalizeFriendListId as normalizeId
} from './friendListRows.js';
import {
    FRIEND_LIST_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedFriendListState as readPersistedState,
    resolveFriendListPageSize as resolvePageSize,
    sanitizeFriendListColumnOrder as sanitizeColumnOrder,
    sanitizeFriendListColumnSizing as sanitizeColumnSizing,
    sanitizeFriendListColumnVisibility as sanitizeColumnVisibility,
    sanitizeFriendListPageSizes as sanitizePageSizes,
    sanitizeFriendListSorting as sanitizeSorting,
    writePersistedFriendListState as writePersistedState
} from './friendListState.js';
import { useFriendListPageActions } from './useFriendListPageActions.js';
import { useFriendListPageEffects } from './useFriendListPageEffects.js';
export function useFriendListPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const friendLoadStatus = useFriendRosterStore((state) => state.loadStatus);
    const friendDetail = useFriendRosterStore((state) => state.detail);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const confirm = useModalStore((state) => state.confirm);
    const applyFriendPatch = useFriendRosterStore(
        (state) => state.applyFriendPatch
    );
    const applyFriendPatches = useFriendRosterStore(
        (state) => state.applyFriendPatches
    );
    const [persistedState] = useState(() => readPersistedState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const cancelUserLoadRef = useRef(false);
    const statsHydrationRequestRef = useRef(0);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [activeSearchFilterIds, setActiveSearchFilterIds] = useState(
        () => new Set()
    );
    const [bulkUnfriendMode, setBulkUnfriendMode] = useState(false);
    const [selectedFriendIds, setSelectedFriendIds] = useState(() => new Set());
    const [deletingFriendIds, setDeletingFriendIds] = useState(() => new Set());
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [userMemoById, setUserMemoById] = useState(() => new Map());
    const [userNoteById, setUserNoteById] = useState(() => new Map());
    const [isLoadingUserDetails, setIsLoadingUserDetails] = useState(false);
    const [userLoadProgress, setUserLoadProgress] = useState({
        current: 0,
        total: 0,
        open: false,
        cancelled: false
    });
    const [isMutualFetching, setIsMutualFetching] = useState(false);
    const [mutualProgress, setMutualProgress] = useState({
        current: 0,
        total: 0
    });
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
    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const rosterRows = useMemo(
        () =>
            orderedFriendIds
                .map((friendId, index) => {
                    const friend = friendsById[friendId];
                    if (!friend) {
                        return null;
                    }
                    const friendNumber =
                        Number.parseInt(
                            friend.$friendNumber ?? friend.friendNumber ?? 0,
                            10
                        ) || 0;
                    if (friendNumber > 0) {
                        return friend;
                    }
                    return {
                        ...friend,
                        friendNumber: index + 1,
                        $friendNumber: index + 1
                    };
                })
                .filter(Boolean),
        [friendsById, orderedFriendIds]
    );
    const rosterStatsKey = useMemo(
        () =>
            rosterRows
                .map(
                    (friend) =>
                        `${normalizeId(friend?.id)}:${friend?.displayName || ''}`
                )
                .join('\u0001'),
        [rosterRows]
    );
    const filteredRows = useMemo(() => {
        return filterFriendListRows({
            rosterRows,
            favoritesOnly,
            favoriteFriendIds,
            searchQuery,
            activeSearchFilterIds,
            userMemoById,
            userNoteById
        });
    }, [
        activeSearchFilterIds,
        favoriteFriendIds,
        favoritesOnly,
        rosterRows,
        searchQuery,
        userMemoById,
        userNoteById
    ]);
    useFriendListPageEffects({
        DEFAULT_PAGE_SIZES,
        activeSearchFilterIds,
        applyFriendPatches,
        buildUserStatsById,
        bulkUnfriendMode,
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        currentUserId,
        favoritesOnly,
        filteredRows,
        gameLogRepository,
        getTablePageSizesPreference,
        getTablePageSizePreference,
        hasWrittenPageSizeRef,
        hasWrittenSortingRef,
        hasWrittenTableStateRef,
        isFavoritesLoaded,
        memoRepository,
        mutualGraphRepository,
        normalizeId,
        pagination,
        persistedState,
        preferencesHydrated,
        resolvePageSize,
        rosterRows,
        rosterStatsKey,
        sanitizeColumnOrder,
        sanitizeColumnSizing,
        sanitizeColumnVisibility,
        sanitizePageSizes,
        sanitizeSorting,
        searchQuery,
        setFavoritesOnly,
        setPageSizes,
        setPagination,
        setSelectedFriendIds,
        setUserMemoById,
        setUserNoteById,
        sorting,
        statsHydrationRequestRef,
        tablePageSizesPreference,
        writePersistedState
    });
    const {
        toggleSelectedFriend,
        confirmDeleteFriend,
        bulkUnfriendSelected,
        loadFriendUserDetails,
        cancelFriendUserDetailsLoad,
        loadMutualFriends,
        resetFriendListTableLayout,
        openFriendDetails
    } = useFriendListPageActions({
        applyFriendPatch,
        cancelUserLoadRef,
        confirm,
        createRateLimiter,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        executeWithBackoff,
        filteredRows,
        friendRelationshipService,
        friendsById,
        isLoadingUserDetails,
        isMutualFetching,
        mutualGraphRepository,
        normalizeId,
        openUserDialog,
        rosterRows,
        selectedFriendIds,
        setColumnOrder,
        setColumnSizing,
        setColumnVisibility,
        setDeletingFriendIds,
        setIsBulkDeleting,
        setIsLoadingUserDetails,
        setIsMutualFetching,
        setMutualProgress,
        setSelectedFriendIds,
        setUserLoadProgress,
        t,
        toast,
        vrchatFriendRepository
    });
    const tableColumns = useMemo(
        () =>
            buildFriendListColumns({
                bulkUnfriendMode,
                currentUserId,
                deletingFriendIds,
                onConfirmDeleteFriend: confirmDeleteFriend,
                onToggleSelectedFriend: toggleSelectedFriend,
                randomUserColours,
                selectedFriendIds,
                t
            }),
        [
            bulkUnfriendMode,
            confirmDeleteFriend,
            currentUserId,
            deletingFriendIds,
            randomUserColours,
            selectedFriendIds,
            t,
            toggleSelectedFriend
        ]
    );
    const table = useReactTable({
        data: filteredRows,
        columns: tableColumns,
        state: {
            columnOrder,
            columnSizing,
            columnVisibility: {
                ...columnVisibility,
                friendNumber: true,
                bulkSelect: bulkUnfriendMode
            },
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
    const hasRows = filteredRows.length > 0;
    const isLoading = friendLoadStatus === 'running' && rosterRows.length === 0;
    const isError = friendLoadStatus === 'error' && rosterRows.length === 0;
    const isMutualOptOut = Boolean(
        currentUserSnapshot?.hasSharedConnectionsOptOut
    );
    const userLoadPercent = userLoadProgress.total
        ? Math.min(
              100,
              Math.round(
                  (userLoadProgress.current / userLoadProgress.total) * 100
              )
          )
        : 0;
    const toolbarDetail = isMutualFetching
        ? t('view.friend_list.generated.loading_mutual_friends_progress', {
              current: mutualProgress.current,
              total: mutualProgress.total
          })
        : friendDetail;
    return {
        PageScaffold,
        embedded,
        FriendListToolbar,
        t,
        favoritesOnly,
        isFavoritesLoaded,
        activeSearchFilterIds,
        searchQuery,
        bulkUnfriendMode,
        selectedFriendIds,
        isBulkDeleting,
        isMutualOptOut,
        isMutualFetching,
        currentUserId,
        isLoadingUserDetails,
        table,
        toolbarDetail,
        setFavoritesOnly,
        setActiveSearchFilterIds,
        setSearchQuery,
        bulkUnfriendSelected,
        setBulkUnfriendMode,
        loadMutualFriends,
        loadFriendUserDetails,
        resetFriendListTableLayout,
        FriendListTable,
        pageCount,
        pageSizes,
        pagination,
        filteredRows,
        friendDetail,
        isLoading,
        isError,
        hasRows,
        resolvePageSize,
        setPagination,
        openFriendDetails,
        FriendListUserLoadDialog,
        userLoadProgress,
        userLoadPercent,
        cancelFriendUserDetailsLoad
    };
}
