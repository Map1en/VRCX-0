import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { checkCanInvite } from '@/shared/utils/invite';

import { FRIENDS_LOCATIONS_SEGMENTS as SEGMENTS } from './friendsLocationsConfig';
import { getFriendsLocationsDensityConfig } from './friendsLocationsDensity';
import {
    buildSameInstanceGroups,
    normalizeFriendsLocationId as normalizeId,
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

export function useFriendsLocationsPageDerivedState({
    activeIds,
    activeSegment,
    collapsedFavoriteGroups,
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
}: any) {
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
    const favoriteGroupLabelsByFriendId = useMemo(
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
    const allFavoriteGroupKeys = useMemo(
        () => [
            ...favoriteFriendGroups
                .map((group: any) => normalizeId(group?.key))
                .filter(Boolean),
            ...(localFriendFavoriteGroups.length
                ? localFriendFavoriteGroups
                : Object.keys(localFriendFavorites || {})
            )
                .map((groupName: any) => `local:${groupName}`)
                .filter(Boolean)
        ],
        [favoriteFriendGroups, localFriendFavoriteGroups, localFriendFavorites]
    );
    const selectedFavoriteGroupKeys = useMemo(() => {
        const configured = sidebarFavoritePrefs.selectedGroups.filter(
            (groupKey: any) => allFavoriteGroupKeys.includes(groupKey)
        );
        return new Set(configured.length ? configured : allFavoriteGroupKeys);
    }, [allFavoriteGroupKeys, sidebarFavoritePrefs.selectedGroups]);
    const selectedFavoriteIds = useMemo(() => {
        if (!allFavoriteGroupKeys.length) {
            return favoriteIds;
        }
        const ids = new Set();
        for (const groupKey of selectedFavoriteGroupKeys as Set<string>) {
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
                onlineIds.map((id: any) => friendsById[id]).filter(Boolean),
                sidebarSortMethods
            ),
        [friendsById, onlineIds, sidebarSortMethods]
    );
    const activeFriends = useMemo(
        () =>
            sortActiveFriendsBySidebarPrefs(
                activeIds.map((id: any) => friendsById[id]).filter(Boolean),
                sidebarSortMethods
            ),
        [activeIds, friendsById, sidebarSortMethods]
    );
    const offlineFriends = useMemo(
        () =>
            sortFriendsBySidebarPrefs(
                offlineIds.map((id: any) => friendsById[id]).filter(Boolean),
                sidebarSortMethods
            ),
        [friendsById, offlineIds, sidebarSortMethods]
    );
    const favoriteFriends = useMemo(
        () =>
            onlineFriends.filter((friend: any) =>
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
                (friend: any) =>
                    !onlineFavoriteExclusionIds.has(normalizeId(friend?.id))
            ),
        [onlineFavoriteExclusionIds, onlineFriends]
    );
    const sameInstanceGroups = useMemo(
        () => buildSameInstanceGroups(onlineFriends, currentLocationSnapshot),
        [currentLocationSnapshot, onlineFriends]
    );
    const sameInstanceFriends = useMemo(
        () => sameInstanceGroups.flatMap((group: any) => group.friends),
        [sameInstanceGroups]
    );
    const sameInstanceFriendIds = useMemo(
        () =>
            new Set(
                sameInstanceFriends
                    .map((friend: any) => normalizeId(friend?.id))
                    .filter(Boolean)
            ),
        [sameInstanceFriends]
    );
    const onlineWithoutSameInstanceFriends = useMemo(
        () =>
            onlineNonFavoriteFriends.filter(
                (friend: any) =>
                    !sameInstanceFriendIds.has(normalizeId(friend?.id))
            ),
        [onlineNonFavoriteFriends, sameInstanceFriendIds]
    );
    const segmentOptions = SEGMENTS;
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
            ]).filter((friend: any) =>
                matchesSearch(friend, deferredSearchQuery, favoriteIds)
            );
        }
        const source =
            activeSegment === 'online'
                ? showSameInstanceInOnline
                    ? onlineNonFavoriteFriends
                    : onlineWithoutSameInstanceFriends
                : (segmentMap[activeSegment as keyof typeof segmentMap] ?? []);
        return source.filter((friend: any) =>
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
    const favoriteGroupSections = useMemo(() => {
        if (
            !sidebarFavoritePrefs.isDivideByGroup ||
            activeSegment !== 'favorite' ||
            deferredSearchQuery.trim()
        ) {
            return [];
        }
        const friendById = new Map(
            favoriteFriends.map((friend: any) => [
                normalizeId(friend?.id),
                friend
            ])
        );
        const seen = new Set();
        const sections = [];
        const orderedRemoteGroups = favoriteFriendGroups
            .map((group: any) => ({
                key: normalizeId(group?.key),
                label:
                    group?.displayName || group?.name || normalizeId(group?.key)
            }))
            .filter(
                (group: any) =>
                    group.key && selectedFavoriteGroupKeys.has(group.key)
            )
            .sort((left: any, right: any) =>
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
            .map((groupName: any) => ({
                key: `local:${groupName}`,
                label: groupName
            }))
            .filter((group: any) => selectedFavoriteGroupKeys.has(group.key))
            .sort((left: any, right: any) =>
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
                .map((id: any) => friendById.get(normalizeId(id)))
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
                .map((id: any) => friendById.get(normalizeId(id)))
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
            (friend: any) => !seen.has(normalizeId(friend?.id))
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
        sidebarSortMethods,
        t
    ]);
    const visibleSections = useMemo(() => {
        if (favoriteGroupSections.length) {
            return favoriteGroupSections;
        }
        if (!deferredSearchQuery.trim() && activeSegment === 'same-instance') {
            const filteredSameGroups = sameInstanceGroups
                .map((group: any) => ({
                    ...group,
                    friends: group.friends.filter((friend: any) =>
                        visibleFriends.some(
                            (visibleFriend: any) =>
                                normalizeId(visibleFriend?.id) ===
                                normalizeId(friend?.id)
                        )
                    )
                }))
                .filter((group: any) => group.friends.length > 0);
            return buildSameInstanceSections({
                sameInstanceGroups: filteredSameGroups,
                displayInstanceInfo: false,
                favoriteIds,
                favoriteGroupLabelsByFriendId,
                t
            });
        }
        if (
            !deferredSearchQuery.trim() &&
            activeSegment === 'online' &&
            showSameInstanceInOnline &&
            sameInstanceFriends.length
        ) {
            const sameInstanceSections = buildSameInstanceSections({
                sameInstanceGroups,
                displayInstanceInfo: false,
                favoriteIds,
                favoriteGroupLabelsByFriendId,
                t
            });
            const otherFriends = onlineWithoutSameInstanceFriends.filter(
                (friend: any) =>
                    matchesSearch(friend, deferredSearchQuery, favoriteIds)
            );
            return [
                ...sameInstanceSections,
                ...(otherFriends.length
                    ? [
                          {
                              key: 'online:remaining',
                              title: t('view.friends_locations.online'),
                              description: '',
                              friends: otherFriends,
                              worldId: '',
                              groupId: '',
                              topDivider: true
                          }
                      ]
                    : [])
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
                (section: any) =>
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
    const cardGridRowHeight = densityConfig.rowHeight;
    const cardRowHeight = cardGridRowHeight + cardGridGap;
    const sectionHeaderGap = cardGridGap;
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
            if (section.topDivider) {
                rows.push({
                    type: 'divider',
                    key: `divider:${section.key}`,
                    height: Math.max(12, cardGridGap * 2)
                });
            }
            const showHeader =
                section.type !== 'favoriteGroup' &&
                section.key !== 'flat' &&
                section.key !== 'online:remaining';
            if (showHeader) {
                rows.push({
                    type: 'header',
                    key: `header:${section.key}`,
                    height: 48,
                    section
                });
            }
            for (
                let index = 0;
                index < friends.length;
                index += cardGridColumns
            ) {
                const topGap = showHeader && index === 0 ? sectionHeaderGap : 0;
                rows.push({
                    type: 'cards',
                    key: `cards:${section.key}:${index}`,
                    height: cardRowHeight + topGap,
                    topGap,
                    section,
                    friends: friends.slice(index, index + cardGridColumns)
                });
            }
        }
        return rows;
    }, [cardGridColumns, cardRowHeight, sectionHeaderGap, visibleSections]);
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
        cardGridRowHeight,
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
