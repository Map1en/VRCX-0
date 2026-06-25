import { parseLocation } from './location';

type ParsedInviteLocation = ReturnType<typeof parseLocation>;

export type InviteInstanceCache = Map<
    string,
    {
        closedAt?: unknown;
    }
>;

export interface CheckCanInviteDeps {
    currentUserId: string;
    lastLocationStr: string;
    cachedInstances?: InviteInstanceCache | null;
}

export interface CheckCanInviteSelfDeps {
    currentUserId: string;
    cachedInstances?: InviteInstanceCache | null;
    friends?: Map<string, unknown> | Set<string> | null;
}

function locationCacheKey(parsed: ParsedInviteLocation): string {
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function getCachedInstance(
    location: string,
    parsed: ParsedInviteLocation,
    cachedInstances?: InviteInstanceCache | null
) {
    if (!cachedInstances) {
        return null;
    }
    return (
        cachedInstances.get(location) ||
        cachedInstances.get(locationCacheKey(parsed)) ||
        null
    );
}

/**
 *
 * @param {string} location
 * @param {object} deps
 * @param {string} deps.currentUserId - current user's id
 * @param {string} deps.lastLocationStr - last location string from location store
 * @param {Map} deps.cachedInstances - instance cache map
 * @returns {boolean}
 */
function checkCanInvite(location: string, deps: CheckCanInviteDeps): boolean {
    if (!location) {
        return false;
    }
    const L = parseLocation(location);
    if (!L.isRealInstance || !L.worldId || !L.instanceId) {
        return false;
    }
    const instance = getCachedInstance(location, L, deps.cachedInstances);
    if (instance?.closedAt) {
        return false;
    }
    if (
        L.accessType === 'public' ||
        L.accessType === 'group' ||
        L.userId === deps.currentUserId
    ) {
        return true;
    }
    if (L.accessType === 'invite' || L.accessType === 'friends') {
        return false;
    }
    if (deps.lastLocationStr === location) {
        return true;
    }
    return false;
}

/**
 *
 * @param {string} location
 * @param {object} deps
 * @param {string} deps.currentUserId - current user's id
 * @param {Map} deps.cachedInstances - instance cache map
 * @param {Map} deps.friends - friends map
 * @returns {boolean}
 */
function checkCanInviteSelf(
    location: string,
    deps: CheckCanInviteSelfDeps
): boolean {
    if (!location) {
        return false;
    }
    const L = parseLocation(location);
    if (!L.isRealInstance || !L.worldId || !L.instanceId) {
        return false;
    }
    const instance = getCachedInstance(location, L, deps.cachedInstances);
    if (instance?.closedAt) {
        return false;
    }
    if (L.userId === deps.currentUserId) {
        return true;
    }
    if (L.accessType === 'invite' || L.accessType === 'invite+') {
        return false;
    }
    if (
        L.accessType === 'friends' &&
        (L.userId == null || !deps.friends?.has(L.userId))
    ) {
        return false;
    }
    return true;
}

export { checkCanInvite, checkCanInviteSelf };
