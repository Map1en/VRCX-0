import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ChevronDownIcon,
    EyeOffIcon,
    StarIcon,
    UserIcon,
    UserMinusIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

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
    EmptyState,
    LoadingState,
    PageBody,
    PageFooter,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import {
    getNameColour,
    openExternalLink,
    userImage
} from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
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
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageFlagLabel,
    languageTooltipLabel,
    resolveFriendStatusMeta as resolveStatusMeta
} from './friendListDisplay.js';
import {
    buildFriendListFavoriteIdSet as buildFavoriteIdSet,
    buildFriendListUserStatsById as buildUserStatsById,
    friendNumberForSort,
    filterFriendListRows,
    normalizeFriendListId as normalizeId
} from './friendListRows.js';
import {
    FRIEND_LIST_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    FRIEND_LIST_SEARCH_FILTERS as SEARCH_FILTERS,
    readPersistedFriendListState as readPersistedState,
    resolveFriendListPageSize as resolvePageSize,
    sanitizeFriendListColumnOrder as sanitizeColumnOrder,
    sanitizeFriendListColumnSizing as sanitizeColumnSizing,
    sanitizeFriendListColumnVisibility as sanitizeColumnVisibility,
    sanitizeFriendListPageSizes as sanitizePageSizes,
    sanitizeFriendListSorting as sanitizeSorting,
    writePersistedFriendListState as writePersistedState
} from './friendListState.js';

function SortButton({ column, label, descFirst = false }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-auto justify-start gap-1 p-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => {
                if (!direction && descFirst) {
                    column.toggleSorting(true);
                    return;
                }
                column.toggleSorting(direction === 'asc');
            }}
        >
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

function FriendListEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

function FriendListSearchFilterDropdown({ value, onChange }) {
    const { t } = useI18n();
    const activeFilters = value instanceof Set ? value : new Set();
    const label = activeFilters.size
        ? `${activeFilters.size}/${SEARCH_FILTERS.length}`
        : t('view.friend_list.filter_placeholder');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-36 justify-between"
                >
                    <span className="truncate">{label}</span>
                    <ChevronDownIcon
                        data-icon="inline-end"
                        className="text-muted-foreground"
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuGroup>
                    {SEARCH_FILTERS.map((filter) => (
                        <DropdownMenuCheckboxItem
                            key={filter.id}
                            checked={activeFilters.has(filter.id)}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                                const next = new Set(activeFilters);
                                if (checked) {
                                    next.add(filter.id);
                                } else {
                                    next.delete(filter.id);
                                }
                                onChange(next);
                            }}
                        >
                            {filter.label}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

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
                    `Unfriended ${friend.displayName || normalizedUserId}.`
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
                    : `Failed to unfriend ${friend.displayName || normalizedUserId}.`
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
            title: 'Unfriend user?',
            description: friend?.displayName || normalizedUserId,
            confirmText: 'Unfriend',
            cancelText: 'Cancel',
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
            title: `Unfriend ${selectedRows.length} friends?`,
            description: selectedRows
                .map((friend) => friend.displayName || friend.id)
                .slice(0, 30)
                .join('\n'),
            confirmText: 'Unfriend',
            cancelText: 'Cancel',
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
                toast.success(`Unfriended ${deletedCount} friends.`);
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
            toast.success('Friend details are already loaded.');
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
                toast.warning('Friend detail loading cancelled.');
                return;
            }
            toast.success(`Loaded ${loadedCount} friend profiles.`);
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
                'Shared connections are opted out for the current account.'
            );
            return;
        }

        const friendSnapshot = rosterRows.filter((friend) =>
            normalizeId(friend?.id)
        );
        if (!friendSnapshot.length) {
            toast.info('No friends are available for mutual-friends loading.');
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
            toast.success('Mutual friends loaded.');
        } finally {
            setIsMutualFetching(false);
        }
    }

    const tableColumns = useMemo(() => {
        const isDarkMode =
            typeof document !== 'undefined' &&
            document.documentElement.classList.contains('dark');

        return [
            {
                id: 'leftSpacer',
                size: 20,
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null
            },
            {
                id: 'bulkSelect',
                size: 55,
                enableSorting: false,
                header: () => null,
                cell: ({ row }) => {
                    const friendId = normalizeId(row.original?.id);
                    return (
                        <div
                            className="flex items-center justify-center"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <Checkbox
                                checked={selectedFriendIds.has(friendId)}
                                disabled={
                                    !bulkUnfriendMode ||
                                    deletingFriendIds.has(friendId)
                                }
                                aria-label={`Select ${row.original?.displayName || friendId}`}
                                onCheckedChange={() =>
                                    toggleSelectedFriend(friendId)
                                }
                            />
                        </div>
                    );
                }
            },
            {
                id: 'friendNumber',
                size: 100,
                meta: { label: t('table.friendList.no') },
                accessorFn: (row) =>
                    Number.parseInt(
                        row?.$friendNumber ?? row?.friendNumber ?? 0,
                        10
                    ) || 0,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.no')}
                        descFirst
                    />
                ),
                cell: ({ row }) => {
                    const friendNumber =
                        Number.parseInt(
                            row.original?.$friendNumber ??
                                row.original?.friendNumber ??
                                row.getValue('friendNumber') ??
                                0,
                            10
                        ) || row.index + 1;
                    return <span>{friendNumber}</span>;
                }
            },
            {
                id: 'avatar',
                size: 90,
                meta: { label: t('table.friendList.avatar') },
                accessorFn: (row) => userImage(row, true),
                enableSorting: false,
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.avatar')}
                    </span>
                ),
                cell: ({ row }) => {
                    const imageUrl = userImage(row.original, true);
                    return imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={
                                row.original?.displayName ||
                                row.original?.id ||
                                'Friend avatar'
                            }
                            loading="lazy"
                            className="size-6 rounded-full object-cover"
                        />
                    ) : (
                        <div className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full">
                            <UserIcon className="size-3" />
                        </div>
                    );
                }
            },
            {
                id: 'displayName',
                size: 200,
                meta: { label: t('table.friendList.displayName') },
                accessorFn: (row) => row?.displayName || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.displayName')}
                    />
                ),
                sortingFn: (rowA, rowB) =>
                    String(rowA.original?.displayName || '').localeCompare(
                        String(rowB.original?.displayName || ''),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }) => {
                    const nameStyle =
                        randomUserColours && row.original?.id
                            ? {
                                  color: getNameColour(
                                      row.original.id,
                                      isDarkMode
                                  )
                              }
                            : undefined;
                    return (
                        <span className="name truncate" style={nameStyle}>
                            {row.original?.displayName || ''}
                        </span>
                    );
                }
            },
            {
                id: 'rank',
                size: 140,
                meta: { label: t('table.friendList.rank') },
                accessorFn: (row) =>
                    Number.parseInt(row?.$trustSortNum ?? 0, 10) || 0,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.rank')}
                    />
                ),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'text-sm',
                            row.original?.$trustClass || ''
                        )}
                    >
                        {row.original?.$trustLevel || ''}
                    </span>
                )
            },
            {
                id: 'status',
                size: 220,
                meta: { label: t('table.friendList.status') },
                accessorFn: (row) => resolveStatusMeta(row).sortRank,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.status')}
                    />
                ),
                sortingFn: (rowA, rowB) => {
                    const left = resolveStatusMeta(rowA.original);
                    const right = resolveStatusMeta(rowB.original);
                    if (left.sortRank !== right.sortRank) {
                        return left.sortRank - right.sortRank;
                    }
                    return (
                        friendNumberForSort(rowA.original) -
                        friendNumberForSort(rowB.original)
                    );
                },
                cell: ({ row }) => {
                    const status = resolveStatusMeta(row.original);
                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            {status.showIndicator ? (
                                <i className={status.indicatorClassName} />
                            ) : null}
                            <span className="truncate">{status.label}</span>
                        </span>
                    );
                }
            },
            {
                id: 'language',
                accessorFn: (row) =>
                    Array.isArray(row?.$languages)
                        ? row.$languages
                              .map((entry) => entry?.value || '')
                              .join('\u0000')
                        : '',
                size: 160,
                meta: { label: t('table.friendList.language') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.language')}
                    />
                ),
                cell: ({ row }) => {
                    const languages = Array.isArray(row.original?.$languages)
                        ? row.original.$languages
                        : [];
                    return languages.length ? (
                        <div className="flex items-center">
                            {languages.map((entry) => {
                                const tooltipLabel =
                                    languageTooltipLabel(entry);
                                return (
                                    <Tooltip
                                        key={`${entry?.key}-${entry?.value}`}
                                    >
                                        <TooltipTrigger asChild>
                                            <span
                                                className="mr-1 inline-flex min-w-5 items-center justify-center text-sm leading-none"
                                                title={tooltipLabel}
                                                aria-label={tooltipLabel}
                                            >
                                                {languageFlagLabel(entry?.key)}
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            {tooltipLabel}
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'bioLink',
                accessorFn: (row) =>
                    Array.isArray(row?.bioLinks)
                        ? row.bioLinks.filter(Boolean).join('\u0000')
                        : '',
                size: 140,
                enableSorting: false,
                meta: { label: t('table.friendList.bioLink') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.bioLink')}
                    </span>
                ),
                cell: ({ row }) => {
                    const links = Array.isArray(row.original?.bioLinks)
                        ? row.original.bioLinks.filter(Boolean)
                        : [];
                    return links.length ? (
                        <div className="flex items-center gap-1">
                            {links.map((link) => (
                                <Button
                                    key={link}
                                    type="button"
                                    title={link}
                                    variant="outline"
                                    size="icon-sm"
                                    className="size-7"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void openExternalLink(link);
                                    }}
                                >
                                    <img
                                        src={getFaviconUrl(link)}
                                        alt=""
                                        className="size-4"
                                        loading="lazy"
                                    />
                                </Button>
                            ))}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'joinCount',
                accessorFn: (row) =>
                    Number.parseInt(row?.$joinCount ?? 0, 10) || 0,
                size: 120,
                meta: { label: t('table.friendList.joinCount') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.joinCount')}
                    />
                ),
                cell: ({ row }) => (
                    <span className="block text-right">
                        {row.original?.$joinCount || ''}
                    </span>
                )
            },
            {
                id: 'timeTogether',
                accessorFn: (row) =>
                    Number.parseInt(row?.$timeSpent ?? 0, 10) || 0,
                size: 150,
                meta: { label: t('table.friendList.timeTogether') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.timeTogether')}
                    />
                ),
                cell: ({ row }) => {
                    const timeSpent =
                        Number.parseInt(row.original?.$timeSpent ?? 0, 10) || 0;
                    return (
                        <span className="block text-right">
                            {timeSpent ? timeToText(timeSpent) : ''}
                        </span>
                    );
                }
            },
            {
                id: 'lastSeen',
                accessorFn: (row) => row?.$lastSeen || '',
                size: 180,
                meta: { label: t('table.friendList.lastSeen') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastSeen')}
                    />
                ),
                cell: ({ row }) => {
                    const text = formatDateFilter(
                        row.original?.$lastSeen,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'mutualFriends',
                accessorFn: (row) =>
                    Number.parseInt(row?.$mutualCount ?? 0, 10) || 0,
                size: 140,
                meta: { label: t('table.friendList.mutualFriends') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.mutualFriends')}
                    />
                ),
                cell: ({ row }) => {
                    const count =
                        Number.parseInt(row.original?.$mutualCount ?? 0, 10) ||
                        0;
                    const optedOut = Boolean(row.original?.$mutualOptedOut);
                    return count || optedOut ? (
                        <span className="flex items-center justify-end gap-1">
                            {count || ''}
                            {optedOut ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="inline-flex">
                                            <EyeOffIcon className="text-muted-foreground size-3.5" />
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        {t('table.friendList.mutualOptedOut')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                        </span>
                    ) : null;
                }
            },
            {
                id: 'lastActivity',
                accessorFn: (row) => row?.last_activity || '',
                size: 200,
                meta: { label: t('table.friendList.lastActivity') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastActivity')}
                    />
                ),
                cell: ({ row }) => {
                    const text = formatDateFilter(
                        row.original?.last_activity,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'lastLogin',
                accessorFn: (row) => row?.last_login || '',
                size: 200,
                meta: { label: t('table.friendList.lastLogin') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastLogin')}
                    />
                ),
                cell: ({ row }) => {
                    const text = formatDateFilter(
                        row.original?.last_login,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'dateJoined',
                accessorFn: (row) => row?.date_joined || '',
                size: 140,
                meta: { label: t('table.friendList.dateJoined') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.dateJoined')}
                    />
                ),
                cell: ({ row }) => (
                    <span>{row.original?.date_joined || ''}</span>
                )
            },
            {
                id: 'unfriend',
                size: 100,
                enableSorting: false,
                meta: { label: t('table.friendList.unfriend') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.unfriend')}
                    </span>
                ),
                cell: ({ row }) => {
                    const friendId = normalizeId(row.original?.id);
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive size-7"
                            disabled={
                                !currentUserId ||
                                deletingFriendIds.has(friendId)
                            }
                            onClick={(event) => {
                                event.stopPropagation();
                                void confirmDeleteFriend(row.original);
                            }}
                        >
                            <UserMinusIcon data-icon="inline-start" />
                        </Button>
                    );
                }
            }
        ];
    }, [
        bulkUnfriendMode,
        currentEndpoint,
        currentUserId,
        deletingFriendIds,
        favoriteFriendIds,
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

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <PageToolbarRow className="justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant={favoritesOnly ? 'default' : 'outline'}
                            size="icon"
                            className="size-9"
                            disabled={!isFavoritesLoaded}
                            title={t('view.friend_list.favorites_only_tooltip')}
                            aria-label={t(
                                'view.friend_list.favorites_only_tooltip'
                            )}
                            onClick={() =>
                                setFavoritesOnly((current) => !current)
                            }
                        >
                            <StarIcon
                                data-icon="inline-start"
                                className={cn(
                                    favoritesOnly ? 'fill-current' : ''
                                )}
                            />
                        </Button>
                        <FriendListSearchFilterDropdown
                            value={activeSearchFilterIds}
                            onChange={setActiveSearchFilterIds}
                        />
                        <Input
                            value={searchQuery}
                            onChange={(event) =>
                                setSearchQuery(event.target.value)
                            }
                            placeholder={t(
                                'view.friend_list.search_placeholder'
                            )}
                            className="h-9 w-64"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {bulkUnfriendMode ? (
                            <Button
                                type="button"
                                variant="outline"
                                className="h-9"
                                disabled={
                                    !selectedFriendIds.size || isBulkDeleting
                                }
                                onClick={() => void bulkUnfriendSelected()}
                            >
                                {t('view.friend_list.bulk_unfriend_selection')}
                            </Button>
                        ) : null}
                        <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs">
                                {t('view.friend_list.bulk_unfriend')}
                            </span>
                            <Switch
                                aria-label={t('view.friend_list.bulk_unfriend')}
                                checked={bulkUnfriendMode}
                                disabled={!currentUserId || isBulkDeleting}
                                onCheckedChange={setBulkUnfriendMode}
                            />
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9 gap-2"
                            disabled={
                                isMutualOptOut ||
                                isMutualFetching ||
                                !currentUserId
                            }
                            onClick={() => void loadMutualFriends()}
                        >
                            {isMutualFetching ? (
                                <Spinner data-icon="inline-start" />
                            ) : null}
                            {t('view.friend_list.load_mutual_friends')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9"
                            disabled={isLoadingUserDetails || !currentUserId}
                            onClick={() => void loadFriendUserDetails()}
                        >
                            {t('view.friend_list.load')}
                        </Button>
                        <TableColumnVisibilityMenu
                            table={table}
                            onResetLayout={resetFriendListTableLayout}
                        />
                    </div>
                </PageToolbarRow>

                {friendDetail || isMutualFetching ? (
                    <div className="text-muted-foreground text-xs">
                        {isMutualFetching
                            ? `Loading mutual friends ${mutualProgress.current} / ${mutualProgress.total}`
                            : friendDetail}
                    </div>
                ) : null}
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState label="Loading the friend roster snapshot" />
                ) : isError ? (
                    <FriendListEmptyState
                        title="Friend roster failed to load"
                        description={
                            friendDetail ||
                            'The roster bootstrap did not complete.'
                        }
                    />
                ) : hasRows ? (
                    <>
                        <DataTableSurface>
                            <DataTableScrollArea wideTable>
                                <Table className="w-max min-w-full">
                                    <DataTableHeader
                                        table={table}
                                        onResetLayout={
                                            resetFriendListTableLayout
                                        }
                                    />
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow
                                                key={row.id}
                                                className="cursor-pointer"
                                                tabIndex={0}
                                                aria-label={`Open ${row.original?.displayName || row.original?.username || 'friend'}`}
                                                onKeyDown={(event) => {
                                                    if (
                                                        event.key !== 'Enter' &&
                                                        event.key !== ' '
                                                    ) {
                                                        return;
                                                    }
                                                    event.preventDefault();
                                                    openUserDialog({
                                                        userId: row.original
                                                            ?.id,
                                                        title:
                                                            row.original
                                                                ?.displayName ||
                                                            row.original
                                                                ?.username ||
                                                            undefined
                                                    });
                                                }}
                                                onClick={() =>
                                                    openUserDialog({
                                                        userId: row.original
                                                            ?.id,
                                                        title:
                                                            row.original
                                                                ?.displayName ||
                                                            row.original
                                                                ?.username ||
                                                            undefined
                                                    })
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
                                Showing{' '}
                                <span className="text-foreground font-medium">
                                    {table.getRowModel().rows.length}
                                </span>{' '}
                                of{' '}
                                <span className="text-foreground font-medium">
                                    {filteredRows.length}
                                </span>{' '}
                                friend{filteredRows.length === 1 ? '' : 's'}
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
                    <FriendListEmptyState
                        title="No friends match the current filters"
                        description={
                            favoritesOnly
                                ? 'Try turning off favorites-only or broadening the search query.'
                                : 'The current search filters excluded every friend in the roster.'
                        }
                    />
                )}
            </PageBody>

            <Dialog
                open={userLoadProgress.open}
                onOpenChange={(open) => !open && cancelFriendUserDetailsLoad()}
            >
                <DialogContent showCloseButton={false} className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Loading friend details</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-2">
                        <div className="bg-muted h-4 overflow-hidden rounded-full border">
                            <div
                                className="bg-primary h-full"
                                style={{ width: `${userLoadPercent}%` }}
                            />
                        </div>
                        <div className="text-muted-foreground text-right text-xs">
                            {userLoadProgress.current} /{' '}
                            {userLoadProgress.total}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={userLoadProgress.cancelled}
                            onClick={cancelFriendUserDetailsLoad}
                        >
                            {userLoadProgress.cancelled
                                ? 'Cancelling...'
                                : 'Cancel'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageScaffold>
    );
}
