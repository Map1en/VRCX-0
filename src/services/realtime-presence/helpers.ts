import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';

const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeStateBucket(value: unknown) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (
        normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
    ) {
        return normalized;
    }
    return '';
}

function resolveStateBucketFromEvent(
    content: Record<string, any>,
    patch: Record<string, any>,
    previous: Record<string, any>,
    fallback = 'offline'
) {
    return (
        normalizeStateBucket(content?.stateBucket) ||
        normalizeStateBucket(content?.state) ||
        normalizeStateBucket(content?.user?.stateBucket) ||
        normalizeStateBucket(content?.user?.state) ||
        normalizeStateBucket(patch?.stateBucket) ||
        normalizeStateBucket(patch?.state) ||
        normalizeStateBucket(previous?.stateBucket) ||
        normalizeStateBucket(previous?.state) ||
        fallback
    );
}

function hasEventStateBucket(content: Record<string, any>) {
    return Boolean(
        normalizeStateBucket(content?.stateBucket) ||
        normalizeStateBucket(content?.state) ||
        normalizeStateBucket(content?.user?.stateBucket) ||
        normalizeStateBucket(content?.user?.state)
    );
}

function isUserIdLike(value: unknown) {
    const normalized = normalizeUserId(value);
    return normalized.startsWith('usr_');
}

function getDisplayName(user: Record<string, any> | null, userId = '') {
    const normalizedUserId = normalizeUserId(userId || user?.id);
    const candidates = [user?.displayName, user?.username];

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeUserId(candidate);
        if (
            normalizedCandidate &&
            normalizedCandidate !== normalizedUserId &&
            normalizedCandidate !== UNKNOWN_FEED_USER_DISPLAY_NAME &&
            !isUserIdLike(normalizedCandidate)
        ) {
            return normalizedCandidate;
        }
    }

    return '';
}

function resolveFeedDisplayName(userId: unknown, patch: Record<string, any> = {}, previous: Record<string, any> = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const rosterFriend = normalizedUserId
        ? useFriendRosterStore.getState().friendsById[normalizedUserId]
        : null;
    return (
        getDisplayName(patch, normalizedUserId) ||
        getDisplayName(previous, normalizedUserId) ||
        getDisplayName(rosterFriend, normalizedUserId) ||
        UNKNOWN_FEED_USER_DISPLAY_NAME
    );
}

function sanitizeTransportUser(user: unknown, { preserveState = false } = {}) {
    if (!user || typeof user !== 'object') {
        return null;
    }

    const sanitized = { ...(user as Record<string, any>) };
    if (!preserveState) {
        delete sanitized.state;
    }
    return sanitized;
}

function removeFromArray(list: unknown, userId: unknown) {
    if (!Array.isArray(list) || !userId) {
        return [];
    }

    return list.filter((value) => normalizeUserId(value) !== userId);
}

function ensureArrayMembership(list: unknown, userId: unknown) {
    if (!userId) {
        return Array.isArray(list) ? list : [];
    }

    const values = Array.isArray(list) ? removeFromArray(list, userId) : [];
    values.push(userId);
    return values;
}

function getCurrentUserSnapshot(runtimeStore: Record<string, any>) {
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

function setCurrentUserSnapshot(runtimeStore: Record<string, any>, snapshot: Record<string, any>) {
    runtimeStore.setAuthBootstrap({
        currentUserDisplayName: getDisplayName(snapshot),
        currentUserSnapshot: snapshot
    });
}

function firstString(...values: unknown[]) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

function buildLocationPatch(
    location: unknown,
    travelingToLocation: unknown,
    worldId: unknown,
    fallback: Record<string, any> = {}
) {
    const normalizedLocation = firstString(
        location,
        fallback.location,
        fallback.$location?.tag
    );
    const normalizedTraveling = firstString(
        travelingToLocation,
        fallback.travelingToLocation,
        fallback.$travelingToLocation?.tag
    );
    const parsedLocation = parseLocation(normalizedLocation);
    const parsedTraveling = parseLocation(normalizedTraveling);

    return {
        location: normalizedLocation,
        worldId: firstString(worldId, parsedLocation.worldId, fallback.worldId),
        instanceId: parsedLocation.instanceId || '',
        travelingToLocation: normalizedTraveling,
        travelingToWorld: parsedTraveling.worldId || '',
        travelingToInstance: parsedTraveling.instanceId || '',
        $location: parsedLocation,
        $travelingToLocation: parsedTraveling
    };
}

function onlinePresenceFallback(previous: Record<string, any>) {
    const location = firstString(
        previous?.location,
        previous?.$location?.tag
    ).toLowerCase();
    if (!location || location === 'offline' || location === 'offline:offline') {
        return {};
    }
    return previous;
}

function isRealLocation(location: unknown) {
    const value = typeof location === 'string' ? location.trim() : '';
    return Boolean(
        value &&
        value !== 'offline' &&
        value !== 'offline:offline' &&
        value !== 'traveling' &&
        value !== 'private'
    );
}

function isTravelingLocation(location: unknown) {
    return (
        typeof location === 'string' &&
        location.trim().toLowerCase() === 'traveling'
    );
}

function isOnlineState(row: Record<string, any> | null | undefined) {
    return normalizeStateBucket(row?.stateBucket || row?.state) === 'online';
}

function resolveLocationName(location: string, patch: Record<string, any> = {}, previous: Record<string, any> = {}) {
    const parsed = parseLocation(location || '');
    return {
        worldName:
            patch.worldName ||
            patch.world?.name ||
            previous.worldName ||
            parsed.worldId ||
            location ||
            '',
        groupName: patch.groupName || previous.groupName || parsed.groupId || ''
    };
}

function resolveDuration(previous: Record<string, any>) {
    const timestamp = Number(
        previous?.locationUpdatedAt || previous?.$location_at || 0
    );
    return timestamp > 0 ? Date.now() - timestamp : '';
}

function resolveGpsPreviousLocation(previous: Record<string, any> = {}) {
    const previousLocation =
        typeof previous?.location === 'string' ? previous.location.trim() : '';
    if (isTravelingLocation(previousLocation)) {
        return firstString(previous.$previousLocation);
    }
    return previousLocation;
}

function resolveGpsDuration(previous: Record<string, any> = {}) {
    if (isTravelingLocation(previous?.location)) {
        const previousLocationTimestamp = Number(
            previous?.$previousLocation_at || 0
        );
        return previousLocationTimestamp > 0
            ? Date.now() - previousLocationTimestamp
            : '';
    }
    return resolveDuration(previous);
}

function buildLocationMetadataPatch(location: unknown, previous: Record<string, any> = {}, timestamp: number) {
    if (isTravelingLocation(location)) {
        if (isTravelingLocation(previous?.location)) {
            return {};
        }
        const previousLocation = firstString(
            previous?.location,
            previous?.$location?.tag
        );
        const previousLocationTimestamp =
            previous?.locationUpdatedAt || previous?.$location_at || 0;
        const metadata: Record<string, any> = {
            locationUpdatedAt: timestamp,
            $location_at: timestamp,
            $travelingToTime: timestamp,
            travelingToTime: timestamp
        };
        if (isRealLocation(previousLocation)) {
            metadata.$previousLocation = previousLocation;
            metadata.$previousLocation_at = previousLocationTimestamp;
        }
        return metadata;
    }

    const previousTravelLocation = firstString(previous?.$previousLocation);
    const previousLocationTimestamp = Number(
        previous?.$previousLocation_at || 0
    );
    const returnedToPreviousLocation =
        previousTravelLocation && previousTravelLocation === location;
    const locationTimestamp =
        returnedToPreviousLocation && previousLocationTimestamp > 0
            ? previousLocationTimestamp
            : timestamp;

    return {
        locationUpdatedAt: locationTimestamp,
        $location_at: locationTimestamp,
        $previousLocation: '',
        $previousLocation_at: '',
        $travelingToTime: '',
        travelingToTime: ''
    };
}

function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string');
    }
    if (typeof value !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((entry) => typeof entry === 'string')
            : [];
    } catch {
        return [];
    }
}

export {
    buildLocationMetadataPatch,
    buildLocationPatch,
    ensureArrayMembership,
    firstString,
    getCurrentUserSnapshot,
    getDisplayName,
    hasEventStateBucket,
    isOnlineState,
    isRealLocation,
    normalizeStateBucket,
    normalizeUserId,
    onlinePresenceFallback,
    parseStringArray,
    removeFromArray,
    resolveDuration,
    resolveFeedDisplayName,
    resolveGpsDuration,
    resolveGpsPreviousLocation,
    resolveLocationName,
    resolveStateBucketFromEvent,
    sanitizeTransportUser,
    setCurrentUserSnapshot
};
