import { parseLocation } from '@/shared/utils/locationParser.js';

export function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeLocation(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && normalized !== 'offline' && normalized !== 'private'
        ? normalized
        : '';
}

export function userGroupLocation(user) {
    const location = normalizeLocation(user?.location);
    if (location === 'traveling') {
        return normalizeLocation(user?.travelingToLocation);
    }
    return location;
}

export function instanceLocation(instance) {
    const directLocation = normalizeLocation(
        instance?.location || instance?.tag || instance?.$location?.tag
    );
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance?.worldId || instance?.world?.id || '';
    const instanceId =
        instance?.instanceId || instance?.id || instance?.name || '';
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

export function mergeGroupInstances(
    baseInstances,
    { groupId, friendsById, currentUserSnapshot, currentLocation }
) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const currentLocationKey = normalizeLocation(currentLocation);
    const byLocation = new Map();

    function ensureInstance(location, seed = {}) {
        const normalizedLocation = normalizeLocation(location);
        if (!normalizedLocation) {
            return null;
        }
        const parsed = parseLocation(normalizedLocation);
        const existing = byLocation.get(normalizedLocation);
        if (existing) {
            existing.worldId =
                seed.worldId ||
                seed.world?.id ||
                parsed.worldId ||
                existing.worldId ||
                '';
            existing.instanceId =
                seed.instanceId ||
                seed.id ||
                parsed.instanceId ||
                existing.instanceId ||
                '';
            existing.ref = seed.ref || existing.ref || seed;
            return Object.assign(existing, seed, {
                location: normalizedLocation,
                tag: normalizedLocation,
                users: existing.users,
                friendCount: existing.friendCount
            });
        }

        const row = {
            ...seed,
            id:
                seed.instanceId ||
                seed.id ||
                parsed.instanceId ||
                normalizedLocation,
            location: normalizedLocation,
            tag: normalizedLocation,
            worldId: seed.worldId || seed.world?.id || parsed.worldId || '',
            instanceId: seed.instanceId || seed.id || parsed.instanceId || '',
            users: Array.isArray(seed.users) ? [...seed.users] : [],
            friendCount: Number(seed.friendCount || seed.userCount || 0) || 0,
            ref: seed.ref || seed
        };
        byLocation.set(normalizedLocation, row);
        return row;
    }

    for (const instance of Array.isArray(baseInstances) ? baseInstances : []) {
        ensureInstance(instanceLocation(instance), instance);
    }

    function addUser(user, isFriend = false) {
        const location = userGroupLocation(user);
        if (!location) {
            return;
        }
        const parsed = parseLocation(location);
        if (normalizedGroupId && parsed.groupId !== normalizedGroupId) {
            return;
        }
        const row = ensureInstance(location);
        const userId = normalizeEntityId(user?.id || user?.userId);
        if (
            !row ||
            !userId ||
            row.users.some(
                (existing) =>
                    normalizeEntityId(existing?.id || existing?.userId) ===
                    userId
            )
        ) {
            return;
        }
        row.users.push(user);
        if (isFriend) {
            row.friendCount = Math.max(row.friendCount || 0, row.users.length);
        }
    }

    Object.values(friendsById || {}).forEach((friend) => addUser(friend, true));
    if (currentUserSnapshot) {
        addUser(currentUserSnapshot, false);
    }

    return Array.from(byLocation.values())
        .map((row) => ({
            ...row,
            friendCount: row.friendCount || row.users.length,
            users: [...row.users].sort((left, right) =>
                String(left?.displayName || left?.id || '').localeCompare(
                    String(right?.displayName || right?.id || '')
                )
            )
        }))
        .sort((left, right) => {
            if (currentLocationKey && left.location === currentLocationKey) {
                return -1;
            }
            if (currentLocationKey && right.location === currentLocationKey) {
                return 1;
            }
            return (
                (right.users.length || right.ref?.userCount || 0) -
                (left.users.length || left.ref?.userCount || 0)
            );
        });
}
