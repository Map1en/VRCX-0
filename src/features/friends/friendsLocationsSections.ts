import { getFriendsSortFunction, sortStatus } from '@/shared/utils/friend';

import {
    normalizeFriendsLocationId as normalizeId,
    resolveLocationSummary,
    resolveLocationTarget
} from './friendsLocationsRows';

function interpolateFallback(value: any, values: any = {}) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (match: any, key: any) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
    );
}

function localized(t: any, key: any, fallback: any, values: any = {}) {
    if (typeof t !== 'function') {
        return interpolateFallback(fallback, values);
    }

    return interpolateFallback(
        t(key, { defaultValue: fallback, ...values }),
        values
    );
}

function appendLabel(labelsByFriendId: any, friendId: any, label: any) {
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

export function buildFavoriteGroupLabelsByFriendId({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavorites,
    t
}: any) {
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

        const label = localized(
            t,
            'view.friends_locations.local_group',
            'Local: {name}',
            {
                name:
                    groupName ||
                    localized(t, 'view.friends_locations.favorite', 'Favorites')
            }
        );
        for (const friendId of friendIds) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    return labelsByFriendId;
}

export function compareFavoriteGroups(
    left: any,
    right: any,
    order: any[] = []
) {
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

function readFriendRef(friend: any) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

function readFriendStatusSource(friend: any) {
    const ref = readFriendRef(friend);
    if (!ref || ref === friend) {
        return friend;
    }
    return {
        ...friend,
        ...ref
    };
}

function normalizeStatusText(value: any) {
    const status =
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : String(value ?? '')
                  .trim()
                  .toLowerCase();
    if (status === 'joinme') {
        return 'join me';
    }
    if (status === 'askme') {
        return 'ask me';
    }
    return status;
}

function activeStatusSortValue(friend: any) {
    const source = readFriendStatusSource(friend);
    const status = normalizeStatusText(source?.status);
    if (status === 'join me' || status === 'ask me' || status === 'busy') {
        return status;
    }
    return 'active';
}

function compareByActiveStatus(left: any, right: any) {
    return sortStatus(
        activeStatusSortValue(left),
        activeStatusSortValue(right)
    );
}

function toLegacyFriendSortRow(friend: any) {
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

export function sortFriendsBySidebarPrefs(friends: any, sortMethods: any) {
    const methods = (sortMethods ?? []).filter(Boolean);
    if (!methods.length) {
        return friends;
    }

    const sort = getFriendsSortFunction(methods);
    return [...friends].sort((left: any, right: any) =>
        sort(toLegacyFriendSortRow(left), toLegacyFriendSortRow(right))
    );
}

export function sortActiveFriendsBySidebarPrefs(
    friends: any,
    sortMethods: any
) {
    return [...sortFriendsBySidebarPrefs(friends, sortMethods)].sort(
        compareByActiveStatus
    );
}

function resolveFavoriteGroupLabels(
    friend: any,
    favoriteGroupLabelsByFriendId: any,
    favoriteIds: any,
    t: any
) {
    const friendId = normalizeId(friend?.id);
    if (!friendId) {
        return [];
    }

    const labels = favoriteGroupLabelsByFriendId.get(friendId) ?? [];
    if (labels.length > 0) {
        return labels;
    }

    return favoriteIds.has(friendId)
        ? [localized(t, 'view.friends_locations.favorite', 'Favorites')]
        : [];
}

function resolveInstanceSectionDescriptor(friend: any, t: any) {
    const target = resolveLocationTarget(friend);
    const summary = resolveLocationSummary(friend, t);
    const descriptor: any = {
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
            title: localized(t, 'location.offline', 'Offline')
        };
    }

    if (target.isPrivate) {
        return {
            ...descriptor,
            key: `instance:private:${target.worldId || target.rawLocation || 'private'}`,
            title: localized(t, 'location.private', 'Private'),
            description: '',
            worldId: target.worldId,
            rawLocation: target.rawLocation
        };
    }

    if (target.isTraveling) {
        return {
            ...descriptor,
            key: `instance:traveling:${target.rawLocation || 'traveling'}`,
            title: localized(t, 'location.traveling', 'Traveling'),
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
            title:
                summary.label ||
                target.worldId ||
                localized(t, 'view.friend_list.label.world', 'World'),
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

export function buildSameInstanceSections({
    sameInstanceGroups,
    displayInstanceInfo = true,
    t
}: any) {
    return sameInstanceGroups
        .map(({ location, friends }: any) => {
            const descriptor = resolveInstanceSectionDescriptor(
                {
                    ...friends[0],
                    location,
                    travelingToLocation: ''
                },
                t
            );

            return {
                ...descriptor,
                key: `instance:${location}`,
                rawLocation: location,
                displayInstanceInfo,
                friends
            };
        })
        .filter((section: any) => section.friends.length > 0);
}

function upsertSection(sectionMap: any, descriptor: any, friend: any) {
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

export function buildFriendSections({
    friends,
    groupingMode,
    favoriteIds,
    favoriteGroupLabelsByFriendId,
    t
}: any) {
    if (groupingMode === 'flat') {
        return [
            {
                key: 'flat',
                title: localized(
                    t,
                    'view.friends_locations.all_matching_friends',
                    'All matching friends'
                ),
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
                favoriteIds,
                t
            );
            const label =
                labels.length > 0
                    ? labels.join(' / ')
                    : localized(
                          t,
                          'view.friends_locations.no_favorite_group',
                          'No favorite group'
                      );
            upsertSection(
                sectionsByKey,
                {
                    key: `favorite:${label}`,
                    title: label,
                    description:
                        labels.length > 0
                            ? localized(
                                  t,
                                  'view.friends_locations.favorite_group_segment',
                                  'Favorite group segment'
                              )
                            : localized(
                                  t,
                                  'view.friends_locations.friend_is_not_in_hydrated_favorite_group',
                                  'Friend is not in a hydrated favorite group.'
                              ),
                    worldId: '',
                    groupId: ''
                },
                friend
            );
            continue;
        }

        upsertSection(
            sectionsByKey,
            resolveInstanceSectionDescriptor(friend, t),
            friend
        );
    }

    return Array.from(sectionsByKey.values()).sort((left: any, right: any) => {
        if (
            left.key.startsWith('instance:offline') &&
            !right.key.startsWith('instance:offline')
        ) {
            return 1;
        }
        if (
            right.key.startsWith('instance:offline') &&
            !left.key.startsWith('instance:offline')
        ) {
            return -1;
        }
        return left.title.localeCompare(right.title, undefined, {
            sensitivity: 'base'
        });
    });
}
