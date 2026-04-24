import {
    getCoreRowModel,
    getExpandedRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import {
    configRepository,
    FEED_FILTER_TYPES,
    feedRepository,
    friendLogRepository,
    gameLogRepository,
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    openWorldDialog
} from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import {
    parseLocation
} from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

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

import { buildFeedColumns } from './components/FeedColumns.jsx';
import { FeedPageView } from './components/FeedPageView.jsx';

export function FeedPage({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const gameState = useRuntimeStore((state) => state.gameState);
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

    const persistedState = useMemo(() => readPersistedState(), []);
    const persistedPageSize = Number.parseInt(persistedState.pageSize, 10);
    const initialPageSizes = useMemo(
        () => sanitizePageSizes([...DEFAULT_PAGE_SIZES, persistedPageSize]),
        [persistedPageSize]
    );
    const requestIdRef = useRef(0);
    const hasWrittenPageSizeRef = useRef(false);
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
        pageSize: resolvePageSize(persistedState.pageSize, initialPageSizes)
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
        return from || to ? { from, to } : undefined;
    }, [dateDraftFrom, dateDraftTo]);
    const todayDate = useMemo(() => new Date(), []);
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

    function setFeedFilters(nextFilters) {
        const nextUniqueFilters = [
            ...new Set(
                (Array.isArray(nextFilters) ? nextFilters : []).filter(
                    (filter) => FEED_FILTER_TYPES.includes(filter)
                )
            )
        ];
        setActiveFilters(
            nextUniqueFilters.length === FEED_FILTER_TYPES.length
                ? []
                : nextUniqueFilters
        );
    }

    function toggleFeedFilter(filter) {
        setActiveFilters((current) => {
            const nextFilters = current.includes(filter)
                ? current.filter((entry) => entry !== filter)
                : [...current, filter];
            return nextFilters.length === FEED_FILTER_TYPES.length
                ? []
                : nextFilters;
        });
    }

    function commitSearch(nextValue = searchDraft) {
        setSearchQuery(nextValue);
    }

    function clearSearch() {
        setSearchDraft('');
        setSearchQuery('');
    }

    function applyDateFilter() {
        if (dateDraftFrom && dateDraftTo && dateDraftFrom > dateDraftTo) {
            setDateFrom(dateDraftTo);
            setDateTo(dateDraftFrom);
        } else {
            setDateFrom(dateDraftFrom);
            setDateTo(dateDraftTo);
        }
        setDateFilterOpen(false);
    }

    function clearDateFilter() {
        setDateDraftFrom('');
        setDateDraftTo('');
        setDateFrom('');
        setDateTo('');
        setDateFilterOpen(false);
    }

    async function openPreviousInstancesForLocation({
        location = '',
        worldId = '',
        worldName = '',
        groupName = ''
    } = {}) {
        const normalizedLocation = normalizeId(location);
        const normalizedWorldId =
            normalizeId(worldId) || parseLocation(normalizedLocation).worldId;
        if (!normalizedWorldId || loadingPreviousInstancesKey) {
            return;
        }

        setLoadingPreviousInstancesKey(normalizedLocation || normalizedWorldId);
        try {
            const instances =
                await gameLogRepository.getPreviousInstancesByWorldId({
                    worldId: normalizedWorldId
                });
            const sortedInstances = [...instances].sort((left, right) => {
                if (normalizedLocation) {
                    if (normalizeId(left?.location) === normalizedLocation) {
                        return -1;
                    }
                    if (normalizeId(right?.location) === normalizedLocation) {
                        return 1;
                    }
                }
                return (
                    Date.parse(right?.created_at || right?.createdAt || 0) -
                    Date.parse(left?.created_at || left?.createdAt || 0)
                );
            });
            setPreviousInstancesRows(sortedInstances);
            setPreviousInstancesTitle(
                `Instance History - ${
                    [worldName || 'World', groupName]
                        .filter(Boolean)
                        .join(' / ') || 'World'
                }`
            );
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_load_instance_history')
            );
        } finally {
            setLoadingPreviousInstancesKey('');
        }
    }

    function canUseFeedFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return false;
        }

        return checkCanInviteSelf(location, {
            currentUserId,
            cachedInstances: new Map(),
            friends: friendsMap
        });
    }

    async function launchFeedFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }

        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            if (opened) {
                toast.success(t('view.feed.generated.vrchat_launch_request_sent'));
                return;
            }
            toast.error(t('view.feed.generated.unable_to_open_this_instance_in_vrchat'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_launch_instance')
            );
        }
    }

    async function selfInviteFeedFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }

        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(t('view.feed.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_send_self_invite')
            );
        }
    }

    async function sendFeedFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t('view.feed.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(t('view.feed.generated.cannot_invite_from_the_current_instance_type'));
            return;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t('view.feed.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return;
        }

        const result = await confirm({
            title: t('view.feed.generated_modal.send_invite'),
            description: friend?.displayName || 'this user',
            confirmText: t('view.feed.generated_modal.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint: currentEndpoint }
            );
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await notificationRepository.sendInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    instanceId: inviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName:
                        worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            toast.success(t('view.feed.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_send_invite')
            );
        }
    }

    async function requestFeedFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!canRequestInviteFromFeedFriend(friend, currentUserSnapshot)) {
            toast.error(t('view.feed.generated.cannot_request_invite_friend_is_not_online'));
            return;
        }

        const result = await confirm({
            title: t('view.feed.generated_modal.request_invite'),
            description: friend?.displayName || 'this user',
            confirmText: t('view.feed.generated_modal.request_invite_2'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            await notificationRepository.sendRequestInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    platform: 'standalonewindows'
                }
            });
            toast.success(t('view.feed.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_request_invite')
            );
        }
    }

    async function sendFeedFriendBoop(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }

        try {
            const result = await prompt({
                title: t('view.feed.generated_modal.send_boop'),
                description:
                    t('view.feed.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: t('view.feed.generated_modal.send'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('view.feed.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : t('view.feed.generated_toast.failed_to_send_boop')
            );
        }
    }

    function openFeedNewInstance({
        location = '',
        worldId = '',
        worldName = '',
        selfInvite = false
    } = {}) {
        const target =
            normalizeId(worldId) ||
            parseLocation(location).worldId ||
            normalizeId(location);
        if (!target) {
            return;
        }

        openWorldDialog({
            worldId: target,
            title: worldName || target,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }

    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId]);

    useEffect(() => {
        let active = true;
        const normalizedCurrentUserId = normalizeId(currentUserId);
        if (!normalizedCurrentUserId) {
            setFriendLogNamesById({});
            return () => {
                active = false;
            };
        }

        friendLogRepository
            .getFriendLogCurrent(normalizedCurrentUserId)
            .then((entries) => {
                if (!active) {
                    return;
                }
                const nextNamesById = {};
                for (const entry of Array.isArray(entries) ? entries : []) {
                    const userId = normalizeId(entry?.userId);
                    const displayName = resolveDisplayNameCandidate(
                        entry?.displayName,
                        userId
                    );
                    if (userId && displayName) {
                        nextNamesById[userId] = displayName;
                    }
                }
                setFriendLogNamesById(nextNamesById);
            })
            .catch(() => {
                if (active) {
                    setFriendLogNamesById({});
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId, friendRosterLastLoadedAt]);

    useEffect(() => {
        const missingUserIds = [];
        const seenUserIds = new Set();

        for (const row of rows) {
            const userId = resolveFeedUserId(row);
            if (
                !userId ||
                friendLogNamesById[userId] ||
                seenUserIds.has(userId)
            ) {
                continue;
            }

            if (resolveDisplayNameCandidate(row?.displayName, userId)) {
                continue;
            }

            seenUserIds.add(userId);
            missingUserIds.push(userId);
            if (missingUserIds.length >= 100) {
                break;
            }
        }

        if (missingUserIds.length === 0) {
            return undefined;
        }

        let active = true;
        gameLogRepository
            .getAllUserStats({ userIds: missingUserIds })
            .then((statsRows) => {
                if (!active) {
                    return;
                }

                setFriendLogNamesById((current) => {
                    let changed = false;
                    const nextNamesById = { ...current };
                    for (const row of Array.isArray(statsRows)
                        ? statsRows
                        : []) {
                        const userId = normalizeId(row?.userId);
                        const displayName = resolveDisplayNameCandidate(
                            row?.displayName,
                            userId
                        );
                        if (userId && displayName && !nextNamesById[userId]) {
                            nextNamesById[userId] = displayName;
                            changed = true;
                        }
                    }
                    return changed ? nextNamesById : current;
                });
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [friendLogNamesById, rows]);

    useEffect(() => {
        if (dateFilterOpen) {
            setDateDraftFrom(dateFrom);
            setDateDraftTo(dateTo);
        }
    }, [dateFilterOpen, dateFrom, dateTo]);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString('feedTableFilters', '[]'),
            configRepository.getBool('VRCX_feedTableVIPFilter', false),
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1])
        ])
            .then(([savedFilters, savedVip, savedPageSizes, savedPageSize]) => {
                if (!active) {
                    return;
                }

                const parsedFilters = safeJsonParse(savedFilters);
                const nextPageSizes = sanitizePageSizes(savedPageSizes);
                const resolvedSavedPageSize = resolvePageSize(
                    savedPageSize,
                    nextPageSizes
                );
                const resolvedActivePageSize = Number.isFinite(
                    persistedPageSize
                )
                    ? resolvePageSize(
                          persistedPageSize,
                          nextPageSizes,
                          resolvedSavedPageSize
                      )
                    : resolvedSavedPageSize;
                setFeedFilters(
                    Array.isArray(parsedFilters)
                        ? parsedFilters.filter((filter) =>
                              FEED_FILTER_TYPES.includes(filter)
                          )
                        : []
                );
                setFavoritesOnly(Boolean(savedVip));
                setPageSizes(nextPageSizes);
                setPagination((current) => ({
                    ...current,
                    pageSize: resolvedActivePageSize
                }));
                setPreferencesReady(true);
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setPreferencesReady(true);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const nextPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(nextPageSizes);
        setPagination((current) => ({
            ...current,
            pageIndex: 0,
            pageSize: resolvePageSize(current.pageSize, nextPageSizes)
        }));
    }, [preferencesHydrated, tablePageSizesPreference]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        void configRepository.setString(
            'VRCX_feedTableFilters',
            JSON.stringify(activeFilters)
        );
    }, [activeFilters, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        void configRepository.setBool('VRCX_feedTableVIPFilter', favoritesOnly);
    }, [favoritesOnly, preferencesReady]);

    useEffect(() => {
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
        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility)
        });
    }, [columnVisibility]);

    useEffect(() => {
        writePersistedState({
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [activeFilters, dateFrom, dateTo, deferredSearchQuery, favoritesOnly]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setLoadStatus('idle');
            return;
        }

        if (favoritesOnly && !isFavoritesLoaded) {
            requestIdRef.current += 1;
            setLoadStatus('idle');
            setRows([]);
            return;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];
        const liveFeedSequenceAtRequestStart =
            useFeedLiveStore.getState().version;
        const liveFeedContext = {
            currentUserId,
            activeFilters,
            dateFrom,
            dateTo,
            favoriteIdSet,
            favoritesOnly,
            search: deferredSearchQuery
        };

        setLoadStatus('running');

        feedRepository
            .queryFeed({
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo)
            })
            .then((nextRows) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                const liveFeedSnapshot = useFeedLiveStore.getState();
                const { matchingEntries, maxSequence } =
                    collectMatchingLiveFeedEntries(
                        liveFeedSnapshot.entries,
                        liveFeedSequenceAtRequestStart,
                        liveFeedContext
                    );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }

                setRows(
                    mergeLiveFeedEntries(nextRows, matchingEntries, maxFeedRows)
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                console.error(error);
            });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        isFavoritesLoaded,
        maxFeedRows,
        preferencesReady
    ]);

    useEffect(() => {
        if (!preferencesReady || !currentUserId) {
            return undefined;
        }

        return useFeedLiveStore.subscribe((state, previousState) => {
            if (
                state.version === previousState?.version ||
                state.entries.length === 0
            ) {
                return;
            }

            const { matchingEntries, maxSequence } =
                collectMatchingLiveFeedEntries(
                    state.entries,
                    lastLiveFeedSequenceRef.current,
                    {
                        currentUserId,
                        activeFilters,
                        dateFrom,
                        dateTo,
                        favoriteIdSet,
                        favoritesOnly,
                        search: deferredSearchQuery
                    }
                );
            if (maxSequence > lastLiveFeedSequenceRef.current) {
                lastLiveFeedSequenceRef.current = maxSequence;
            }
            if (!matchingEntries.length) {
                return;
            }
            setRows((current) =>
                mergeLiveFeedEntries(current, matchingEntries, maxFeedRows)
            );
        });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        maxFeedRows,
        preferencesReady
    ]);

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(rows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [pagination.pageIndex, pagination.pageSize, rows.length]);

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
            loadingPreviousInstancesKey,
            prompt,
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

    return (
        <FeedPageView
            activeFilterCount={activeFilterCount}
            activeFilters={activeFilters}
            columns={columns}
            currentEndpoint={currentEndpoint}
            dateDraftFrom={dateDraftFrom}
            dateDraftRange={dateDraftRange}
            dateDraftTo={dateDraftTo}
            dateFilterOpen={dateFilterOpen}
            embedded={embedded}
            feedFilterTypes={FEED_FILTER_TYPES}
            favoritesOnly={favoritesOnly}
            isFavoritesLoaded={isFavoritesLoaded}
            loadStatus={loadStatus}
            loadingPreviousInstancesKey={loadingPreviousInstancesKey}
            onApplyDateFilter={applyDateFilter}
            onClearDateFilter={clearDateFilter}
            onClearFeedFilters={() => setFeedFilters([])}
            onClearSearch={clearSearch}
            onDateFilterOpenChange={setDateFilterOpen}
            onDateRangeSelect={(range) => {
                setDateDraftFrom(toDateInputValue(range?.from));
                setDateDraftTo(toDateInputValue(range?.to));
            }}
            onNewInstance={openFeedNewInstance}
            onOpenPreviousInstances={openPreviousInstancesForLocation}
            onPageSizeChange={setPagination}
            onPreviousInstancesOpenChange={setPreviousInstancesOpen}
            onPreviousInstancesRowsChange={setPreviousInstancesRows}
            onPreviewImage={openImagePreview}
            onSearchBlur={() => commitSearch()}
            onSearchDraftChange={setSearchDraft}
            onSearchEnter={(value) => commitSearch(value)}
            onToggleFavoritesOnly={() => setFavoritesOnly((current) => !current)}
            onToggleFeedFilter={toggleFeedFilter}
            pageSizes={pageSizes}
            pagination={pagination}
            previousInstancesOpen={previousInstancesOpen}
            previousInstancesRows={previousInstancesRows}
            previousInstancesTitle={previousInstancesTitle}
            resolvePageSize={resolvePageSize}
            rows={rows}
            searchDraft={searchDraft}
            t={t}
            table={table}
            todayDate={todayDate}
        />
    );
}
