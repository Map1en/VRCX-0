import { isRealInstance } from './instance';
import {
    displayLocation,
    parseLocation,
    type ParsedLocation,
    resolveRegion,
    translateAccessType
} from './locationParser';

export { parseLocation, displayLocation, resolveRegion, translateAccessType };

type LocationRecord = Record<string, unknown> & {
    $location?: Record<string, unknown>;
    ref?: LocationRecord;
};

interface LastLocation {
    friendList?:
        | Set<string>
        | Map<string, unknown>
        | string[]
        | Record<string, unknown>;
    location?: unknown;
}

interface ResolveFriendPresenceOptions {
    preferTraveling?: boolean;
    requireInstance?: boolean;
    lastLocation?: LastLocation | null;
}

interface LocationTextOptions {
    hint?: string;
    worldName?: string;
    accessTypeLabel: string;
    t: (key: string) => string;
}

function normalizeLocationValue(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return String(value ?? '').trim();
    }
    const location = value as LocationRecord;

    const tag = normalizeLocationValue(
        location.tag || location.location || location.$location?.tag
    );
    if (tag) {
        return tag;
    }
    const worldId = normalizeLocationValue(
        location.worldId || location.world_id || location.$location?.worldId
    );
    const instanceId = normalizeLocationValue(
        location.instanceId ||
            location.instance_id ||
            location.id ||
            location.$location?.instanceId
    );
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    if (location.isOffline) {
        return 'offline';
    }
    if (location.isPrivate) {
        return 'private';
    }
    if (location.isTraveling) {
        return 'traveling';
    }
    return '';
}

export { normalizeLocationValue };

function getObject(value: unknown): LocationRecord | null {
    return value && typeof value === 'object'
        ? (value as LocationRecord)
        : null;
}

function getFriendLocationValues(
    friend: unknown,
    field: 'location' | 'traveling'
): unknown[] {
    const direct = getObject(friend);
    const ref = getObject(direct?.ref);
    if (field === 'traveling') {
        if (ref) {
            return [ref.travelingToLocation, ref.$travelingToLocation];
        }
        return [direct?.travelingToLocation, direct?.$travelingToLocation];
    }
    if (ref) {
        return [ref.location, ref.$location?.tag, ref.$locationTag];
    }
    return [direct?.location, direct?.$location?.tag, direct?.$locationTag];
}

function isSentinelLocationValue(value: unknown): boolean {
    const normalized = normalizeLocationValue(value).toLowerCase();
    return (
        normalized === 'offline' ||
        normalized === 'offline:offline' ||
        normalized === 'private' ||
        normalized === 'private:private' ||
        normalized === 'traveling' ||
        normalized === 'traveling:traveling'
    );
}

function normalizeSentinelLocationValue(value: unknown): string {
    const normalized = normalizeLocationValue(value).toLowerCase();
    return isSentinelLocationValue(normalized) ? normalized.split(':')[0] : '';
}

function resolveCurrentFriendLocationValue(friend: unknown): string {
    const direct = getObject(friend);
    const ref = getObject(direct?.ref);
    const values = ref ? [ref.location] : [direct?.location];
    for (const value of values) {
        const normalized = normalizeLocationValue(value);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function resolveCurrentFriendLocationSentinel(friend: unknown): string {
    return normalizeSentinelLocationValue(
        resolveCurrentFriendLocationValue(friend)
    );
}

function getFriendId(friend: unknown): string {
    const direct = getObject(friend);
    const ref = getObject(direct?.ref);
    return normalizeLocationValue(
        direct?.id || direct?.userId || ref?.id || ref?.userId
    );
}

function isConcreteInstanceLocation(location: unknown): boolean {
    const normalized = normalizeLocationValue(location);
    if (!isRealInstance(normalized)) {
        return false;
    }
    const parsed = parseLocation(normalized);
    return Boolean(parsed.worldId && parsed.instanceId);
}

function isLastLocationFriend(
    lastLocation: LastLocation | null | undefined,
    friend: unknown
): boolean {
    const friendId = getFriendId(friend);
    if (!friendId) {
        return false;
    }
    const friendList = lastLocation?.friendList;
    if (friendList instanceof Set) {
        return friendList.has(friendId);
    }
    if (friendList instanceof Map) {
        return friendList.has(friendId);
    }
    if (Array.isArray(friendList)) {
        return friendList.includes(friendId);
    }
    if (friendList && typeof friendList === 'object') {
        return Boolean(friendList[friendId]);
    }
    return false;
}

function resolveFriendPresenceLocation(
    friend: unknown,
    {
        preferTraveling = true,
        requireInstance = false,
        lastLocation = null
    }: ResolveFriendPresenceOptions = {}
): string {
    const currentLocation = resolveCurrentFriendLocationValue(friend);
    const currentSentinel = resolveCurrentFriendLocationSentinel(friend);
    if (currentSentinel === 'offline' || currentSentinel === 'private') {
        return requireInstance ? '' : currentSentinel;
    }

    const currentLocationIsConcrete =
        isConcreteInstanceLocation(currentLocation);
    const canUseLegacyLocationFields =
        currentLocationIsConcrete || currentSentinel === 'traveling';
    const orderedFields: Array<'location' | 'traveling'> =
        preferTraveling && currentSentinel === 'traveling'
            ? ['traveling', 'location']
            : ['location', 'traveling'];
    for (const field of orderedFields) {
        if (field === 'location' && currentSentinel === 'traveling') {
            continue;
        }
        const values =
            field === 'location' && !canUseLegacyLocationFields
                ? [currentLocation]
                : getFriendLocationValues(friend, field);
        for (const value of values) {
            const normalized = normalizeLocationValue(value);
            if (!normalized || !isRealInstance(normalized)) {
                continue;
            }
            if (requireInstance && !isConcreteInstanceLocation(normalized)) {
                continue;
            }
            return normalized;
        }
    }
    if (currentSentinel === 'traveling') {
        return requireInstance ? '' : 'traveling';
    }
    const lastLocationValue = currentLocationIsConcrete
        ? normalizeLocationValue(lastLocation?.location)
        : '';
    if (lastLocationValue && isLastLocationFriend(lastLocation, friend)) {
        if (!requireInstance || isConcreteInstanceLocation(lastLocationValue)) {
            return lastLocationValue;
        }
    }
    return '';
}

/**
 *
 * @param {Array} friendsArr
 * @param {object} lastLocation - last location from location store
 * @param {Set} lastLocation.friendList
 * @param {string} lastLocation.location
 */
function getFriendsLocations(
    friendsArr: unknown[],
    lastLocation?: LastLocation | null
): string {
    if (!friendsArr?.length) {
        return '';
    }
    for (const friend of friendsArr) {
        for (const value of getFriendLocationValues(friend, 'location')) {
            const location = normalizeLocationValue(value);
            if (isRealInstance(location)) {
                return location;
            }
        }
    }
    for (const friend of friendsArr) {
        for (const value of getFriendLocationValues(friend, 'traveling')) {
            const location = normalizeLocationValue(value);
            if (isRealInstance(location)) {
                return location;
            }
        }
    }
    if (lastLocation) {
        for (const friend of friendsArr) {
            if (isLastLocationFriend(lastLocation, friend)) {
                return normalizeLocationValue(lastLocation.location);
            }
        }
    }
    return resolveCurrentFriendLocationValue(friendsArr[0]);
}

export { getFriendsLocations, resolveFriendPresenceLocation };

/**
 * Get the display text for a location — synchronous, pure function.
 * Does NOT handle async world name lookups (those stay in the component).
 * @param {object} L - Parsed location object from parseLocation()
 * @param {object} options
 * @param {string} [options.hint] - Hint string (e.g. from props)
 * @param {string|undefined} [options.worldName] - Cached world name, if available
 * @param {string} options.accessTypeLabel - Translated access type label
 * @param {Function} options.t - i18n translate function
 * @returns {string} Display text for the location
 */
function getLocationText(
    L: ParsedLocation,
    { hint, worldName, accessTypeLabel, t }: LocationTextOptions
): string {
    if (L.isOffline) {
        return t('location.offline');
    }
    if (L.isPrivate) {
        return t('location.private');
    }
    if (L.isTraveling) {
        return t('location.traveling');
    }
    if (typeof hint === 'string' && hint !== '') {
        return L.instanceId ? `${hint} · ${accessTypeLabel}` : hint;
    }
    if (L.worldId) {
        const name = worldName || L.worldId;
        return L.instanceId ? `${name} · ${accessTypeLabel}` : name;
    }
    return '';
}

export { getLocationText };
