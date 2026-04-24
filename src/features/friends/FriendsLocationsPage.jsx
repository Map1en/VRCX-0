import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import {
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
import { parseLocation } from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { FRIENDS_LOCATIONS_SEGMENTS as SEGMENTS } from './friendsLocationsConfig.js';
import {
    buildFriendsLocationsFavoriteIdSet as buildFavoriteIdSet,
    buildSameInstanceGroups,
    matchesFriendLocationSearch as matchesSearch,
    normalizeFriendsLocationId as normalizeId,
    resolveFriendsLocationsCurrentInviteLocation as resolveCurrentInviteLocation,
    resolveWorldDialogTarget,
    uniqueFriendsById
} from './friendsLocationsRows.js';
import { FriendsLocationsToolbar } from './components/FriendsLocationsToolbar.jsx';
import { FriendsLocationsVirtualList } from './components/FriendsLocationsVirtualList.jsx';
import {
    buildFavoriteGroupLabelsByFriendId,
    buildFriendSections,
    buildSameInstanceSections,
    compareFavoriteGroups,
    sortFriendsBySidebarPrefs
} from './friendsLocationsSections.js';
import { useFriendsLocationsPreferences } from './useFriendsLocationsPreferences.js';

export function FriendsLocationsPage({ embedded = false } = {}) {
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
    const [collapsedFavoriteGroups, setCollapsedFavoriteGroups] = useState(
        () => new Set()
    );
    const {
        cardScale,
        changeCardScalePreference,
        changeShowSameInstance,
        changeSpacingScalePreference,
        showSameInstance,
        sidebarFavoritePrefs,
        sidebarSortMethods,
        spacingScale
    } = useFriendsLocationsPreferences();
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const scrollRef = useRef(null);
    const [scrollMetrics, setScrollMetrics] = useState({
        scrollTop: 0,
        viewportHeight: 0,
        width: 0
    });

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
                toast.success(t('view.friend_list.generated.vrchat_launch_request_sent'));
                return;
            }
            toast.error(t('view.friend_list.generated.unable_to_open_this_instance_in_vrchat'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_launch_instance')
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
            toast.success(t('view.friend_list.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_send_self_invite')
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
                t('view.friend_list.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(t('view.friend_list.generated.cannot_invite_from_the_current_instance_type'));
            return;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t('view.friend_list.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return;
        }

        const result = await confirm({
            title: t('view.friends.generated_modal.send_invite'),
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: t('view.friends.generated_modal.invite'),
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
            toast.success(t('view.friend_list.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_send_invite')
            );
        }
    }

    async function requestFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }

        const result = await confirm({
            title: t('view.friends.generated_modal.request_invite'),
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: t('view.friends.generated_modal.request_invite_2'),
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
            toast.success(t('view.friend_list.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_request_invite')
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
                title: t('view.friends.generated_modal.send_boop'),
                description:
                    t('view.friends.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: t('view.friends.generated_modal.send'),
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
            toast.success(t('view.friend_list.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : t('view.friends.generated_toast.failed_to_send_boop')
            );
        }
    }

    function openSectionWorld(section) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(section),
            title: section.title
        });
    }

    function openSectionGroup(section) {
        openGroupDialog({
            groupId: section.groupId,
            title: undefined
        });
    }

    function openFriendUser(friend) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined,
            seedData: friend
        });
    }

    function openFriendWorld(target, location) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(target),
            title: location.label || undefined
        });
    }

    function openFriendGroup(target) {
        openGroupDialog({
            groupId: target.groupId,
            title: undefined
        });
    }

    return (
        <div
            className={
                embedded
                    ? 'friend-view flex h-full min-h-0 flex-col p-3'
                    : 'friend-view x-container flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 pb-0'
            }
        >
            <FriendsLocationsToolbar
                activeSegment={activeSegment}
                segmentOptions={segmentOptions}
                searchQuery={searchQuery}
                showSameInstance={showSameInstance}
                cardScale={cardScale}
                spacingScale={spacingScale}
                t={t}
                onActiveSegmentChange={setActiveSegment}
                onSearchQueryChange={setSearchQuery}
                onShowSameInstanceChange={changeShowSameInstance}
                onCardScaleChange={changeCardScalePreference}
                onSpacingScaleChange={changeSpacingScalePreference}
            />

            <FriendsLocationsVirtualList
                scrollRef={scrollRef}
                isLoading={isLoading}
                isError={isError}
                hasVisibleSections={hasVisibleSections}
                rosterDetail={rosterDetail}
                activeSegment={activeSegment}
                isFavoritesLoaded={isFavoritesLoaded}
                positionedRows={positionedRows}
                visibleVirtualRows={visibleVirtualRows}
                cardGridGap={cardGridGap}
                cardGridMinWidth={cardGridMinWidth}
                cardGridColumns={cardGridColumns}
                cardGridRowHeight={cardGridRowHeight}
                currentUserId={currentUserId}
                cardScale={cardScale}
                spacingScale={spacingScale}
                canUseFriendLocation={canUseFriendLocation}
                canSendInvite={canSendInvite}
                canBoop={canBoop}
                t={t}
                onOpenSectionWorld={openSectionWorld}
                onOpenSectionGroup={openSectionGroup}
                onToggleFavoriteGroup={toggleFavoriteGroup}
                onOpenFriendUser={openFriendUser}
                onOpenFriendWorld={openFriendWorld}
                onOpenFriendGroup={openFriendGroup}
                onLaunchFriendLocation={launchFriendLocation}
                onSelfInviteFriendLocation={selfInviteFriendLocation}
                onSendFriendInvite={sendFriendInvite}
                onRequestFriendInvite={requestFriendInvite}
                onSendFriendBoop={sendFriendBoop}
            />
        </div>
    );
}
