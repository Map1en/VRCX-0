import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    FriendRecord,
    FriendRosterById
} from '@/domain/friends/friendRosterTypes';
import { resolveObservedPlayerUserIds } from '@/domain/friends/sameInstanceFriends';
import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import {
    checkCanInvite,
    type InviteLocationCurrentUserSnapshot,
    type InviteLocationGameState
} from '@/shared/utils/invite';
import type {
    FavoriteGroup,
    FavoriteGroupMap
} from '@/state/favoriteStoreTypes';

import { buildFriendsLocationsSegmentOptions } from './friendsLocationsConfig';
import {
    getFriendsLocationsCardRowHeight,
    getFriendsLocationsDensityConfig,
    type FriendsLocationsCardContentMode
} from './friendsLocationsDensity';
import {
    buildSameInstanceGroups,
    normalizeFriendsLocationId as normalizeId,
    partitionFriendsByPrivateLocation,
    resolveFriendsLocationsCurrentInviteLocation as resolveCurrentInviteLocation,
    uniqueFriendsById
} from './friendsLocationsRows';
import {
    buildFriendsLocationsFavoriteIdSet as buildFavoriteIdSet,
    matchesFriendLocationSearch as matchesSearch
} from './friendsLocationsSearch';
import {
    buildFavoriteGroupLabelsByFriendId,
    buildFriendSections,
    buildSameInstanceSections,
    compareFavoriteGroups,
    sortActiveFriendsBySidebarPrefs,
    sortFriendsBySidebarPrefs
} from './friendsLocationsSections';

type FriendsLocationsSegment =
    | 'online'
    | 'favorite'
    | 'same-instance'
    | 'active'
    | 'offline'
    | string;

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
    currentLocationPlayerIds?: unknown;
    currentLocationPlayers?: unknown;
    isGameRunning?: unknown;
};

type FriendsLocationsCurrentUserSnapshot = InviteLocationCurrentUserSnapshot &
    Record<string, unknown>;

export type FriendsLocationsSection = {
    key: string;
    type?: 'favoriteGroup' | string;
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
          type: 'group-header' | 'header';
          key: string;
          height: number;
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
    density: unknown;
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
    showSameInstanceInOnline: boolean;
    sidebarFavoritePrefs: FriendsLocationsFavoritePreferences;
    sidebarSortMethods: string[];
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
    showSameInstanceInOnline,
    sidebarFavoritePrefs,
    sidebarSortMethods
}: FriendsLocationsPageDerivedStateInput) {
    const { t } = useTranslation();
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
            checkCanInvite(currentInviteLocation, {
                currentUserId: currentUserId ?? '',
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
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
    const selectedFavoriteGroupKeys = useMemo<Set<string>>(() => {
        const configured = sidebarFavoritePrefs.selectedGroups.filter(
            (groupKey) => allFavoriteGroupKeys.includes(groupKey)
        );
        return new Set(configured.length ? configured : allFavoriteGroupKeys);
    }, [allFavoriteGroupKeys, sidebarFavoritePrefs.selectedGroups]);
    const selectedFavoriteIds = useMemo<Set<string>>(() => {
        if (!allFavoriteGroupKeys.length) {
            return favoriteIds;
        }
        const ids = new Set<string>();
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
    const onlineFriends = useMemo<FriendRecord[]>(
        () =>
            sortFriendsBySidebarPrefs(
                onlineIds.map((id) => friendsById[id]).filter(isPresent),
                sidebarSortMethods
            ),
        [friendsById, onlineIds, sidebarSortMethods]
    );
    const activeFriends = useMemo<FriendRecord[]>(
        () =>
            sortActiveFriendsBySidebarPrefs(
                activeIds.map((id) => friendsById[id]).filter(isPresent),
                sidebarSortMethods
            ),
        [activeIds, friendsById, sidebarSortMethods]
    );
    const offlineFriends = useMemo<FriendRecord[]>(
        () =>
            sortFriendsBySidebarPrefs(
                offlineIds.map((id) => friendsById[id]).filter(isPresent),
                sidebarSortMethods
            ),
        [friendsById, offlineIds, sidebarSortMethods]
    );
    const favoriteFriends = useMemo<FriendRecord[]>(
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
    const onlineNonFavoriteFriends = useMemo<FriendRecord[]>(
        () =>
            onlineFriends.filter(
                (friend) =>
                    !onlineFavoriteExclusionIds.has(normalizeId(friend?.id))
            ),
        [onlineFavoriteExclusionIds, onlineFriends]
    );
    const sameInstanceGroups = useMemo<FriendsLocationsSameInstanceGroup[]>(
        () => buildSameInstanceGroups(onlineFriends, currentLocationSnapshot),
        [currentLocationSnapshot, onlineFriends]
    );
    const sameInstanceFriends = useMemo<FriendRecord[]>(
        () => sameInstanceGroups.flatMap((group) => group.friends),
        [sameInstanceGroups]
    );
    const sameInstanceFriendIds = useMemo<Set<string>>(
        () =>
            new Set(
                sameInstanceFriends
                    .map((friend) => normalizeId(friend?.id))
                    .filter(Boolean)
            ),
        [sameInstanceFriends]
    );
    const onlineWithoutSameInstanceFriends = useMemo<FriendRecord[]>(
        () =>
            onlineNonFavoriteFriends.filter(
                (friend) => !sameInstanceFriendIds.has(normalizeId(friend?.id))
            ),
        [onlineNonFavoriteFriends, sameInstanceFriendIds]
    );
    const segmentMap = useMemo<Record<string, FriendRecord[]>>(
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
    const segmentOptions = useMemo(
        () =>
            buildFriendsLocationsSegmentOptions({
                online:
                    onlineWithoutSameInstanceFriends.length +
                    (showSameInstanceInOnline ? sameInstanceFriends.length : 0),
                favorite: favoriteFriends.length,
                'same-instance': sameInstanceFriends.length,
                active: activeFriends.length,
                offline: offlineFriends.length
            }),
        [
            activeFriends.length,
            favoriteFriends.length,
            offlineFriends.length,
            onlineWithoutSameInstanceFriends.length,
            sameInstanceFriends.length,
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
                    ? onlineNonFavoriteFriends
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
        onlineNonFavoriteFriends,
        onlineWithoutSameInstanceFriends,
        segmentMap,
        showSameInstanceInOnline
    ]);
    const favoriteGroupSections = useMemo<FriendsLocationsSection[]>(() => {
        if (
            !sidebarFavoritePrefs.isDivideByGroup ||
            activeSegment !== 'favorite' ||
            deferredSearchQuery.trim()
        ) {
            return [];
        }
        const friendById = new Map<string, FriendRecord>(
            favoriteFriends.map((friend) => [normalizeId(friend?.id), friend])
        );
        const seen = new Set<string>();
        const sections: FriendsLocationsSection[] = [];
        const orderedRemoteGroups = favoriteFriendGroups
            .map(
                (group): FriendsLocationsFavoriteGroupDescriptor => ({
                    key: normalizeId(group?.key),
                    label:
                        group?.displayName ||
                        group?.name ||
                        normalizeId(group?.key)
                })
            )
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
            .map(
                (groupName): FriendsLocationsFavoriteGroupDescriptor => ({
                    key: `local:${groupName}`,
                    label: groupName
                })
            )
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
                .filter(isPresent);
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
                collapsed: collapsedGroups.has(group.key)
            });
        }
        for (const group of orderedLocalGroups) {
            const groupName = group.key.slice(6);
            const friendsInGroup = (localFriendFavorites?.[groupName] || [])
                .map((id) => friendById.get(normalizeId(id)))
                .filter(isPresent);
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
                collapsed: collapsedGroups.has(group.key)
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
                title: t('view.friends_locations.favorite'),
                description: '',
                friends: sortFriendsBySidebarPrefs(
                    ungrouped,
                    sidebarSortMethods
                ),
                worldId: '',
                groupId: '',
                collapsed: collapsedGroups.has('ungrouped')
            });
        }
        return sections;
    }, [
        activeSegment,
        collapsedGroups,
        deferredSearchQuery,
        favoriteFriendGroups,
        favoriteFriends,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites,
        selectedFavoriteGroupKeys,
        sidebarFavoritePrefs.groupOrder,
        sidebarFavoritePrefs.isDivideByGroup,
        sidebarSortMethods,
        t
    ]);
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
                                normalizeId(visibleFriend?.id) ===
                                normalizeId(friend?.id)
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
            }).map(
                (section): FriendsLocationsSection => ({
                    ...section,
                    cardContentMode: 'status'
                })
            );
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
                      }).map(
                          (section): FriendsLocationsSection => ({
                              ...section,
                              cardContentMode: 'status'
                          })
                      )
                    : [];
            const remainingFriends = showSameInstanceInOnline
                ? onlineWithoutSameInstanceFriends
                : visibleFriends;
            const {
                visibleLocation: availableFriends,
                privateLocation: privateFriends
            } = partitionFriendsByPrivateLocation(remainingFriends);
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
        onlineWithoutSameInstanceFriends,
        sameInstanceGroups,
        sameInstanceFriends,
        showSameInstanceInOnline,
        visibleFriends,
        t
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
    const sectionHeaderGap = cardGridGap;
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
            if (section.topDivider) {
                rows.push({
                    type: 'divider',
                    key: `divider:${section.key}`,
                    height: Math.max(12, cardGridGap * 2)
                });
            }
            const showHeader = !isCollapsibleGroup && section.key !== 'flat';
            if (showHeader) {
                rows.push({
                    type: 'header',
                    key: `header:${section.key}`,
                    height: 48,
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
        sectionHeaderGap,
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
        gameState?.isGameRunning &&
        currentInviteLocation &&
        canInviteFromCurrentLocation
    );

    return {
        cardGridColumns,
        cardGridGap,
        cardGridMinWidth,
        canInviteFromCurrentLocation,
        canSendInvite,
        currentInviteLocation,
        densityConfig,
        favoriteIds,
        friendsMap,
        hasVisibleSections,
        isLoading,
        positionedRows,
        segmentOptions,
        visibleVirtualRows
    };
}
