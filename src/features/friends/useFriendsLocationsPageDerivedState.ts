import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    collectFavoriteGroupFriendIds,
    resolveSelectedFavoriteGroupKeys
} from '@/domain/favorites/favoriteGroupSelection';
import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import type { FavoriteGroup, FavoriteGroupMap } from '@/domain/favorites/types';
import {
    localGameLocation,
    presenceOf,
    presencePlatform
} from '@/domain/friends/presence';
import {
    buildSameInstanceFriendGroups,
    resolveObservedPlayerUserIds
} from '@/domain/friends/sameInstanceFriends';
import type { FriendRecord, FriendRosterById } from '@/domain/friends/types';
import type { CurrentInstanceRosterPlayer } from '@/domain/instances/currentInstanceRoster';
import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { useFriendSortContext } from '@/lib/useFriendStats';
import { useWorldSummaries } from '@/lib/useWorldSummaries';
import {
    checkCanInvite,
    type InviteLocationCurrentUserSnapshot,
    type InviteLocationGameState,
    resolveCurrentInviteLocation,
    resolveInviteLocation
} from '@/shared/utils/invite';
import { normalizeString } from '@/shared/utils/string';
import { computeTrustLevel } from '@/shared/utils/userTransforms';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';

import {
    buildFriendsLocationsSegmentOptions,
    type FriendsLocationsSegment
} from './friendsLocationsConfig';
import {
    getFriendsLocationsCardRowHeight,
    getFriendsLocationsDensityConfig,
    type FriendsLocationsCardContentMode,
    type FriendsLocationsDensity
} from './friendsLocationsDensity';
import {
    partitionFriendsByPrivateLocation,
    uniqueFriendsById
} from './friendsLocationsRows';
import { matchesFriendLocationSearch as matchesSearch } from './friendsLocationsSearch';
import {
    buildFavoriteGroupLabelsByFriendId,
    buildFriendSections,
    buildSameInstanceSections,
    compareFavoriteGroups,
    sortActiveFriendsBySidebarPrefs,
    sortFriendsBySidebarPrefs
} from './friendsLocationsSections';
import {
    buildFriendWorldGroups,
    type FriendsLocationsViewMode,
    type FriendsLocationsWorldGroup
} from './friendsLocationsWorlds';

type FriendsLocationsFavoritePreferences = {
    isDivideByGroup: boolean;
    selectedGroups: string[];
    groupOrder: string[];
};

type FriendsLocationsScrollMetrics = {
    width: number;
    viewportHeight: number;
    scrollTop: number;
};

type FriendsLocationsGameState = InviteLocationGameState & {
    currentLocationPlayerIds?: readonly string[];
    currentLocationPlayers?: readonly CurrentInstanceRosterPlayer[];
};

type FriendsLocationsCurrentUserSnapshot = InviteLocationCurrentUserSnapshot &
    Record<string, unknown>;

export type FriendsLocationsSection = {
    key: string;
    type?: 'favoriteGroup' | 'collapsibleGroup';
    groupKey?: string;
    title: string;
    description: string;
    friends: FriendRecord[];
    worldId: string;
    groupId: string;
    rawLocation?: string;
    collapsed?: boolean;
    topDivider?: boolean;
    displayInstanceInfo?: boolean;
    cardContentMode?: FriendsLocationsCardContentMode;
};

type FriendsLocationsSameInstanceGroup = {
    location: string;
    friends: FriendRecord[];
};

type FriendsLocationsFavoriteGroupDescriptor = {
    key: string;
    label: string;
};

export type FriendsLocationsVirtualRow =
    | {
          type: 'group-header';
          key: string;
          height: number;
          topGap: number;
          section: FriendsLocationsSection;
      }
    | {
          type: 'header';
          key: string;
          height: number;
          topGap: number;
          section: FriendsLocationsSection;
      }
    | {
          type: 'divider';
          key: string;
          height: number;
      }
    | {
          type: 'cards';
          key: string;
          height: number;
          topGap: number;
          gridRowHeight: number;
          section: FriendsLocationsSection;
          friends: FriendRecord[];
      };

type FriendsLocationsPageDerivedStateInput = {
    activeIds: string[];
    activeSegment: FriendsLocationsSegment;
    collapsedGroups: Set<string>;
    currentUserId?: string | null;
    currentUserSnapshot?: FriendsLocationsCurrentUserSnapshot | null;
    deferredSearchQuery: string;
    density: FriendsLocationsDensity;
    favoriteFriendGroups: FavoriteGroup[];
    friendsById: FriendRosterById;
    gameState?: FriendsLocationsGameState | null;
    groupedFavoriteFriendIdsByGroupKey: Record<string, string[]>;
    localFriendFavoriteGroups: string[];
    localFriendFavorites: FavoriteGroupMap;
    offlineIds: string[];
    onlineIds: string[];
    remoteFavoriteFriendIds: string[];
    rosterStatus: string;
    scrollMetrics: FriendsLocationsScrollMetrics;
    showFavoritesInOnline: boolean;
    showSameInstanceInOnline: boolean;
    sidebarFavoritePrefs: FriendsLocationsFavoritePreferences;
    sidebarSortMethods: string[];
    viewMode: FriendsLocationsViewMode;
};

function isPresent<T>(value: T | null | undefined): value is T {
    return value != null;
}

export function useFriendsLocationsPageDerivedState({
    activeIds,
    activeSegment,
    collapsedGroups,
    currentUserId,
    currentUserSnapshot,
    deferredSearchQuery,
    density,
    favoriteFriendGroups,
    friendsById,
    gameState,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavoriteGroups,
    localFriendFavorites,
    offlineIds,
    onlineIds,
    remoteFavoriteFriendIds,
    rosterStatus,
    scrollMetrics,
    showFavoritesInOnline,
    showSameInstanceInOnline,
    sidebarFavoritePrefs,
    sidebarSortMethods,
    viewMode
}: FriendsLocationsPageDerivedStateInput) {
    const { t } = useTranslation();
    const locationTimes = useFriendLocationTimeStore((state) => state.byUserId);
    const sortContext = useFriendSortContext(sidebarSortMethods, locationTimes);
    const densityConfig = useMemo(
        () => getFriendsLocationsDensityConfig(density),
        [density]
    );
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
    const inviteLocation = useMemo(
        () => resolveInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const currentLocationPlayerIds = gameState?.currentLocationPlayerIds;
    const currentLocationPlayers = gameState?.currentLocationPlayers;
    const currentLocationSnapshot = useMemo(
        () => ({
            location: currentInviteLocation,
            friendList: new Set(
                resolveObservedPlayerUserIds(
                    currentLocationPlayerIds,
                    currentLocationPlayers,
                    friendsById
                )
            )
        }),
        [
            currentInviteLocation,
            currentLocationPlayerIds,
            currentLocationPlayers,
            friendsById
        ]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(inviteLocation, {
                currentUserId: currentUserId ?? '',
                lastLocationStr: inviteLocation,
                cachedInstances: new Map()
            }),
        [inviteLocation, currentUserId]
    );
    const favoriteGroupLabelsByFriendId = useMemo<Map<string, string[]>>(
        () =>
            buildFavoriteGroupLabelsByFriendId({
                favoriteFriendGroups,
                groupedFavoriteFriendIdsByGroupKey,
                localFriendFavorites,
                t
            }),
        [
            favoriteFriendGroups,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavorites,
            t
        ]
    );
    const allFavoriteGroupKeys = useMemo<string[]>(
        () => [
            ...favoriteFriendGroups
                .map((group) => normalizeString(group?.key))
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
    const selectedFavoriteGroupKeys = useMemo<Set<string>>(
        () =>
            new Set(
                resolveSelectedFavoriteGroupKeys(
                    sidebarFavoritePrefs.selectedGroups,
                    allFavoriteGroupKeys
                )
            ),
        [allFavoriteGroupKeys, sidebarFavoritePrefs.selectedGroups]
    );
    const selectedFavoriteIds = useMemo<Set<string>>(
        () =>
            allFavoriteGroupKeys.length
                ? collectFavoriteGroupFriendIds(
                      selectedFavoriteGroupKeys,
                      groupedFavoriteFriendIdsByGroupKey,
                      localFriendFavorites
                  )
                : favoriteIds,
        [
            allFavoriteGroupKeys,
            favoriteIds,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavorites,
            selectedFavoriteGroupKeys
        ]
    );
    const onlineFriends = useMemo<FriendRecord[]>(
        () =>
            sortFriendsBySidebarPrefs(
                onlineIds.map((id) => friendsById[id]).filter(isPresent),
                sidebarSortMethods,
                sortContext
            ),
        [friendsById, onlineIds, sidebarSortMethods, sortContext]
    );
    const activeFriends = useMemo<FriendRecord[]>(
        () =>
            sortActiveFriendsBySidebarPrefs(
                activeIds.map((id) => friendsById[id]).filter(isPresent),
                sidebarSortMethods,
                sortContext
            ),
        [activeIds, friendsById, sidebarSortMethods, sortContext]
    );
    const offlineFriends = useMemo<FriendRecord[]>(
        () =>
            sortFriendsBySidebarPrefs(
                offlineIds.map((id) => friendsById[id]).filter(isPresent),
                sidebarSortMethods,
                sortContext
            ),
        [friendsById, offlineIds, sidebarSortMethods, sortContext]
    );
    const favoriteFriends = useMemo<FriendRecord[]>(
        () =>
            onlineFriends.filter((friend) =>
                selectedFavoriteIds.has(normalizeString(friend?.id))
            ),
        [onlineFriends, selectedFavoriteIds]
    );
    const onlineFavoriteExclusionIds = sidebarFavoritePrefs.selectedGroups
        .length
        ? selectedFavoriteIds
        : favoriteIds;
    const onlineNonFavoriteFriends = useMemo<FriendRecord[]>(
        () =>
            onlineFriends.filter(
                (friend) =>
                    !onlineFavoriteExclusionIds.has(normalizeString(friend?.id))
            ),
        [onlineFavoriteExclusionIds, onlineFriends]
    );
    const currentUserRecord = useMemo<FriendRecord | null>(() => {
        const presence = presenceOf(currentUserSnapshot);
        if (
            !currentUserId ||
            !currentUserSnapshot ||
            !presence ||
            normalizeString(currentUserSnapshot.id) !== currentUserId
        ) {
            return null;
        }
        const tags = Array.isArray(currentUserSnapshot.tags)
            ? currentUserSnapshot.tags.filter(
                  (tag): tag is string => typeof tag === 'string'
              )
            : [];
        const trust = computeTrustLevel(
            tags,
            normalizeString(currentUserSnapshot.developerType)
        );
        return {
            ...currentUserSnapshot,
            id: currentUserId,
            displayName:
                normalizeString(currentUserSnapshot.displayName) ||
                currentUserId,
            tags,
            $presence: presence,
            $friendNumber: 0,
            $trustLevel: trust.trustLevel,
            $trustClass: trust.trustClass,
            $trustSortNum: trust.trustSortNum,
            $isModerator: trust.isModerator,
            $isTroll: trust.isTroll,
            $isProbableTroll: trust.isProbableTroll,
            $platform: presencePlatform(
                presence,
                normalizeString(currentUserSnapshot.last_platform)
            )
        };
    }, [currentUserId, currentUserSnapshot]);
    const sameInstanceGroups = useMemo<
        FriendsLocationsSameInstanceGroup[]
    >(() => {
        const onlineFriendIds = new Set(
            onlineFriends.map((friend) => normalizeString(friend.id))
        );
        const localFriends: FriendRecord[] = [];
        for (const [userId, time] of Object.entries(locationTimes)) {
            if (time.source !== 'gameLog' || onlineFriendIds.has(userId)) {
                continue;
            }
            const friend = friendsById[userId];
            if (friend) {
                localFriends.push(friend);
            }
        }
        const candidates = localFriends.length
            ? sortFriendsBySidebarPrefs(
                  [...onlineFriends, ...localFriends],
                  sidebarSortMethods,
                  sortContext
              )
            : onlineFriends;
        const groups = buildSameInstanceFriendGroups(
            candidates,
            currentLocationSnapshot,
            {
                includeCurrentUser: true,
                locationTimes
            }
        );
        if (!currentUserRecord) {
            return groups;
        }
        return groups.map((group) =>
            group.location === currentInviteLocation
                ? {
                      ...group,
                      friends: [
                          currentUserRecord,
                          ...group.friends.filter(
                              (friend) => friend.id !== currentUserId
                          )
                      ]
                  }
                : group
        );
    }, [
        currentInviteLocation,
        currentLocationSnapshot,
        currentUserId,
        currentUserRecord,
        friendsById,
        locationTimes,
        onlineFriends,
        sidebarSortMethods,
        sortContext
    ]);
    const sameInstanceFriends = useMemo<FriendRecord[]>(
        () => sameInstanceGroups.flatMap((group) => group.friends),
        [sameInstanceGroups]
    );
    const sameInstanceFriendIds = useMemo<Set<string>>(
        () =>
            new Set(
                sameInstanceFriends
                    .map((friend) => normalizeString(friend?.id))
                    .filter(Boolean)
            ),
        [sameInstanceFriends]
    );
    const onlineSegmentFriends = showFavoritesInOnline
        ? onlineFriends
        : onlineNonFavoriteFriends;
    const onlineWithoutSameInstanceFriends = useMemo<FriendRecord[]>(
        () =>
            onlineSegmentFriends.filter(
                (friend) =>
                    !sameInstanceFriendIds.has(normalizeString(friend?.id))
            ),
        [onlineSegmentFriends, sameInstanceFriendIds]
    );
    const segmentMap = useMemo<Record<string, FriendRecord[]>>(
        () => ({
            online: onlineFriends,
            onlineNonFavorite: onlineNonFavoriteFriends,
            favorite: favoriteFriends,
            'same-instance': sameInstanceFriends,
            active: activeFriends.filter(
                (friend) =>
                    !sameInstanceFriendIds.has(normalizeString(friend.id))
            ),
            offline: offlineFriends.filter(
                (friend) =>
                    !sameInstanceFriendIds.has(normalizeString(friend.id))
            )
        }),
        [
            activeFriends,
            favoriteFriends,
            offlineFriends,
            onlineFriends,
            onlineNonFavoriteFriends,
            sameInstanceFriends,
            sameInstanceFriendIds
        ]
    );
    const segmentOptions = useMemo(
        () =>
            buildFriendsLocationsSegmentOptions({
                online:
                    onlineWithoutSameInstanceFriends.length +
                    (showSameInstanceInOnline ? sameInstanceFriends.length : 0),
                favorite: favoriteFriends.length,
                'same-instance': sameInstanceFriends.length,
                active: segmentMap.active.length,
                offline: segmentMap.offline.length
            }),
        [
            favoriteFriends.length,
            onlineWithoutSameInstanceFriends.length,
            sameInstanceFriends.length,
            segmentMap,
            showSameInstanceInOnline
        ]
    );
    const visibleFriends = useMemo<FriendRecord[]>(() => {
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
                ? showSameInstanceInOnline
                    ? onlineSegmentFriends
                    : onlineWithoutSameInstanceFriends
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
        onlineSegmentFriends,
        onlineWithoutSameInstanceFriends,
        segmentMap,
        showSameInstanceInOnline
    ]);
    const groupFavoriteFriends = useCallback(
        (
            friends: FriendRecord[],
            keyPrefix: string,
            ungroupedTitle: string
        ): FriendsLocationsSection[] => {
            const friendById = new Map<string, FriendRecord>(
                friends.map((friend) => [normalizeString(friend?.id), friend])
            );
            const seen = new Set<string>();
            const sections: FriendsLocationsSection[] = [];
            const orderedRemoteGroups = favoriteFriendGroups
                .map((group): FriendsLocationsFavoriteGroupDescriptor => ({
                    key: normalizeString(group?.key),
                    label:
                        group?.displayName ||
                        group?.name ||
                        normalizeString(group?.key)
                }))
                .filter(
                    (group) =>
                        group.key && selectedFavoriteGroupKeys.has(group.key)
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
                .map((groupName): FriendsLocationsFavoriteGroupDescriptor => ({
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
                    .map((id) => friendById.get(normalizeString(id)))
                    .filter(isPresent);
                if (!friendsInGroup.length) {
                    continue;
                }
                for (const friend of friendsInGroup) {
                    seen.add(normalizeString(friend?.id));
                }
                sections.push({
                    key: `${keyPrefix}:${group.key}`,
                    type: 'favoriteGroup',
                    groupKey: group.key,
                    title: group.label,
                    description: '',
                    friends: sortFriendsBySidebarPrefs(
                        friendsInGroup,
                        sidebarSortMethods,
                        sortContext
                    ),
                    worldId: '',
                    groupId: '',
                    collapsed: collapsedGroups.has(group.key)
                });
            }
            for (const group of orderedLocalGroups) {
                const groupName = group.key.slice(6);
                const friendsInGroup = (localFriendFavorites?.[groupName] || [])
                    .map((id) => friendById.get(normalizeString(id)))
                    .filter(isPresent);
                if (!friendsInGroup.length) {
                    continue;
                }
                for (const friend of friendsInGroup) {
                    seen.add(normalizeString(friend?.id));
                }
                sections.push({
                    key: `${keyPrefix}:${group.key}`,
                    type: 'favoriteGroup',
                    groupKey: group.key,
                    title: group.label,
                    description: '',
                    friends: sortFriendsBySidebarPrefs(
                        friendsInGroup,
                        sidebarSortMethods,
                        sortContext
                    ),
                    worldId: '',
                    groupId: '',
                    collapsed: collapsedGroups.has(group.key)
                });
            }
            const ungrouped = friends.filter(
                (friend) => !seen.has(normalizeString(friend?.id))
            );
            if (ungrouped.length) {
                sections.push({
                    key: `${keyPrefix}:ungrouped`,
                    type: 'favoriteGroup',
                    groupKey: 'ungrouped',
                    title: ungroupedTitle,
                    description: '',
                    friends: sortFriendsBySidebarPrefs(
                        ungrouped,
                        sidebarSortMethods,
                        sortContext
                    ),
                    worldId: '',
                    groupId: '',
                    collapsed: collapsedGroups.has('ungrouped')
                });
            }
            return sections;
        },
        [
            collapsedGroups,
            favoriteFriendGroups,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavoriteGroups,
            localFriendFavorites,
            selectedFavoriteGroupKeys,
            sidebarFavoritePrefs.groupOrder,
            sidebarSortMethods,
            sortContext
        ]
    );
    const favoriteGroupSections = useMemo<FriendsLocationsSection[]>(
        () =>
            sidebarFavoritePrefs.isDivideByGroup &&
            activeSegment === 'favorite' &&
            !deferredSearchQuery.trim()
                ? groupFavoriteFriends(
                      favoriteFriends,
                      'favorite',
                      t('view.friends_locations.favorite')
                  )
                : [],
        [
            activeSegment,
            deferredSearchQuery,
            favoriteFriends,
            groupFavoriteFriends,
            sidebarFavoritePrefs.isDivideByGroup,
            t
        ]
    );
    const visibleSections = useMemo<FriendsLocationsSection[]>(() => {
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
                                normalizeString(visibleFriend?.id) ===
                                normalizeString(friend?.id)
                        )
                    )
                }))
                .filter((group) => group.friends.length > 0);
            return buildSameInstanceSections({
                sameInstanceGroups: filteredSameGroups,
                displayInstanceInfo: false,
                favoriteIds,
                favoriteGroupLabelsByFriendId,
                t
            }).map((section): FriendsLocationsSection => ({
                ...section,
                cardContentMode: 'status'
            }));
        }
        if (!deferredSearchQuery.trim() && activeSegment === 'online') {
            const sameInstanceSections =
                showSameInstanceInOnline && sameInstanceFriends.length
                    ? buildSameInstanceSections({
                          sameInstanceGroups,
                          displayInstanceInfo: false,
                          favoriteIds,
                          favoriteGroupLabelsByFriendId,
                          t
                      }).map((section): FriendsLocationsSection => ({
                          ...section,
                          cardContentMode: 'status'
                      }))
                    : [];
            const remainingFriends = showSameInstanceInOnline
                ? onlineWithoutSameInstanceFriends
                : visibleFriends;
            const onlineFavoriteFriends = remainingFriends.filter((friend) =>
                onlineFavoriteExclusionIds.has(normalizeString(friend?.id))
            );
            const {
                visibleLocation: availableFriends,
                privateLocation: privateFriends
            } = partitionFriendsByPrivateLocation(
                remainingFriends.filter(
                    (friend) =>
                        !onlineFavoriteExclusionIds.has(
                            normalizeString(friend?.id)
                        )
                ),
                (friendId) => localGameLocation(locationTimes[friendId])
            );
            const privateSections: FriendsLocationsSection[] =
                privateFriends.length
                    ? [
                          {
                              key: 'online:private-location',
                              type: 'collapsibleGroup',
                              groupKey: 'private-location',
                              title: t('location.private'),
                              description: '',
                              friends: privateFriends,
                              worldId: '',
                              groupId: '',
                              displayInstanceInfo: false,
                              cardContentMode: 'status',
                              collapsed: collapsedGroups.has('private-location')
                          }
                      ]
                    : [];
            return [
                ...sameInstanceSections,
                ...(sidebarFavoritePrefs.isDivideByGroup
                    ? groupFavoriteFriends(
                          onlineFavoriteFriends,
                          'online:favorite',
                          t('view.friends_locations.favorite_friends')
                      )
                    : onlineFavoriteFriends.length
                      ? [
                            {
                                key: 'online:favorites',
                                title: t(
                                    'view.friends_locations.favorite_friends'
                                ),
                                description: '',
                                friends: onlineFavoriteFriends,
                                worldId: '',
                                groupId: ''
                            }
                        ]
                      : []),
                ...(availableFriends.length
                    ? [
                          {
                              key: 'online:remaining',
                              title: t('view.friends_locations.other_online'),
                              description: '',
                              friends: availableFriends,
                              worldId: '',
                              groupId: ''
                          }
                      ]
                    : []),
                ...privateSections
            ];
        }
        if (!deferredSearchQuery.trim() && activeSegment === 'active') {
            return [
                {
                    key: 'flat',
                    title: '',
                    description: '',
                    friends: visibleFriends,
                    worldId: '',
                    groupId: '',
                    displayInstanceInfo: false,
                    cardContentMode: 'status'
                }
            ];
        }
        if (!deferredSearchQuery.trim() && activeSegment === 'offline') {
            return [
                {
                    key: 'flat',
                    title: '',
                    description: '',
                    friends: visibleFriends,
                    worldId: '',
                    groupId: '',
                    displayInstanceInfo: false,
                    cardContentMode: 'identity'
                }
            ];
        }
        return buildFriendSections({
            friends: visibleFriends,
            groupingMode: 'flat',
            favoriteIds,
            favoriteGroupLabelsByFriendId,
            t
        });
    }, [
        activeSegment,
        collapsedGroups,
        deferredSearchQuery,
        favoriteGroupLabelsByFriendId,
        favoriteGroupSections,
        favoriteIds,
        groupFavoriteFriends,
        locationTimes,
        onlineFavoriteExclusionIds,
        onlineWithoutSameInstanceFriends,
        sameInstanceGroups,
        sameInstanceFriends,
        showSameInstanceInOnline,
        sidebarFavoritePrefs.isDivideByGroup,
        visibleFriends,
        t
    ]);
    const worldViewFriends = useMemo<FriendRecord[]>(
        () =>
            viewMode === 'worlds'
                ? sortActiveFriendsBySidebarPrefs(
                      onlineFriends.filter((friend) =>
                          matchesSearch(
                              friend,
                              deferredSearchQuery,
                              favoriteIds
                          )
                      ),
                      sidebarSortMethods,
                      sortContext
                  )
                : [],
        [
            deferredSearchQuery,
            favoriteIds,
            onlineFriends,
            sidebarSortMethods,
            viewMode,
            sortContext
        ]
    );
    const worldGroups = useMemo<FriendsLocationsWorldGroup[]>(() => {
        if (viewMode !== 'worlds') {
            return [];
        }
        const groups = buildFriendWorldGroups(
            worldViewFriends,
            currentInviteLocation,
            (friendId) => localGameLocation(locationTimes[friendId])
        );
        if (!currentUserRecord) {
            return groups;
        }
        return groups.map((group) => ({
            ...group,
            instances: group.instances.map((instance) =>
                instance.isCurrent
                    ? {
                          ...instance,
                          friends: [currentUserRecord, ...instance.friends]
                      }
                    : instance
            )
        }));
    }, [
        currentInviteLocation,
        currentUserRecord,
        locationTimes,
        viewMode,
        worldViewFriends
    ]);
    const privateWorldFriends = useMemo<FriendRecord[]>(
        () =>
            partitionFriendsByPrivateLocation(worldViewFriends, (friendId) =>
                localGameLocation(locationTimes[friendId])
            ).privateLocation,
        [locationTimes, worldViewFriends]
    );
    const worldIds = useMemo(
        () => worldGroups.map((group) => group.worldId),
        [worldGroups]
    );
    const worldSummaries = useWorldSummaries(worldIds);
    const hasVisibleSections = useMemo(
        () =>
            viewMode === 'worlds'
                ? worldGroups.length > 0 || privateWorldFriends.length > 0
                : visibleSections.some(
                      (section) =>
                          Array.isArray(section.friends) &&
                          section.friends.length > 0
                  ),
        [
            privateWorldFriends.length,
            viewMode,
            visibleSections,
            worldGroups.length
        ]
    );
    const isLoading =
        rosterStatus === 'running' &&
        onlineFriends.length + activeFriends.length + offlineFriends.length ===
            0;
    const cardGridGap = densityConfig.gridGap;
    const cardGridMinWidth = densityConfig.gridMinWidth;
    const cardGridEdgeInset = 1;
    const cardGridAvailableWidth = Math.max(
        0,
        scrollMetrics.width - cardGridEdgeInset * 2
    );
    const cardGridColumns = Math.max(
        1,
        Math.floor(
            (cardGridAvailableWidth + cardGridGap) /
                (cardGridMinWidth + cardGridGap)
        ) || 1
    );
    const sectionHeaderGap = 4;
    const sectionHeaderTopGap = 16;
    const sectionHeaderBaseHeight = 40;
    const virtualRows = useMemo<FriendsLocationsVirtualRow[]>(() => {
        const rows: FriendsLocationsVirtualRow[] = [];
        for (const section of visibleSections) {
            const friends = Array.isArray(section.friends)
                ? section.friends
                : [];
            if (!friends.length) {
                continue;
            }
            const isCollapsibleGroup =
                section.type === 'favoriteGroup' ||
                section.type === 'collapsibleGroup';
            if (isCollapsibleGroup) {
                const topGap = rows.length ? sectionHeaderTopGap : 0;
                rows.push({
                    type: 'group-header',
                    key: `group-header:${section.key}`,
                    height: sectionHeaderBaseHeight + topGap,
                    topGap,
                    section
                });
                if (section.collapsed) {
                    continue;
                }
            }
            if (section.topDivider) {
                rows.push({
                    type: 'divider',
                    key: `divider:${section.key}`,
                    height: Math.max(12, cardGridGap * 2)
                });
            }
            const showHeader = !isCollapsibleGroup && section.key !== 'flat';
            if (showHeader) {
                const topGap =
                    rows.length && !section.topDivider
                        ? sectionHeaderTopGap
                        : 0;
                rows.push({
                    type: 'header',
                    key: `header:${section.key}`,
                    height: sectionHeaderBaseHeight + topGap,
                    topGap,
                    section
                });
            }
            const gridRowHeight = getFriendsLocationsCardRowHeight(
                densityConfig,
                section.cardContentMode
            );
            for (
                let index = 0;
                index < friends.length;
                index += cardGridColumns
            ) {
                const topGap = showHeader && index === 0 ? sectionHeaderGap : 0;
                rows.push({
                    type: 'cards',
                    key: `cards:${section.key}:${index}`,
                    height: gridRowHeight + cardGridGap + topGap,
                    topGap,
                    gridRowHeight,
                    section,
                    friends: friends.slice(index, index + cardGridColumns)
                });
            }
        }
        return rows;
    }, [
        cardGridColumns,
        cardGridGap,
        densityConfig,
        sectionHeaderBaseHeight,
        sectionHeaderGap,
        sectionHeaderTopGap,
        visibleSections
    ]);
    const positionedRows = useMemo(() => {
        return positionKnownSizeRows(virtualRows);
    }, [virtualRows]);
    const visibleVirtualRows = useMemo(() => {
        const overscan = Math.max(360, scrollMetrics.viewportHeight);
        return getVisibleKnownSizeRows({
            rows: positionedRows.rows,
            scrollTop: scrollMetrics.scrollTop,
            viewportHeight: scrollMetrics.viewportHeight,
            overscan
        });
    }, [positionedRows, scrollMetrics.scrollTop, scrollMetrics.viewportHeight]);
    const canSendInvite = Boolean(
        inviteLocation && canInviteFromCurrentLocation
    );

    return {
        cardGridColumns,
        cardGridGap,
        cardGridMinWidth,
        canInviteFromCurrentLocation,
        canSendInvite,
        currentLocation: currentInviteLocation,
        currentInviteLocation: inviteLocation,
        densityConfig,
        favoriteIds,
        friendsMap,
        hasVisibleSections,
        isLoading,
        positionedRows,
        privateWorldFriends,
        segmentOptions,
        viewMode,
        visibleVirtualRows,
        worldGroups,
        worldSummaries
    };
}
