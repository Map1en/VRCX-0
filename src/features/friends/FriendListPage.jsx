import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { PageScaffold } from '@/components/layout/PageScaffold.jsx';
import {
    configRepository,
    gameLogRepository,
    memoRepository,
    mutualGraphRepository,
    vrchatFriendRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import friendRelationshipService from '@/services/friendRelationshipService.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { executeWithBackoff } from '@/shared/utils/retry.js';
import { createRateLimiter } from '@/shared/utils/throttle.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

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
import { appI18n } from '@/services/i18nService.js';
import { buildFriendListColumns } from './components/FriendListColumns.jsx';
import { FriendListToolbar } from './components/FriendListToolbar.jsx';
import { FriendListTable } from './components/FriendListTable.jsx';
import { FriendListUserLoadDialog } from './components/FriendListUserLoadDialog.jsx';

export function FriendListPage({ embedded = false } = {}) {
    const { t } = useI18n();
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

    const persistedState = useMemo(() => readPersistedState(), []);
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

    useEffect(() => {
        let active = true;

        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1])
        ])
            .then(([nextPageSizes, nextPageSize]) => {
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
            })
            .catch(() => {});

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
    }, [searchQuery, favoritesOnly, activeSearchFilterIds]);

    useEffect(() => {
        if (!isFavoritesLoaded && favoritesOnly) {
            setFavoritesOnly(false);
        }
    }, [favoritesOnly, isFavoritesLoaded]);

    useEffect(() => {
        let active = true;
        Promise.all([
            memoRepository.getAllUserMemos(),
            memoRepository.getAllUserNotes(currentUserId)
        ])
            .then(([memoRows, noteRows]) => {
                if (!active) {
                    return;
                }
                const nextMemos = new Map();
                for (const row of Array.isArray(memoRows) ? memoRows : []) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextMemos.set(userId, row?.memo || '');
                    }
                }
                const nextNotes = new Map();
                for (const row of Array.isArray(noteRows) ? noteRows : []) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextNotes.set(userId, row?.note || '');
                    }
                }
                setUserMemoById(nextMemos);
                setUserNoteById(nextNotes);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId]);

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

    useEffect(() => {
        if (!rosterRows.length) {
            return undefined;
        }

        let active = true;
        const requestId = statsHydrationRequestRef.current + 1;
        statsHydrationRequestRef.current = requestId;
        const userIds = rosterRows
            .map((friend) => normalizeId(friend?.id))
            .filter(Boolean);
        const displayNames = rosterRows
            .map((friend) => String(friend?.displayName || '').trim())
            .filter(Boolean);

        const mutualSnapshotPromise = currentUserId
            ? mutualGraphRepository.getSnapshot(currentUserId).then(
                  ({ snapshot, meta }) => {
                      const countMap = new Map();
                      for (const [friendId, mutualIds] of snapshot) {
                          countMap.set(friendId, mutualIds.length);
                      }
                      return [countMap, meta];
                  }
              )
            : Promise.resolve([new Map(), new Map()]);

        Promise.all([
            gameLogRepository.getAllUserStats({ userIds, displayNames }),
            mutualSnapshotPromise
        ])
            .then(([statsRows, [mutualCountMap, mutualMetaMap]]) => {
                if (!active || statsHydrationRequestRef.current !== requestId) {
                    return;
                }

                const statsById = buildUserStatsById(statsRows, rosterRows);
                const patches = [];

                for (const friend of rosterRows) {
                    const friendId = normalizeId(friend?.id);
                    if (!friendId) {
                        continue;
                    }

                    const stats = statsById.get(friendId);
                    const mutualCount =
                        Number.parseInt(
                            mutualCountMap instanceof Map
                                ? mutualCountMap.get(friendId)
                                : 0,
                            10
                        ) || 0;
                    const mutualOptedOut = Boolean(
                        mutualMetaMap instanceof Map
                            ? mutualMetaMap.get(friendId)?.optedOut
                            : false
                    );
                    const patch = {
                        $mutualCount: mutualCount,
                        $mutualOptedOut: mutualOptedOut
                    };

                    if (stats) {
                        patch.$joinCount = stats.joinCount;
                        patch.$lastSeen = stats.lastSeen;
                        patch.$timeSpent = stats.timeSpent;
                    }

                    if (
                        (stats &&
                            (friend.$joinCount !== patch.$joinCount ||
                                friend.$lastSeen !== patch.$lastSeen ||
                                friend.$timeSpent !== patch.$timeSpent)) ||
                        (Number.parseInt(friend.$mutualCount ?? 0, 10) || 0) !==
                            mutualCount ||
                        Boolean(friend.$mutualOptedOut) !== mutualOptedOut
                    ) {
                        patches.push({
                            userId: friendId,
                            patch,
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                    }
                }

                if (patches.length) {
                    applyFriendPatches(patches);
                }
            })
            .catch((error) => {
                console.warn(
                    '[FriendListPage] Failed to hydrate friend stats',
                    error
                );
            });

        return () => {
            active = false;
        };
    }, [applyFriendPatches, currentUserId, rosterStatsKey]);

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

    useEffect(() => {
        if (!bulkUnfriendMode) {
            setSelectedFriendIds(new Set());
        }
    }, [bulkUnfriendMode]);

    useEffect(() => {
        const visibleFriendIds = new Set(
            filteredRows
                .map((friend) => normalizeId(friend?.id))
                .filter(Boolean)
        );
        setSelectedFriendIds((current) => {
            const next = new Set(
                [...current].filter((friendId) =>
                    visibleFriendIds.has(friendId)
                )
            );
            return next.size === current.size ? current : next;
        });
    }, [filteredRows]);

    function setFriendDeleting(userId, isDeleting) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }

        setDeletingFriendIds((current) => {
            const next = new Set(current);
            if (isDeleting) {
                next.add(normalizedUserId);
            } else {
                next.delete(normalizedUserId);
            }
            return next;
        });
    }

    function toggleSelectedFriend(userId) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }

        setSelectedFriendIds((current) => {
            const next = new Set(current);
            if (next.has(normalizedUserId)) {
                next.delete(normalizedUserId);
            } else {
                next.add(normalizedUserId);
            }
            return next;
        });
    }

    async function deleteFriendById(userId) {
        const normalizedUserId = normalizeId(userId);
        const friend = friendsById[normalizedUserId];
        if (!normalizedUserId || !friend || !currentUserId) {
            return { stale: false, deleted: false };
        }

        setFriendDeleting(normalizedUserId, true);

        try {
            const result = await friendRelationshipService.deleteFriend({
                friend,
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                currentUserId
            });
            if (!result.stale) {
                setSelectedFriendIds((current) => {
                    const next = new Set(current);
                    next.delete(normalizedUserId);
                    return next;
                });
                toast.success(
                    appI18n.t('view.friends.generated_dynamic.unfriended_value', { value: friend.displayName || normalizedUserId })
                );
            }
            return {
                ...result,
                deleted: !result.stale
            };
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.friends.generated_toast.failed_to_unfriend_value', { value: friend.displayName || normalizedUserId })
            );
            return { stale: false, deleted: false };
        } finally {
            setFriendDeleting(normalizedUserId, false);
        }
    }

    async function confirmDeleteFriend(friend) {
        const normalizedUserId = normalizeId(friend?.id);
        if (!normalizedUserId) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('view.friends.generated_modal.unfriend_user'),
            description: friend?.displayName || normalizedUserId,
            confirmText: appI18n.t('view.friends.generated_modal.unfriend'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        await deleteFriendById(normalizedUserId);
    }

    async function bulkUnfriendSelected() {
        const selectedRows = filteredRows.filter((friend) =>
            selectedFriendIds.has(normalizeId(friend?.id))
        );
        if (!selectedRows.length) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('view.friends.generated_dynamic.unfriend_value_friends', { value: selectedRows.length }),
            description: selectedRows
                .map((friend) => friend.displayName || friend.id)
                .slice(0, 30)
                .join('\n'),
            confirmText: appI18n.t('view.friends.generated_modal.unfriend'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setIsBulkDeleting(true);

        try {
            let deletedCount = 0;
            for (const friend of selectedRows) {
                const deleteResult = await deleteFriendById(friend.id);
                if (deleteResult.stale) {
                    break;
                }
                if (deleteResult.deleted) {
                    deletedCount += 1;
                }
            }
            if (deletedCount > 0) {
                toast.success(appI18n.t('view.friends.generated_dynamic.unfriended_value_friends', { value: deletedCount }));
            }
        } finally {
            setIsBulkDeleting(false);
        }
    }

    async function loadFriendUserDetails() {
        if (isLoadingUserDetails) {
            return;
        }

        const rowsToFetch = rosterRows.filter(
            (friend) => normalizeId(friend?.id) && !friend?.date_joined
        );
        if (!rowsToFetch.length) {
            toast.success(t('view.friend_list.generated.friend_details_are_already_loaded'));
            return;
        }

        cancelUserLoadRef.current = false;
        setIsLoadingUserDetails(true);
        setUserLoadProgress({
            current: 0,
            total: rowsToFetch.length,
            open: true,
            cancelled: false
        });

        let loadedCount = 0;
        try {
            for (const friend of rowsToFetch) {
                if (cancelUserLoadRef.current) {
                    break;
                }

                const friendId = normalizeId(friend?.id);
                try {
                    const response = await vrchatFriendRepository.getUser({
                        userId: friendId,
                        endpoint: currentEndpoint
                    });
                    if (response?.json?.id) {
                        applyFriendPatch({
                            userId: friendId,
                            patch: response.json,
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                        loadedCount += 1;
                    }
                } catch (error) {
                    console.warn(
                        '[FriendListPage] Failed to load friend profile',
                        friendId,
                        error
                    );
                } finally {
                    setUserLoadProgress((current) => ({
                        ...current,
                        current: Math.min(current.total, current.current + 1)
                    }));
                }
            }

            if (cancelUserLoadRef.current) {
                toast.warning(t('view.friend_list.generated.friend_detail_loading_cancelled'));
                return;
            }
            toast.success(appI18n.t('view.friends.generated_dynamic.loaded_value_friend_profiles', { value: loadedCount }));
        } finally {
            setIsLoadingUserDetails(false);
            if (!cancelUserLoadRef.current) {
                setUserLoadProgress((current) => ({
                    ...current,
                    open: false
                }));
            }
        }
    }

    function cancelFriendUserDetailsLoad() {
        cancelUserLoadRef.current = true;
        setUserLoadProgress((current) => ({
            ...current,
            open: false,
            cancelled: true
        }));
    }

    async function fetchMutualFriendIds(friendId, rateLimiter) {
        const collected = [];
        let offset = 0;

        while (true) {
            await rateLimiter.wait();
            const response = await executeWithBackoff(
                () =>
                    mutualGraphRepository.getMutualFriends({
                        friendId,
                        offset,
                        n: 100
                    }),
                {
                    maxRetries: 4,
                    baseDelay: 500,
                    shouldRetry: (error) =>
                        error?.status === 429 ||
                        String(error?.message || '').includes('429')
                }
            );
            const rows = Array.isArray(response?.json) ? response.json : [];
            collected.push(
                ...rows
                    .map((entry) =>
                        normalizeId(
                            typeof entry === 'string' ? entry : entry?.id
                        )
                    )
                    .filter(Boolean)
            );
            if (rows.length < 100) {
                break;
            }
            offset += rows.length;
        }

        return collected;
    }

    async function loadMutualFriends() {
        if (!currentUserId || isMutualFetching) {
            return;
        }

        if (currentUserSnapshot?.hasSharedConnectionsOptOut) {
            toast.warning(
                t('view.friend_list.generated.shared_connections_are_opted_out_for_the_current_account')
            );
            return;
        }

        const friendSnapshot = rosterRows.filter((friend) =>
            normalizeId(friend?.id)
        );
        if (!friendSnapshot.length) {
            toast.info(t('view.friend_list.generated.no_friends_are_available_for_mutual_friends_loading'));
            return;
        }

        const rateLimiter = createRateLimiter({
            limitPerInterval: 5,
            intervalMs: 1000
        });
        const entries = new Map();
        const metaEntries = new Map();
        setIsMutualFetching(true);
        setMutualProgress({ current: 0, total: friendSnapshot.length });

        try {
            for (let index = 0; index < friendSnapshot.length; index += 1) {
                const friend = friendSnapshot[index];
                const friendId = normalizeId(friend?.id);
                try {
                    const mutualIds = await fetchMutualFriendIds(
                        friendId,
                        rateLimiter
                    );
                    entries.set(friendId, mutualIds);
                    metaEntries.set(friendId, { optedOut: false });
                    applyFriendPatch({
                        userId: friendId,
                        patch: {
                            $mutualCount: mutualIds.length,
                            $mutualOptedOut: false
                        },
                        stateBucket:
                            friend.stateBucket || friend.state || 'offline'
                    });
                } catch (error) {
                    if (error?.status === 403 || error?.status === 404) {
                        metaEntries.set(friendId, { optedOut: true });
                        applyFriendPatch({
                            userId: friendId,
                            patch: {
                                $mutualCount: 0,
                                $mutualOptedOut: true
                            },
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                    } else {
                        console.warn(
                            '[FriendListPage] Skipping mutual friend fetch',
                            friendId,
                            error
                        );
                    }
                } finally {
                    setMutualProgress({
                        current: index + 1,
                        total: friendSnapshot.length
                    });
                }
            }

            await mutualGraphRepository.bulkUpsertMeta(
                currentUserId,
                metaEntries
            );
            await mutualGraphRepository.saveSnapshot(currentUserId, entries);
            toast.success(t('view.friend_list.generated.mutual_friends_loaded'));
        } finally {
            setIsMutualFetching(false);
        }
    }

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
        currentUserId,
        deletingFriendIds,
        randomUserColours,
        selectedFriendIds,
        t
    ]);

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

    function resetFriendListTableLayout() {
        setColumnVisibility({});
        setColumnOrder([]);
        setColumnSizing({});
    }

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
    const toolbarDetail =
        isMutualFetching
            ? t('view.friend_list.generated.loading_mutual_friends_progress', {
                  current: mutualProgress.current,
                  total: mutualProgress.total
              })
            : friendDetail;

    function openFriendDetails(friend) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined
        });
    }

    return (
        <PageScaffold embedded={embedded}>
            <FriendListToolbar
                t={t}
                favoritesOnly={favoritesOnly}
                isFavoritesLoaded={isFavoritesLoaded}
                activeSearchFilterIds={activeSearchFilterIds}
                searchQuery={searchQuery}
                bulkUnfriendMode={bulkUnfriendMode}
                selectedFriendCount={selectedFriendIds.size}
                isBulkDeleting={isBulkDeleting}
                isMutualOptOut={isMutualOptOut}
                isMutualFetching={isMutualFetching}
                currentUserId={currentUserId}
                isLoadingUserDetails={isLoadingUserDetails}
                table={table}
                statusDetail={toolbarDetail}
                onToggleFavoritesOnly={() =>
                    setFavoritesOnly((current) => !current)
                }
                onSearchFilterChange={setActiveSearchFilterIds}
                onSearchChange={setSearchQuery}
                onBulkUnfriend={() => void bulkUnfriendSelected()}
                onBulkUnfriendModeChange={setBulkUnfriendMode}
                onLoadMutualFriends={() => void loadMutualFriends()}
                onLoadFriendUserDetails={() => void loadFriendUserDetails()}
                onResetTableLayout={resetFriendListTableLayout}
            />

            <FriendListTable
                t={t}
                table={table}
                pageCount={pageCount}
                pageSizes={pageSizes}
                pagination={pagination}
                filteredRowsLength={filteredRows.length}
                friendDetail={friendDetail}
                favoritesOnly={favoritesOnly}
                isLoading={isLoading}
                isError={isError}
                hasRows={hasRows}
                onResetTableLayout={resetFriendListTableLayout}
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
                onOpenUser={openFriendDetails}
            />

            <FriendListUserLoadDialog
                t={t}
                open={userLoadProgress.open}
                progress={userLoadProgress}
                percent={userLoadPercent}
                onCancel={cancelFriendUserDetailsLoad}
            />
        </PageScaffold>
    );
}
