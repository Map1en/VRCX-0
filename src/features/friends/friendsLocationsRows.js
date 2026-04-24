import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';

const SENTINEL_LOCATION_VALUES = new Set([
    'offline',
    'offline:offline',
    'private',
    'private:private',
    'traveling',
    'traveling:traveling'
]);

export function normalizeFriendsLocationId(value) {
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

export function normalizeDisplayText(value) {
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

export function isSentinelLocationValue(value) {
    const normalizedValue = normalizeFriendsLocationId(value).toLowerCase();
    return SENTINEL_LOCATION_VALUES.has(normalizedValue);
}

export function resolveWorldIdCandidate(...values) {
    for (const value of values) {
        const normalizedValue = normalizeFriendsLocationId(value);
        if (normalizedValue && normalizedValue.startsWith('wrld_')) {
            return normalizedValue;
        }
    }
    return '';
}

export function isRawWorldReference(value) {
    return Boolean(resolveWorldIdCandidate(value));
}

export function resolveDisplayWorldName(...values) {
    for (const value of values) {
        const normalizedValue = normalizeDisplayText(value);
        if (normalizedValue && !isRawWorldReference(normalizedValue)) {
            return normalizedValue;
        }
    }
    return '';
}

export function resolveFriendWorldName(friend) {
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

export function resolveFriendTravelingWorldName(friend) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return resolveDisplayWorldName(
        source?.travelingToWorld,
        source?.$travelingToWorld,
        resolveFriendWorldName(friend)
    );
}

export function resolveFriendTravelingWorldId(friend) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return resolveWorldIdCandidate(
        source?.travelingToWorld,
        source?.$travelingToWorld
    );
}

export function resolveFriendGroupName(friend) {
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

export function uniqueFriendsById(friends) {
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

export function resolvePresenceLocation(friend) {
    return resolveFriendPresenceLocation(friend);
}

export function resolveFriendsLocationsCurrentInviteLocation(
    gameState,
    currentUserSnapshot
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

export function isOnlineFriend(friend) {
    return Boolean(
        friend?.stateBucket === 'online' ||
        friend?.state === 'online' ||
        friend?.status === 'active' ||
        resolvePresenceLocation(friend)
    );
}

export function isShareableInstanceLocation(location) {
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

export function buildSameInstanceGroups(friends, lastLocation = null) {
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
        .filter(([, friendsInLocation]) => friendsInLocation.length > 1)
        .map(([location, friendsInLocation]) => ({
            location,
            friends: friendsInLocation
        }))
        .sort(
            (left, right) =>
                right.friends.length - left.friends.length ||
                left.location.localeCompare(right.location, undefined, {
                    sensitivity: 'base'
                })
        );
}

export function resolveLocationTarget(friend) {
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

export function resolveLocationSummary(friend) {
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    const travelingToLocation = [
        source?.travelingToLocation,
        source?.$travelingToLocation
    ]
        .map(normalizeFriendsLocationId)
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

export function resolveWorldDialogTarget(target) {
    const rawLocation = normalizeFriendsLocationId(target?.rawLocation);
    const worldId = normalizeFriendsLocationId(target?.worldId);
    const parsed = target?.parsed || parseLocation(rawLocation);
    if (parsed?.isRealInstance && parsed?.tag) {
        return parsed.tag;
    }
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    return resolveWorldIdCandidate(worldId, parsedWorldId, rawLocation);
}

function appendLabel(labelsByFriendId, friendId, label) {
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
    localFriendFavorites
}) {
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

        const label = `Local: ${groupName || 'Favorites'}`;
        for (const friendId of friendIds) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    return labelsByFriendId;
}

export function compareFavoriteGroups(left, right, order = []) {
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
    friend,
    favoriteGroupLabelsByFriendId,
    favoriteIds
) {
    const friendId = normalizeFriendsLocationId(friend?.id);
    if (!friendId) {
        return [];
    }

    const labels = favoriteGroupLabelsByFriendId.get(friendId) ?? [];
    if (labels.length > 0) {
        return labels;
    }

    return favoriteIds.has(friendId) ? ['Favorites'] : [];
}

export function resolveInstanceSectionDescriptor(friend) {
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

export function buildSameInstanceSections({
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

export function buildFriendSections({
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
