import { useMemo } from 'react';

import { checkCanInvite } from '@/shared/utils/invite.js';

import { FRIENDS_LOCATIONS_SEGMENTS as SEGMENTS } from './friendsLocationsConfig.js';
import {
    buildSameInstanceGroups,
    normalizeFriendsLocationId as normalizeId,
    resolveFriendsLocationsCurrentInviteLocation as resolveCurrentInviteLocation,
    uniqueFriendsById
} from './friendsLocationsRows.js';
import {
    buildFriendsLocationsFavoriteIdSet as buildFavoriteIdSet,
    matchesFriendLocationSearch as matchesSearch
} from './friendsLocationsSearch.js';
import {
    buildFavoriteGroupLabelsByFriendId,
    buildFriendSections,
    buildSameInstanceSections,
    compareFavoriteGroups,
    sortFriendsBySidebarPrefs
} from './friendsLocationsSections.js';

export function useFriendsLocationsPageDerivedState({
    activeIds,
    activeSegment,
    cardScale,
    collapsedFavoriteGroups,
    currentUserId,
    currentUserSnapshot,
    deferredSearchQuery,
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
    showSameInstance,
    sidebarFavoritePrefs,
    sidebarSortMethods,
    spacingScale
}) {
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
        favoriteIds,
        friendsMap,
        hasVisibleSections,
        isLoading,
        positionedRows,
        segmentOptions,
        visibleVirtualRows
    };
}
