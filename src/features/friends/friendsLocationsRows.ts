import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';

const SENTINEL_LOCATION_VALUES = new Set([
    'offline',
    'offline:offline',
    'private',
    'private:private',
    'traveling',
    'traveling:traveling'
]);

export function normalizeFriendsLocationId(value: any) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return String(value ?? '').trim();
    }

    const tag = normalizeFriendsLocationId(
        value.tag || value.location || value.$location?.tag
    );
    if (tag) {
        return tag;
    }
    const id = normalizeFriendsLocationId(
        value.id || value.userId || value.shortCode
    );
    if (id) {
        return id;
    }
    const worldId = normalizeFriendsLocationId(
        value.worldId || value.world_id || value.$location?.worldId
    );
    const instanceId = normalizeFriendsLocationId(
        value.instanceId || value.instance_id || value.$location?.instanceId
    );
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    if (value.isOffline) {
        return 'offline';
    }
    if (value.isPrivate) {
        return 'private';
    }
    if (value.isTraveling) {
        return 'traveling';
    }
    return '';
}

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

export function normalizeDisplayText(value: any) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return String(value ?? '').trim();
    }
    return normalizeDisplayText(
        value.name ||
            value.displayName ||
            value.worldName ||
            value.groupName ||
            value.shortCode ||
            value.$location?.worldName ||
            value.$location?.groupName
    );
}

export function isSentinelLocationValue(value: any) {
    const normalizedValue = normalizeFriendsLocationId(value).toLowerCase();
    return SENTINEL_LOCATION_VALUES.has(normalizedValue);
}

export function resolveWorldIdCandidate(...values: any[]) {
    for (const value of values) {
        const normalizedValue = normalizeFriendsLocationId(value);
        if (normalizedValue && normalizedValue.startsWith('wrld_')) {
            return normalizedValue;
        }
    }
    return '';
}

export function isRawWorldReference(value: any) {
    return Boolean(resolveWorldIdCandidate(value));
}

export function resolveDisplayWorldName(...values: any[]) {
    for (const value of values) {
        const normalizedValue = normalizeDisplayText(value);
        if (normalizedValue && !isRawWorldReference(normalizedValue)) {
            return normalizedValue;
        }
    }
    return '';
}

export function resolveFriendWorldName(friend: any) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return resolveDisplayWorldName(
        source?.worldName,
        source?.$worldName,
        source?.$location?.worldName,
        source?.$location?.name,
        source?.$location?.world?.name,
        source?.world?.name,
        source?.locationName
    );
}

export function resolveFriendTravelingWorldName(friend: any) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return resolveDisplayWorldName(
        source?.travelingToWorld,
        source?.$travelingToWorld,
        resolveFriendWorldName(friend)
    );
}

export function resolveFriendTravelingWorldId(friend: any) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return resolveWorldIdCandidate(
        source?.travelingToWorld,
        source?.$travelingToWorld
    );
}

export function resolveFriendGroupName(friend: any) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return normalizeDisplayText(
        source?.groupName ||
            source?.$groupName ||
            source?.$location?.groupName ||
            source?.$location?.group?.name ||
            source?.$location?.group?.displayName ||
            source?.group?.name ||
            source?.group?.displayName
    );
}

export function uniqueFriendsById(friends: any) {
    const seen = new Set();
    const rows = [];
    for (const friend of friends ?? []) {
        const id = normalizeFriendsLocationId(friend?.id || friend?.userId);
        if (!id) {
            rows.push(friend);
            continue;
        }
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        rows.push(friend);
    }
    return rows;
}

export function resolvePresenceLocation(friend: any) {
    return resolveFriendPresenceLocation(friend);
}

export function resolveFriendsLocationsCurrentInviteLocation(
    gameState: any,
    currentUserSnapshot: any
) {
    const currentLocation = normalizeFriendsLocationId(
        gameState?.currentLocation
    );
    if (currentLocation === 'traveling') {
        return normalizeFriendsLocationId(gameState?.currentDestination);
    }

    return (
        currentLocation ||
        normalizeFriendsLocationId(gameState?.currentDestination) ||
        normalizeFriendsLocationId(
            currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
        )
    );
}

export function isOnlineFriend(friend: any) {
    return Boolean(
        friend?.stateBucket === 'online' ||
            friend?.state === 'online'
    );
}

export function isShareableInstanceLocation(location: any) {
    const parsed = parseLocation(location);
    return Boolean(
        location &&
        parsed.worldId &&
        parsed.instanceId &&
        !parsed.isOffline &&
        !parsed.isPrivate &&
        !parsed.isTraveling
    );
}

export function buildSameInstanceGroups(friends: any, lastLocation: any = null) {
    const groupsByLocation = new Map();

    for (const friend of friends ?? []) {
        const location = resolveFriendPresenceLocation(friend, {
            requireInstance: true,
            lastLocation
        });
        if (!isShareableInstanceLocation(location)) {
            continue;
        }
        if (!groupsByLocation.has(location)) {
            groupsByLocation.set(location, []);
        }
        groupsByLocation.get(location).push(friend);
    }

    return Array.from(groupsByLocation.entries())
        .filter(([, friendsInLocation]: any) => friendsInLocation.length > 1)
        .map(([location, friendsInLocation]: any) => ({
            location,
            friends: friendsInLocation
        }))
        .sort(
            (left: any, right: any) =>
                right.friends.length - left.friends.length ||
                left.location.localeCompare(right.location, undefined, {
                    sensitivity: 'base'
                })
        );
}

export function resolveLocationTarget(friend: any) {
    const rawLocation = resolvePresenceLocation(friend);
    const parsed = parseLocation(rawLocation);
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    const travelingWorldId = parsed.isTraveling
        ? resolveFriendTravelingWorldId(friend)
        : '';
    const explicitWorldId = resolveWorldIdCandidate(friend?.worldId);
    const worldId =
        !rawLocation || parsed.isOffline || parsed.isPrivate
            ? ''
            : parsedWorldId || travelingWorldId || explicitWorldId;

    return {
        rawLocation,
        parsed,
        worldId,
        groupId: parsed.groupId || '',
        instanceId: parsed.instanceId || '',
        accessTypeName: parsed.accessTypeName || '',
        isOffline: !rawLocation || parsed.isOffline,
        isPrivate: parsed.isPrivate,
        isTraveling: parsed.isTraveling
    };
}

export function resolveLocationSummary(friend: any, t: any = null) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    const travelingToLocation = [
        source?.travelingToLocation,
        source?.$travelingToLocation
    ]
        .map(normalizeFriendsLocationId)
        .find((value: any) => value && !isSentinelLocationValue(value));
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
            label: localized(t, 'location.offline', 'Offline'),
            meta: ''
        };
    }

    if (parsedLocation.isPrivate) {
        return {
            label: localized(t, 'location.private', 'Private'),
            meta: ''
        };
    }

    if (parsedLocation.isTraveling) {
        return {
            label: localized(t, 'location.traveling', 'Traveling'),
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

export function resolveWorldDialogTarget(target: any) {
    const rawLocation = normalizeFriendsLocationId(target?.rawLocation);
    const worldId = normalizeFriendsLocationId(target?.worldId);
    const parsed = target?.parsed || parseLocation(rawLocation);
    if (parsed?.isRealInstance && parsed?.tag) {
        return parsed.tag;
    }
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    return resolveWorldIdCandidate(worldId, parsedWorldId, rawLocation);
}

function appendLabel(labelsByFriendId: any, friendId: any, label: any) {
    const normalizedFriendId = normalizeFriendsLocationId(friendId);
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
        const groupKey = normalizeFriendsLocationId(group?.key);
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

export function compareFavoriteGroups(left: any, right: any, order: any[] = []) {
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

export function resolveFavoriteGroupLabels(
    friend: any,
    favoriteGroupLabelsByFriendId: any,
    favoriteIds: any,
    t: any = null
) {
    const friendId = normalizeFriendsLocationId(friend?.id);
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

export function resolveInstanceSectionDescriptor(friend: any, t: any = null) {
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
