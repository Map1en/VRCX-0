import {
    ChevronDownIcon,
    GlobeIcon,
    LayersIcon,
    SearchIcon,
    Settings2Icon,
    UsersIcon
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { FriendLocationCard } from '@/components/friends/FriendLocationCard.jsx';
import { EmptyState, LoadingState } from '@/components/layout/PageScaffold.jsx';
import { Location } from '@/components/Location.jsx';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { cn } from '@/lib/utils.js';
import {
    configRepository,
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import { getFriendsSortFunction } from '@/shared/utils/friend.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Slider } from '@/ui/shadcn/slider';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    FRIENDS_LOCATIONS_SEGMENTS as SEGMENTS,
    parseConfigArray
} from './friendsLocationsConfig.js';
import {
    buildFriendsLocationsFavoriteIdSet as buildFavoriteIdSet,
    buildSameInstanceGroups,
    isSentinelLocationValue,
    isOnlineFriend,
    matchesFriendLocationSearch as matchesSearch,
    normalizeFriendsLocationId as normalizeId,
    resolveFriendsLocationsCurrentInviteLocation as resolveCurrentInviteLocation,
    resolveFriendTravelingWorldName,
    resolveFriendWorldName,
    resolveFriendGroupName,
    resolveLocationTarget,
    resolveWorldIdCandidate,
    uniqueFriendsById
} from './friendsLocationsRows.js';

function formatOptionValue(value) {
    return Number(value)
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
}

function resolveLocationSummary(friend) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    const travelingToLocation = [
        source?.travelingToLocation,
        source?.$travelingToLocation
    ]
        .map(normalizeId)
        .find((value) => value && !isSentinelLocationValue(value));
    if (travelingToLocation && !isSentinelLocationValue(travelingToLocation)) {
        const parsedTraveling = parseLocation(travelingToLocation);
        return {
            label: resolveFriendTravelingWorldName(friend),
            meta: parsedTraveling.instanceName || travelingToLocation
        };
    }

    const location = resolveFriendPresenceLocation(friend, {
        preferTraveling: false
    });
    const parsedLocation = parseLocation(location);

    if (!location || parsedLocation.isOffline) {
        return {
            label: 'Offline',
            meta: ''
        };
    }

    if (parsedLocation.isPrivate) {
        return {
            label: 'Private',
            meta: ''
        };
    }

    if (parsedLocation.isTraveling) {
        return {
            label: 'Traveling',
            meta: resolveFriendTravelingWorldName(friend) || location
        };
    }

    return {
        label: resolveFriendWorldName(friend),
        meta: [
            resolveFriendGroupName(friend),
            parsedLocation.accessTypeName,
            parsedLocation.instanceName
        ]
            .filter(Boolean)
            .join(' · ')
    };
}

function resolveWorldDialogTarget(target) {
    const rawLocation = normalizeId(target?.rawLocation);
    const worldId = normalizeId(target?.worldId);
    const parsed = target?.parsed || parseLocation(rawLocation);
    if (parsed?.isRealInstance && parsed?.tag) {
        return parsed.tag;
    }
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    return resolveWorldIdCandidate(worldId, parsedWorldId, rawLocation);
}

function appendLabel(labelsByFriendId, friendId, label) {
    const normalizedFriendId = normalizeId(friendId);
    const normalizedLabel =
        typeof label === 'string' ? label.trim() : String(label ?? '').trim();
    if (!normalizedFriendId || !normalizedLabel) {
        return;
    }

    const labels = labelsByFriendId.get(normalizedFriendId) ?? [];
    if (!labels.includes(normalizedLabel)) {
        labels.push(normalizedLabel);
    }
    labelsByFriendId.set(normalizedFriendId, labels);
}

function buildFavoriteGroupLabelsByFriendId({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavorites
}) {
    const labelsByFriendId = new Map();

    for (const group of favoriteFriendGroups ?? []) {
        const groupKey = normalizeId(group?.key);
        if (!groupKey) {
            continue;
        }

        const label = group?.displayName || group?.name || groupKey;
        for (const friendId of groupedFavoriteFriendIdsByGroupKey?.[groupKey] ??
            []) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    for (const [groupName, friendIds] of Object.entries(
        localFriendFavorites ?? {}
    )) {
        if (!Array.isArray(friendIds)) {
            continue;
        }

        const label = `Local: ${groupName || 'Favorites'}`;
        for (const friendId of friendIds) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    return labelsByFriendId;
}

function compareFavoriteGroups(left, right, order = []) {
    const leftIndex = order.indexOf(left.key);
    const rightIndex = order.indexOf(right.key);
    if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex;
    }
    if (leftIndex >= 0) {
        return -1;
    }
    if (rightIndex >= 0) {
        return 1;
    }
    return String(left.label || left.key || '').localeCompare(
        String(right.label || right.key || ''),
        undefined,
        { sensitivity: 'base' }
    );
}

function readFriendRef(friend) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

function toLegacyFriendSortRow(friend) {
    const ref = readFriendRef(friend);
    return {
        ...friend,
        name:
            friend?.name ||
            friend?.displayName ||
            friend?.username ||
            friend?.id ||
            '',
        ref: ref && ref !== friend ? { ...friend, ...ref } : friend
    };
}

function sortFriendsBySidebarPrefs(friends, sortMethods) {
    const methods = (sortMethods ?? []).filter(Boolean);
    if (!methods.length) {
        return friends;
    }

    const sort = getFriendsSortFunction(methods);
    return [...friends].sort((left, right) =>
        sort(toLegacyFriendSortRow(left), toLegacyFriendSortRow(right))
    );
}

function resolveFavoriteGroupLabels(
    friend,
    favoriteGroupLabelsByFriendId,
    favoriteIds
) {
    const friendId = normalizeId(friend?.id);
    if (!friendId) {
        return [];
    }

    const labels = favoriteGroupLabelsByFriendId.get(friendId) ?? [];
    if (labels.length > 0) {
        return labels;
    }

    return favoriteIds.has(friendId) ? ['Favorites'] : [];
}

function resolveInstanceSectionDescriptor(friend) {
    const target = resolveLocationTarget(friend);
    const summary = resolveLocationSummary(friend);
    const descriptor = {
        key: 'instance:unknown',
        title: '',
        description: '',
        worldId: '',
        groupId: '',
        rawLocation: ''
    };

    if (target.isOffline) {
        return {
            ...descriptor,
            key: 'instance:offline',
            title: 'Offline'
        };
    }

    if (target.isPrivate) {
        return {
            ...descriptor,
            key: `instance:private:${target.worldId || target.rawLocation || 'private'}`,
            title: 'Private',
            description: '',
            worldId: target.worldId,
            rawLocation: target.rawLocation
        };
    }

    if (target.isTraveling) {
        return {
            ...descriptor,
            key: `instance:traveling:${target.rawLocation || 'traveling'}`,
            title: 'Traveling',
            description: summary.meta || '',
            worldId: target.worldId,
            groupId: target.groupId,
            rawLocation: target.rawLocation
        };
    }

    if (target.worldId) {
        return {
            ...descriptor,
            key: `instance:${target.rawLocation || target.worldId}`,
            title: summary.label || target.worldId || 'World',
            description: [summary.meta].filter(Boolean).join(' · '),
            worldId: target.worldId,
            groupId: target.groupId,
            rawLocation: target.rawLocation
        };
    }

    return {
        ...descriptor,
        key: `instance:${summary.label || target.rawLocation || 'unknown'}`,
        title: summary.label || '',
        description: summary.meta || '',
        rawLocation: target.rawLocation
    };
}

function buildSameInstanceSections({
    sameInstanceGroups,
    displayInstanceInfo = true
}) {
    return sameInstanceGroups
        .map(({ location, friends }) => {
            const descriptor = resolveInstanceSectionDescriptor({
                ...friends[0],
                location,
                travelingToLocation: ''
            });

            return {
                ...descriptor,
                key: `instance:${location}`,
                rawLocation: location,
                displayInstanceInfo,
                friends
            };
        })
        .filter((section) => section.friends.length > 0);
}

function upsertSection(sectionMap, descriptor, friend) {
    const existing = sectionMap.get(descriptor.key);
    if (existing) {
        existing.friends.push(friend);
        return;
    }

    sectionMap.set(descriptor.key, {
        ...descriptor,
        friends: [friend]
    });
}

function buildFriendSections({
    friends,
    groupingMode,
    favoriteIds,
    favoriteGroupLabelsByFriendId
}) {
    if (groupingMode === 'flat') {
        return [
            {
                key: 'flat',
                title: 'All matching friends',
                description: '',
                friends,
                worldId: '',
                groupId: ''
            }
        ];
    }

    const sectionsByKey = new Map();

    for (const friend of friends) {
        if (groupingMode === 'favoriteGroup') {
            const labels = resolveFavoriteGroupLabels(
                friend,
                favoriteGroupLabelsByFriendId,
                favoriteIds
            );
            const label =
                labels.length > 0 ? labels.join(' / ') : 'No favorite group';
            upsertSection(
                sectionsByKey,
                {
                    key: `favorite:${label}`,
                    title: label,
                    description:
                        labels.length > 0
                            ? 'Favorite group segment'
                            : 'Friend is not in a hydrated favorite group.',
                    worldId: '',
                    groupId: ''
                },
                friend
            );
            continue;
        }

        upsertSection(
            sectionsByKey,
            resolveInstanceSectionDescriptor(friend),
            friend
        );
    }

    return Array.from(sectionsByKey.values()).sort((left, right) => {
        if (left.title === 'Offline' && right.title !== 'Offline') {
            return 1;
        }
        if (right.title === 'Offline' && left.title !== 'Offline') {
            return -1;
        }
        return left.title.localeCompare(right.title, undefined, {
            sensitivity: 'base'
        });
    });
}

function parseScale(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampScale(value, min, max, fallback) {
    const parsed = parseScale(value, fallback);
    return Math.min(max, Math.max(min, parsed));
}

function FriendsLocationsEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function FriendsLocationsPage({ embedded = false } = {}) {
    const { t } = useI18n();
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
    const rosterStatus = useFriendRosterStore((state) => state.loadStatus);
    const rosterDetail = useFriendRosterStore((state) => state.detail);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const offlineIds = useFriendRosterStore((state) => state.offlineIds);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const [activeSegment, setActiveSegment] = useState('online');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSameInstance, setShowSameInstance] = useState(false);
    const [cardScale, setCardScale] = useState(1);
    const [spacingScale, setSpacingScale] = useState(1);
    const [collapsedFavoriteGroups, setCollapsedFavoriteGroups] = useState(
        () => new Set()
    );
    const [sidebarFavoritePrefs, setSidebarFavoritePrefs] = useState({
        isDivideByGroup: false,
        selectedGroups: [],
        groupOrder: []
    });
    const [sidebarSortMethods, setSidebarSortMethods] = useState([
        'Sort by Status',
        'Sort Alphabetically',
        ''
    ]);
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const scrollRef = useRef(null);
    const [scrollMetrics, setScrollMetrics] = useState({
        scrollTop: 0,
        viewportHeight: 0,
        width: 0
    });

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString('FriendLocationCardScale', '1'),
            configRepository.getString('FriendLocationCardSpacing', '1'),
            configRepository.getBool('FriendLocationShowSameInstance', false),
            configRepository.getBool('isSidebarDivideByFriendGroup', false),
            configRepository.getString('sidebarFavoriteGroups', '[]'),
            configRepository.getString('sidebarFavoriteGroupOrder', '[]'),
            configRepository.getString('sidebarSortMethod1', 'Sort by Status'),
            configRepository.getString(
                'sidebarSortMethod2',
                'Sort Alphabetically'
            ),
            configRepository.getString('sidebarSortMethod3', '')
        ])
            .then(
                ([
                    nextScale,
                    nextSpacing,
                    nextShowSameInstance,
                    nextDivideByGroup,
                    nextSelectedGroups,
                    nextGroupOrder,
                    nextSortMethod1,
                    nextSortMethod2,
                    nextSortMethod3
                ]) => {
                    if (!active) {
                        return;
                    }

                    setCardScale(clampScale(nextScale, 0.5, 1, 1));
                    setSpacingScale(clampScale(nextSpacing, 0.25, 1, 1));
                    setShowSameInstance(Boolean(nextShowSameInstance));
                    setSidebarFavoritePrefs({
                        isDivideByGroup: Boolean(nextDivideByGroup),
                        selectedGroups: parseConfigArray(nextSelectedGroups),
                        groupOrder: parseConfigArray(nextGroupOrder)
                    });
                    setSidebarSortMethods([
                        nextSortMethod1 || '',
                        nextSortMethod2 || '',
                        nextSortMethod3 || ''
                    ]);
                }
            )
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const unsubscribe = onPreferenceChanged(
            [
                'isSidebarDivideByFriendGroup',
                'sidebarFavoriteGroups',
                'sidebarFavoriteGroupOrder',
                'sidebarSortMethod1',
                'sidebarSortMethod2',
                'sidebarSortMethod3'
            ],
            async () => {
                try {
                    const [
                        nextDivideByGroup,
                        nextSelectedGroups,
                        nextGroupOrder,
                        nextSortMethod1,
                        nextSortMethod2,
                        nextSortMethod3
                    ] = await Promise.all([
                        configRepository.getBool(
                            'isSidebarDivideByFriendGroup',
                            false
                        ),
                        configRepository.getString(
                            'sidebarFavoriteGroups',
                            '[]'
                        ),
                        configRepository.getString(
                            'sidebarFavoriteGroupOrder',
                            '[]'
                        ),
                        configRepository.getString(
                            'sidebarSortMethod1',
                            'Sort by Status'
                        ),
                        configRepository.getString(
                            'sidebarSortMethod2',
                            'Sort Alphabetically'
                        ),
                        configRepository.getString('sidebarSortMethod3', '')
                    ]);
                    if (active) {
                        setSidebarFavoritePrefs({
                            isDivideByGroup: Boolean(nextDivideByGroup),
                            selectedGroups:
                                parseConfigArray(nextSelectedGroups),
                            groupOrder: parseConfigArray(nextGroupOrder)
                        });
                        setSidebarSortMethods([
                            nextSortMethod1 || '',
                            nextSortMethod2 || '',
                            nextSortMethod3 || ''
                        ]);
                    }
                } catch {
                    // ignore preference refresh failures
                }
            }
        );

        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    function toggleFavoriteGroup(groupKey) {
        setCollapsedFavoriteGroups((current) => {
            const next = new Set(current);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }

    useEffect(() => {
        if (!showSameInstance && activeSegment === 'same-instance') {
            setActiveSegment('online');
        }
    }, [activeSegment, showSameInstance]);

    useEffect(() => {
        function updateScrollMetrics() {
            const node = scrollRef.current;
            if (!node) {
                return;
            }

            const next = {
                scrollTop: node.scrollTop,
                viewportHeight: node.clientHeight,
                width: node.clientWidth
            };

            setScrollMetrics((current) =>
                current.scrollTop === next.scrollTop &&
                current.viewportHeight === next.viewportHeight &&
                current.width === next.width
                    ? current
                    : next
            );
        }

        const node = scrollRef.current;
        if (!node) {
            return undefined;
        }

        updateScrollMetrics();
        node.addEventListener('scroll', updateScrollMetrics, { passive: true });

        const observer =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(updateScrollMetrics)
                : null;
        observer?.observe(node);
        window.addEventListener('resize', updateScrollMetrics);

        return () => {
            node.removeEventListener('scroll', updateScrollMetrics);
            observer?.disconnect();
            window.removeEventListener('resize', updateScrollMetrics);
        };
    }, []);

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) {
            return;
        }

        node.scrollTop = 0;
        setScrollMetrics((current) => ({
            ...current,
            scrollTop: 0
        }));
    }, [activeSegment, deferredSearchQuery, showSameInstance]);

    const favoriteIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const currentLocationPlayerIds = gameState?.currentLocationPlayerIds;
    const currentLocationSnapshot = useMemo(
        () => ({
            location: currentInviteLocation,
            friendList: new Set(
                Array.isArray(currentLocationPlayerIds)
                    ? currentLocationPlayerIds
                    : []
            )
        }),
        [currentInviteLocation, currentLocationPlayerIds]
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
    const canSendInvite = Boolean(
        gameState?.isGameRunning &&
        currentInviteLocation &&
        canInviteFromCurrentLocation
    );
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);

    const favoriteGroupLabelsByFriendId = useMemo(
        () =>
            buildFavoriteGroupLabelsByFriendId({
                favoriteFriendGroups,
                groupedFavoriteFriendIdsByGroupKey,
                localFriendFavorites
            }),
        [
            favoriteFriendGroups,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavorites
        ]
    );

    const allFavoriteGroupKeys = useMemo(
        () => [
            ...favoriteFriendGroups
                .map((group) => normalizeId(group?.key))
                .filter(Boolean),
            ...(localFriendFavoriteGroups.length
                ? localFriendFavoriteGroups
                : Object.keys(localFriendFavorites || {})
            )
                .map((groupName) => `local:${groupName}`)
                .filter(Boolean)
        ],
        [favoriteFriendGroups, localFriendFavoriteGroups, localFriendFavorites]
    );

    const selectedFavoriteGroupKeys = useMemo(() => {
        const configured = sidebarFavoritePrefs.selectedGroups.filter(
            (groupKey) => allFavoriteGroupKeys.includes(groupKey)
        );
        return new Set(configured.length ? configured : allFavoriteGroupKeys);
    }, [allFavoriteGroupKeys, sidebarFavoritePrefs.selectedGroups]);

    const selectedFavoriteIds = useMemo(() => {
        if (!allFavoriteGroupKeys.length) {
            return favoriteIds;
        }

        const ids = new Set();
        for (const groupKey of selectedFavoriteGroupKeys) {
            if (groupKey.startsWith('local:')) {
                for (const id of localFriendFavorites?.[groupKey.slice(6)] ||
                    []) {
                    const normalized = normalizeId(id);
                    if (normalized) {
                        ids.add(normalized);
                    }
                }
                continue;
            }

            for (const id of groupedFavoriteFriendIdsByGroupKey?.[groupKey] ||
                []) {
                const normalized = normalizeId(id);
                if (normalized) {
                    ids.add(normalized);
                }
            }
        }
        return ids;
    }, [
        allFavoriteGroupKeys,
        favoriteIds,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavorites,
        selectedFavoriteGroupKeys
    ]);

    const onlineFriends = useMemo(
        () =>
            sortFriendsBySidebarPrefs(
                onlineIds.map((id) => friendsById[id]).filter(Boolean),
                sidebarSortMethods
            ),
        [friendsById, onlineIds, sidebarSortMethods]
    );
    const activeFriends = useMemo(
        () =>
            sortFriendsBySidebarPrefs(
                activeIds.map((id) => friendsById[id]).filter(Boolean),
                sidebarSortMethods
            ),
        [activeIds, friendsById, sidebarSortMethods]
    );
    const offlineFriends = useMemo(
        () =>
            sortFriendsBySidebarPrefs(
                offlineIds.map((id) => friendsById[id]).filter(Boolean),
                sidebarSortMethods
            ),
        [friendsById, offlineIds, sidebarSortMethods]
    );
    const favoriteFriends = useMemo(
        () =>
            onlineFriends.filter((friend) =>
                selectedFavoriteIds.has(normalizeId(friend?.id))
            ),
        [onlineFriends, selectedFavoriteIds]
    );
    const onlineFavoriteExclusionIds = sidebarFavoritePrefs.selectedGroups
        .length
        ? selectedFavoriteIds
        : favoriteIds;
    const onlineNonFavoriteFriends = useMemo(
        () =>
            onlineFriends.filter(
                (friend) =>
                    !onlineFavoriteExclusionIds.has(normalizeId(friend?.id))
            ),
        [onlineFavoriteExclusionIds, onlineFriends]
    );
    const sameInstanceGroups = useMemo(
        () => buildSameInstanceGroups(onlineFriends, currentLocationSnapshot),
        [currentLocationSnapshot, onlineFriends]
    );
    const sameInstanceFriends = useMemo(
        () => sameInstanceGroups.flatMap((group) => group.friends),
        [sameInstanceGroups]
    );
    const sameInstanceFriendIds = useMemo(
        () =>
            new Set(
                sameInstanceFriends
                    .map((friend) => normalizeId(friend?.id))
                    .filter(Boolean)
            ),
        [sameInstanceFriends]
    );
    const onlineWithoutSameInstanceFriends = useMemo(
        () =>
            onlineNonFavoriteFriends.filter(
                (friend) => !sameInstanceFriendIds.has(normalizeId(friend?.id))
            ),
        [onlineNonFavoriteFriends, sameInstanceFriendIds]
    );
    const segmentOptions = useMemo(
        () =>
            SEGMENTS.filter(
                (segment) =>
                    showSameInstance || segment.value !== 'same-instance'
            ),
        [showSameInstance]
    );

    const segmentMap = useMemo(
        () => ({
            online: onlineFriends,
            onlineNonFavorite: onlineNonFavoriteFriends,
            favorite: favoriteFriends,
            'same-instance': sameInstanceFriends,
            active: activeFriends,
            offline: offlineFriends
        }),
        [
            activeFriends,
            favoriteFriends,
            offlineFriends,
            onlineFriends,
            onlineNonFavoriteFriends,
            sameInstanceFriends
        ]
    );

    const visibleFriends = useMemo(() => {
        if (deferredSearchQuery.trim()) {
            return uniqueFriendsById([
                ...favoriteFriends,
                ...onlineFriends,
                ...activeFriends,
                ...offlineFriends
            ]).filter((friend) =>
                matchesSearch(friend, deferredSearchQuery, favoriteIds)
            );
        }
        const source =
            activeSegment === 'online'
                ? onlineNonFavoriteFriends
                : (segmentMap[activeSegment] ?? []);
        return source.filter((friend) =>
            matchesSearch(friend, deferredSearchQuery, favoriteIds)
        );
    }, [
        activeFriends,
        activeSegment,
        deferredSearchQuery,
        favoriteFriends,
        favoriteIds,
        offlineFriends,
        onlineFriends,
        onlineNonFavoriteFriends,
        segmentMap
    ]);

    const favoriteGroupSections = useMemo(() => {
        if (
            !sidebarFavoritePrefs.isDivideByGroup ||
            activeSegment !== 'favorite' ||
            deferredSearchQuery.trim()
        ) {
            return [];
        }

        const friendById = new Map(
            favoriteFriends.map((friend) => [normalizeId(friend?.id), friend])
        );
        const seen = new Set();
        const sections = [];
        const orderedRemoteGroups = favoriteFriendGroups
            .map((group) => ({
                key: normalizeId(group?.key),
                label:
                    group?.displayName || group?.name || normalizeId(group?.key)
            }))
            .filter(
                (group) => group.key && selectedFavoriteGroupKeys.has(group.key)
            )
            .sort((left, right) =>
                compareFavoriteGroups(
                    left,
                    right,
                    sidebarFavoritePrefs.groupOrder
                )
            );
        const localGroupNames = localFriendFavoriteGroups.length
            ? localFriendFavoriteGroups
            : Object.keys(localFriendFavorites || {});
        const orderedLocalGroups = localGroupNames
            .map((groupName) => ({
                key: `local:${groupName}`,
                label: groupName
            }))
            .filter((group) => selectedFavoriteGroupKeys.has(group.key))
            .sort((left, right) =>
                compareFavoriteGroups(
                    left,
                    right,
                    sidebarFavoritePrefs.groupOrder
                )
            );

        for (const group of orderedRemoteGroups) {
            const friendsInGroup = (
                groupedFavoriteFriendIdsByGroupKey?.[group.key] || []
            )
                .map((id) => friendById.get(normalizeId(id)))
                .filter(Boolean);
            if (!friendsInGroup.length) {
                continue;
            }
            for (const friend of friendsInGroup) {
                seen.add(normalizeId(friend?.id));
            }
            sections.push({
                key: `favorite:${group.key}`,
                type: 'favoriteGroup',
                groupKey: group.key,
                title: group.label,
                description: '',
                friends: sortFriendsBySidebarPrefs(
                    friendsInGroup,
                    sidebarSortMethods
                ),
                worldId: '',
                groupId: '',
                collapsed: collapsedFavoriteGroups.has(group.key)
            });
        }

        for (const group of orderedLocalGroups) {
            const groupName = group.key.slice(6);
            const friendsInGroup = (localFriendFavorites?.[groupName] || [])
                .map((id) => friendById.get(normalizeId(id)))
                .filter(Boolean);
            if (!friendsInGroup.length) {
                continue;
            }
            for (const friend of friendsInGroup) {
                seen.add(normalizeId(friend?.id));
            }
            sections.push({
                key: `favorite:${group.key}`,
                type: 'favoriteGroup',
                groupKey: group.key,
                title: group.label,
                description: '',
                friends: sortFriendsBySidebarPrefs(
                    friendsInGroup,
                    sidebarSortMethods
                ),
                worldId: '',
                groupId: '',
                collapsed: collapsedFavoriteGroups.has(group.key)
            });
        }

        const ungrouped = favoriteFriends.filter(
            (friend) => !seen.has(normalizeId(friend?.id))
        );
        if (ungrouped.length) {
            sections.push({
                key: 'favorite:ungrouped',
                type: 'favoriteGroup',
                groupKey: 'ungrouped',
                title: 'Favorites',
                description: '',
                friends: sortFriendsBySidebarPrefs(
                    ungrouped,
                    sidebarSortMethods
                ),
                worldId: '',
                groupId: '',
                collapsed: collapsedFavoriteGroups.has('ungrouped')
            });
        }

        return sections;
    }, [
        activeSegment,
        collapsedFavoriteGroups,
        deferredSearchQuery,
        favoriteFriendGroups,
        favoriteFriends,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites,
        selectedFavoriteGroupKeys,
        sidebarFavoritePrefs.groupOrder,
        sidebarFavoritePrefs.isDivideByGroup,
        sidebarSortMethods
    ]);

    const visibleSections = useMemo(() => {
        if (favoriteGroupSections.length) {
            return favoriteGroupSections;
        }

        if (!deferredSearchQuery.trim() && activeSegment === 'same-instance') {
            const filteredSameGroups = sameInstanceGroups
                .map((group) => ({
                    ...group,
                    friends: group.friends.filter((friend) =>
                        visibleFriends.some(
                            (visibleFriend) =>
                                normalizeId(visibleFriend?.id) ===
                                normalizeId(friend?.id)
                        )
                    )
                }))
                .filter((group) => group.friends.length > 0);
            return buildSameInstanceSections({
                sameInstanceGroups: filteredSameGroups,
                favoriteIds,
                favoriteGroupLabelsByFriendId
            });
        }

        if (
            !deferredSearchQuery.trim() &&
            activeSegment === 'online' &&
            !showSameInstance &&
            sameInstanceFriends.length
        ) {
            const sameInstanceSections = buildSameInstanceSections({
                sameInstanceGroups,
                displayInstanceInfo: false,
                favoriteIds,
                favoriteGroupLabelsByFriendId
            });
            const otherFriends = onlineWithoutSameInstanceFriends.filter(
                (friend) =>
                    matchesSearch(friend, deferredSearchQuery, favoriteIds)
            );
            return [
                ...sameInstanceSections,
                ...(otherFriends.length
                    ? [
                          {
                              key: 'online:remaining',
                              title: 'Online',
                              description: '',
                              friends: otherFriends,
                              worldId: '',
                              groupId: ''
                          }
                      ]
                    : [])
            ];
        }

        return buildFriendSections({
            friends: visibleFriends,
            groupingMode: 'flat',
            favoriteIds,
            favoriteGroupLabelsByFriendId
        });
    }, [
        activeSegment,
        deferredSearchQuery,
        favoriteGroupLabelsByFriendId,
        favoriteGroupSections,
        favoriteIds,
        onlineWithoutSameInstanceFriends,
        sameInstanceGroups,
        sameInstanceFriends,
        showSameInstance,
        visibleFriends
    ]);

    const hasVisibleSections = useMemo(
        () =>
            visibleSections.some(
                (section) =>
                    Array.isArray(section.friends) && section.friends.length > 0
            ),
        [visibleSections]
    );

    const isLoading =
        rosterStatus === 'running' &&
        onlineFriends.length + activeFriends.length + offlineFriends.length ===
            0;
    const isError = rosterStatus === 'error';
    const cardGridGap = Math.max(6, (14 + (cardScale - 1) * 10) * spacingScale);
    const cardGridMinWidth = Math.max(120, 220 * cardScale);
    const cardGridColumns = Math.max(
        1,
        Math.floor(
            (scrollMetrics.width + cardGridGap) /
                (cardGridMinWidth + cardGridGap)
        ) || 1
    );
    const cardGridRowHeight = Math.max(
        160,
        150 * cardScale + 48 * spacingScale
    );
    const cardRowHeight = cardGridRowHeight + cardGridGap;

    const virtualRows = useMemo(() => {
        const rows = [];

        for (const section of visibleSections) {
            const friends = Array.isArray(section.friends)
                ? section.friends
                : [];
            if (!friends.length) {
                continue;
            }

            if (section.type === 'favoriteGroup') {
                rows.push({
                    type: 'group-header',
                    key: `group-header:${section.key}`,
                    height: 42,
                    section
                });
                if (section.collapsed) {
                    continue;
                }
            }

            const showHeader =
                section.type !== 'favoriteGroup' &&
                section.key !== 'flat' &&
                section.key !== 'online:remaining';
            if (showHeader) {
                rows.push({
                    type: 'header',
                    key: `header:${section.key}`,
                    height: 64,
                    section
                });
            }

            for (
                let index = 0;
                index < friends.length;
                index += cardGridColumns
            ) {
                rows.push({
                    type: 'cards',
                    key: `cards:${section.key}:${index}`,
                    height: cardRowHeight,
                    section,
                    friends: friends.slice(index, index + cardGridColumns)
                });
            }
        }

        return rows;
    }, [cardGridColumns, cardRowHeight, visibleSections]);

    const positionedRows = useMemo(() => {
        let top = 0;
        const rows = virtualRows.map((row) => {
            const positioned = {
                ...row,
                top
            };
            top += row.height;
            return positioned;
        });

        return {
            rows,
            totalHeight: top
        };
    }, [virtualRows]);

    const visibleVirtualRows = useMemo(() => {
        const overscan = Math.max(360, scrollMetrics.viewportHeight);
        const start = Math.max(0, scrollMetrics.scrollTop - overscan);
        const end =
            scrollMetrics.scrollTop + scrollMetrics.viewportHeight + overscan;

        return positionedRows.rows.filter(
            (row) => row.top + row.height >= start && row.top <= end
        );
    }, [positionedRows, scrollMetrics.scrollTop, scrollMetrics.viewportHeight]);

    function canUseFriendLocation(location) {
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

    async function launchFriendLocation(location) {
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
                toast.success('VRChat launch request sent.');
                return;
            }
            toast.error('Unable to open this instance in VRChat.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to launch instance.'
            );
        }
    }

    async function selfInviteFriendLocation(location) {
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
            toast.success('Self invite sent.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to send self invite.'
            );
        }
    }

    async function sendFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                'Cannot invite: no current VRChat location is available.'
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error('Cannot invite from the current instance type.');
            return;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                'Cannot invite: current location is not a concrete instance.'
            );
            return;
        }

        const result = await confirm({
            title: 'Send invite?',
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: 'Invite',
            cancelText: 'Cancel'
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
            toast.success('Invite sent.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to send invite.'
            );
        }
    }

    async function requestFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }

        const result = await confirm({
            title: 'Request invite?',
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: 'Request Invite',
            cancelText: 'Cancel'
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
            toast.success('Invite request sent.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to request invite.'
            );
        }
    }

    async function sendFriendBoop(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }

        try {
            const result = await prompt({
                title: 'Send boop',
                description:
                    'Optional emoji id. Leave blank to send the default boop.',
                inputValue: '',
                confirmText: 'Send',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success('Boop sent.');
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : 'Failed to send boop.'
            );
        }
    }

    function renderSectionHeader(section) {
        return (
            <div className="bg-muted/20 flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl border px-3 py-2 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-col gap-1 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2">
                        <LayersIcon className="text-muted-foreground size-4" />
                        <div className="min-w-0 truncate font-medium">
                            {section.rawLocation &&
                            !section.key.startsWith('instance:offline') ? (
                                <Location
                                    location={section.rawLocation}
                                    hint={section.title}
                                    link={false}
                                    asButton={false}
                                    disableTooltip
                                />
                            ) : (
                                section.title
                            )}
                        </div>
                        <Badge variant="outline">
                            {section.friends.length}
                        </Badge>
                    </div>
                    {section.description ? (
                        <div className="text-muted-foreground line-clamp-1 text-xs break-words">
                            {section.description}
                        </div>
                    ) : null}
                </div>
                {section.worldId || section.groupId ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                        {section.worldId ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    openWorldDialog({
                                        worldId:
                                            resolveWorldDialogTarget(section),
                                        title: section.title
                                    })
                                }
                            >
                                <GlobeIcon data-icon="inline-start" />
                                World
                            </Button>
                        ) : null}
                        {section.groupId ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    openGroupDialog({
                                        groupId: section.groupId,
                                        title: undefined
                                    })
                                }
                            >
                                <UsersIcon data-icon="inline-start" />
                                Group
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    }

    function renderFavoriteGroupHeader(section) {
        return (
            <Button
                type="button"
                variant="ghost"
                className="h-auto w-full cursor-pointer justify-start gap-1.5 px-1 py-1.5 text-left text-sm font-semibold select-none"
                onClick={() => toggleFavoriteGroup(section.groupKey)}
            >
                <ChevronDownIcon
                    data-icon="inline-start"
                    className={cn(
                        'shrink-0 transition-transform duration-200 ease-in-out',
                        section.collapsed && '-rotate-90'
                    )}
                />
                <span className="min-w-0 truncate">{section.title}</span>
                <span className="text-xs font-normal opacity-70">
                    ({section.friends.length})
                </span>
            </Button>
        );
    }

    function renderFriendCard(section, friend) {
        const location = resolveLocationSummary(friend);
        const target = resolveLocationTarget(friend);
        const rawLocation = target.rawLocation;
        const groupHint = resolveFriendGroupName(friend);
        const source =
            friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
        const isTravelingLocation =
            normalizeId(source?.location).toLowerCase() === 'traveling';
        const travelingLocation =
            source?.travelingToLocation || source?.$travelingToLocation || '';
        const friendIsCurrentUser =
            normalizeId(friend?.id || friend?.userId) ===
            normalizeId(currentUserId);
        const friendIsOnline = isOnlineFriend(friend);
        const friendLocationAvailable = canUseFriendLocation(rawLocation);

        return (
            <FriendLocationCard
                key={`${section.key}:${friend.id}`}
                friend={friend}
                locationLabel={location.label}
                groupHint={groupHint}
                rawLocation={rawLocation}
                isTraveling={isTravelingLocation}
                travelingLocation={travelingLocation}
                cardScale={cardScale}
                spacingScale={spacingScale}
                displayInstanceInfo={section.displayInstanceInfo !== false}
                canUseFriendLocation={
                    !friendIsCurrentUser && friendLocationAvailable
                }
                canSendInvite={!friendIsCurrentUser && canSendInvite}
                canRequestInvite={!friendIsCurrentUser && friendIsOnline}
                canBoop={!friendIsCurrentUser && canBoop}
                onOpenUser={() =>
                    openUserDialog({
                        userId: friend?.id,
                        title:
                            friend?.displayName ||
                            friend?.username ||
                            undefined,
                        seedData: friend
                    })
                }
                onOpenWorld={
                    target.worldId
                        ? () =>
                              openWorldDialog({
                                  worldId: resolveWorldDialogTarget(target),
                                  title: location.label || undefined
                              })
                        : undefined
                }
                onOpenGroup={
                    target.groupId
                        ? () =>
                              openGroupDialog({
                                  groupId: target.groupId,
                                  title: undefined
                              })
                        : undefined
                }
                onLaunchLocation={() => void launchFriendLocation(rawLocation)}
                onSelfInviteLocation={() =>
                    void selfInviteFriendLocation(rawLocation)
                }
                onSendInvite={() => void sendFriendInvite(friend)}
                onRequestInvite={() => void requestFriendInvite(friend)}
                onSendBoop={() => void sendFriendBoop(friend)}
            />
        );
    }

    return (
        <div
            className={
                embedded
                    ? 'friend-view flex h-full min-h-0 flex-col p-3'
                    : 'friend-view x-container flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 pb-0'
            }
        >
            <div className="friend-view__toolbar mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
                    <Tabs
                        value={activeSegment}
                        onValueChange={setActiveSegment}
                        className="gap-0"
                    >
                        <TabsList>
                            {segmentOptions.map((segment) => (
                                <TabsTrigger
                                    key={segment.value}
                                    value={segment.value}
                                >
                                    {t(segment.labelKey)}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>

                    <div className="relative w-full max-w-md lg:ml-auto">
                        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                        <Input
                            value={searchQuery}
                            onChange={(event) =>
                                setSearchQuery(event.target.value)
                            }
                            placeholder={t(
                                'view.friends_locations.search_placeholder'
                            )}
                            className="pl-9"
                        />
                    </div>
                </div>

                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Friends location settings"
                        >
                            <Settings2Icon data-icon="inline-start" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="end">
                        <FieldGroup>
                            <Field orientation="horizontal">
                                <FieldContent>
                                    <FieldLabel htmlFor="friends-locations-same-instance">
                                        {t(
                                            'view.friends_locations.separate_same_instance_friends'
                                        )}
                                    </FieldLabel>
                                </FieldContent>
                                <Switch
                                    id="friends-locations-same-instance"
                                    checked={showSameInstance}
                                    onCheckedChange={(value) => {
                                        setShowSameInstance(Boolean(value));
                                        void configRepository.setBool(
                                            'FriendLocationShowSameInstance',
                                            Boolean(value)
                                        );
                                    }}
                                />
                            </Field>
                            <Field>
                                <FieldContent>
                                    <FieldLabel htmlFor="friends-locations-card-scale">
                                        {t('view.friends_locations.scale')}
                                    </FieldLabel>
                                </FieldContent>
                                <Slider
                                    id="friends-locations-card-scale"
                                    min={0.5}
                                    max={1}
                                    step={0.01}
                                    value={[cardScale]}
                                    onValueChange={([value]) => {
                                        const nextValue = clampScale(
                                            value,
                                            0.5,
                                            1,
                                            1
                                        );
                                        setCardScale(nextValue);
                                        void configRepository.setString(
                                            'FriendLocationCardScale',
                                            formatOptionValue(nextValue)
                                        );
                                    }}
                                />
                                <div className="text-muted-foreground text-sm">
                                    {Math.round(cardScale * 100)}%
                                </div>
                            </Field>

                            <Field>
                                <FieldContent>
                                    <FieldLabel htmlFor="friends-locations-card-spacing">
                                        {t('view.friends_locations.spacing')}
                                    </FieldLabel>
                                </FieldContent>
                                <Slider
                                    id="friends-locations-card-spacing"
                                    min={0.25}
                                    max={1}
                                    step={0.05}
                                    value={[spacingScale]}
                                    onValueChange={([value]) => {
                                        const nextValue = clampScale(
                                            value,
                                            0.25,
                                            1,
                                            1
                                        );
                                        setSpacingScale(nextValue);
                                        void configRepository.setString(
                                            'FriendLocationCardSpacing',
                                            formatOptionValue(nextValue)
                                        );
                                    }}
                                />
                                <div className="text-muted-foreground text-sm">
                                    {Math.round(spacingScale * 100)}%
                                </div>
                            </Field>
                        </FieldGroup>
                    </PopoverContent>
                </Popover>
            </div>

            <div
                ref={scrollRef}
                className="friend-view__scroll min-h-0 flex-1 overflow-auto"
            >
                {isLoading ? (
                    <LoadingState
                        label={t('view.friends_locations.loading_more')}
                    />
                ) : isError ? (
                    <FriendsLocationsEmptyState
                        title="Friends locations failed to load"
                        description={
                            rosterDetail ||
                            'The roster bootstrap did not complete.'
                        }
                    />
                ) : hasVisibleSections ? (
                    <div
                        className="relative"
                        style={{
                            height: `${positionedRows.totalHeight}px`
                        }}
                    >
                        {visibleVirtualRows.map((row) => (
                            <div
                                key={row.key}
                                className="absolute right-0 left-0"
                                style={{
                                    height: `${row.height}px`,
                                    transform: `translateY(${row.top}px)`
                                }}
                            >
                                {row.type === 'header' ? (
                                    renderSectionHeader(row.section)
                                ) : row.type === 'group-header' ? (
                                    renderFavoriteGroupHeader(row.section)
                                ) : (
                                    <div
                                        className="grid overflow-hidden"
                                        style={{
                                            gap: `${cardGridGap}px`,
                                            height: `${cardGridRowHeight}px`,
                                            gridTemplateColumns: `repeat(${cardGridColumns}, minmax(${cardGridMinWidth}px, 1fr))`
                                        }}
                                    >
                                        {row.friends.map((friend) =>
                                            renderFriendCard(
                                                row.section,
                                                friend
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <FriendsLocationsEmptyState
                        title="No friends match the current filters"
                        description={
                            activeSegment === 'favorite' && !isFavoritesLoaded
                                ? 'Favorites are still hydrating.'
                                : 'Try a different segment or broaden the search query.'
                        }
                    />
                )}
            </div>
        </div>
    );
}
