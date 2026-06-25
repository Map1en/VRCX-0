import { getFriendsSortFunction, sortStatus } from '@/shared/utils/friend';
import { isRealInstance } from '@/shared/utils/instance';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { getTrustColor } from '@/shared/utils/trustColors';
import { computeTrustLevel } from '@/shared/utils/userTransforms';

export function normalizeLocationStatus(value: any) {
    const normalized = normalizeId(value).toLowerCase();
    if (normalized === 'offline:offline') {
        return 'offline';
    }
    if (normalized === 'private:private') {
        return 'private';
    }
    if (normalized === 'traveling:traveling') {
        return 'traveling';
    }
    return normalized;
}

export function resolvePresenceLocation(profile: any) {
    return resolveFriendPresenceLocation(profile);
}

export function readFriendRef(friend: any) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

export function readFriendStatusSource(friend: any) {
    const ref = readFriendRef(friend);
    if (!ref || ref === friend) {
        return friend;
    }
    return {
        ...ref,
        ...friend,
        ref,
        pendingOffline: Boolean(friend?.pendingOffline || ref?.pendingOffline)
    };
}

export function readFriendRefLocation(friend: any) {
    const source = readFriendStatusSource(friend);
    return normalizeId(source?.location || source?.$location?.tag);
}

export function readFriendRefTravelingLocation(friend: any) {
    const source = readFriendStatusSource(friend);
    return normalizeId(
        source?.travelingToLocation || source?.$travelingToLocation
    );
}

export function timestampMsFromValue(value: any) {
    if (value === null || value === undefined || value === '') {
        return 0;
    }
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) {
        return numberValue;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function clearStaleOfflineLocation(location: any, state: any) {
    const normalizedState = normalizeLocationStatus(state);
    if (
        (normalizedState === 'online' || normalizedState === 'active') &&
        normalizeLocationStatus(location) === 'offline'
    ) {
        return '';
    }
    return location;
}

export function resolveCurrentInviteLocation(
    gameState: any,
    currentUserSnapshot: any
) {
    const currentLocation = normalizeId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeId(gameState?.currentDestination);
    }
    return (
        currentLocation ||
        normalizeId(gameState?.currentDestination) ||
        normalizeId(
            currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
        )
    );
}

export function buildFavoriteIdSet(
    remoteFavoriteIds: any,
    localFriendFavorites: any
) {
    const ids = new Set(
        (remoteFavoriteIds || []).map(normalizeId).filter(Boolean)
    );
    for (const values of Object.values(localFriendFavorites || {})) {
        if (!Array.isArray(values)) {
            continue;
        }
        for (const id of values || []) {
            const normalized = normalizeId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

export function resolveTrustNameColour(friend: any, trustColor: any) {
    if (!friend?.$trustClass && Array.isArray(friend?.tags)) {
        const trust = computeTrustLevel(
            friend.tags,
            friend.developerType || ''
        );
        return getTrustColor(
            {
                ...friend,
                $trustClass: trust.trustClass,
                $isModerator: trust.isModerator,
                $isTroll: trust.isTroll,
                $isProbableTroll: trust.isProbableTroll
            },
            trustColor
        );
    }
    return getTrustColor(friend, trustColor);
}

export function legacyStatusDotClassName(status: any) {
    const normalizedStatus = normalizeLocationStatus(status);
    if (normalizedStatus === 'active') {
        return 'bg-[var(--status-online)]';
    }
    if (normalizedStatus === 'join me' || normalizedStatus === 'joinme') {
        return 'bg-[var(--status-joinme)]';
    }
    if (normalizedStatus === 'ask me' || normalizedStatus === 'askme') {
        return 'bg-[var(--status-askme)]';
    }
    if (normalizedStatus === 'busy') {
        return 'bg-[var(--status-busy)]';
    }
    return '';
}

export function normalizeStateBucket(value: any) {
    const normalized = normalizeLocationStatus(value);
    return normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
        ? normalized
        : '';
}

export function resolveCurrentUserStateBucket(currentUser: any) {
    const explicitState =
        normalizeStateBucket(currentUser?.stateBucket) ||
        normalizeStateBucket(currentUser?.state);
    if (explicitState) {
        return explicitState;
    }
    if (
        normalizeLocationStatus(
            currentUser?.location || currentUser?.$location?.tag
        ) === 'offline'
    ) {
        return 'offline';
    }
    return 'online';
}

function activeStatusDotClassName(status: any) {
    const normalizedStatus = normalizeLocationStatus(status);
    if (normalizedStatus === 'join me' || normalizedStatus === 'joinme') {
        return 'border-[var(--status-joinme)] bg-background';
    }
    if (normalizedStatus === 'ask me' || normalizedStatus === 'askme') {
        return 'border-[var(--status-askme)] bg-background';
    }
    if (normalizedStatus === 'busy') {
        return 'border-[var(--status-busy)] bg-background';
    }
    return 'border-[var(--status-online)] bg-background';
}

function activeStatusSortValue(friend: any) {
    const source = readFriendStatusSource(friend);
    const normalizedStatus = normalizeLocationStatus(source?.status);
    if (
        normalizedStatus === 'join me' ||
        normalizedStatus === 'ask me' ||
        normalizedStatus === 'busy'
    ) {
        return normalizedStatus;
    }
    return 'active';
}

function compareByActiveStatus(left: any, right: any) {
    return sortStatus(
        activeStatusSortValue(left),
        activeStatusSortValue(right)
    );
}

export function resolveSidebarStatusDotClassName(
    friend: any,
    currentUser: any,
    isCurrentUser: any = false,
    { hideNonFriend = true, isGameRunning = true }: any = {}
) {
    const source = readFriendStatusSource(friend);
    if (!source) {
        return '';
    }
    const userId = normalizeId(source?.id || source?.userId);
    const status = normalizeLocationStatus(source?.status);
    const location = normalizeLocationStatus(
        source?.location || source?.$location?.tag
    );
    const isOnlineByCurrentSnapshot = (
        currentUser?.onlineFriends || []
    ).includes(userId);
    const isActiveByCurrentSnapshot = (
        currentUser?.activeFriends || []
    ).includes(userId);
    const isOfflineByCurrentSnapshot = (
        currentUser?.offlineFriends || []
    ).includes(userId);
    const snapshotState = isOnlineByCurrentSnapshot
        ? 'online'
        : isActiveByCurrentSnapshot
          ? 'active'
          : isOfflineByCurrentSnapshot
            ? 'offline'
            : '';
    const state = normalizeLocationStatus(
        source?.stateBucket || source?.state || snapshotState
    );
    const stateBucket = normalizeLocationStatus(
        source?.stateBucket || snapshotState
    );

    if (isCurrentUser || userId === currentUser?.id) {
        if (isGameRunning === true) {
            return (
                legacyStatusDotClassName(status) || 'bg-[var(--status-online)]'
            );
        }
        return activeStatusDotClassName(status);
    }

    if (source?.pendingOffline) {
        return 'bg-[var(--status-offline)]';
    }

    if (
        hideNonFriend &&
        source?.isFriend === false &&
        friend?.isFriend === false
    ) {
        return '';
    }

    if (state === 'offline' || stateBucket === 'offline') {
        return 'bg-[var(--status-offline)]';
    }

    if (
        status !== 'active' &&
        location === 'private' &&
        state === '' &&
        userId &&
        !isOnlineByCurrentSnapshot
    ) {
        return isActiveByCurrentSnapshot
            ? activeStatusDotClassName(status)
            : 'bg-[var(--status-offline)]';
    }
    if (state === 'active') {
        return activeStatusDotClassName(status);
    }
    if (location === 'offline' && state !== 'online') {
        return 'bg-[var(--status-offline)]';
    }
    if (status === 'active') {
        return 'bg-[var(--status-online)]';
    }
    if (status === 'join me' || status === 'joinme') {
        return 'bg-[var(--status-joinme)]';
    }
    if (status === 'ask me' || status === 'askme') {
        return 'bg-[var(--status-askme)]';
    }
    if (status === 'busy') {
        return 'bg-[var(--status-busy)]';
    }
    return '';
}

export function toLegacyFriendSortRow(friend: any) {
    const ref = readFriendRef(friend);
    return {
        ...friend,
        name:
            friend?.name ||
            friend?.displayName ||
            friend?.username ||
            friend?.id ||
            '',
        ref: ref && ref !== friend ? { ...ref, ...friend } : friend
    };
}

export function sortRows(rows: any, prefs: any) {
    const methods = [
        prefs.sidebarSortMethod1,
        prefs.sidebarSortMethod2,
        prefs.sidebarSortMethod3
    ].filter(Boolean);
    if (!methods.length) {
        return rows;
    }
    const sort = getFriendsSortFunction(methods);
    return [...rows].sort((left: any, right: any) =>
        sort(toLegacyFriendSortRow(left), toLegacyFriendSortRow(right))
    );
}

export function sortActiveRows(rows: any, prefs: any) {
    const sortedRows = sortRows(rows, prefs);
    return [...sortedRows].sort(compareByActiveStatus);
}

export function lastLocationHasFriend(lastLocation: any, friendId: any) {
    const normalizedFriendId = normalizeId(friendId);
    if (!normalizedFriendId) {
        return false;
    }
    const friendList = lastLocation?.friendList;
    if (friendList instanceof Set || friendList instanceof Map) {
        return friendList.has(normalizedFriendId);
    }
    if (Array.isArray(friendList)) {
        return friendList.includes(normalizedFriendId);
    }
    return Boolean(friendList?.[normalizedFriendId]);
}

export function sameInstanceLocationTag(friend: any, lastLocation: any) {
    const source = readFriendStatusSource(friend);
    if (
        normalizeLocationStatus(source?.stateBucket || source?.state) !==
        'online'
    ) {
        return '';
    }
    const parsedLocation =
        source?.$location && typeof source.$location === 'object'
            ? source.$location
            : parseLocation(source?.location);
    let locationTag = normalizeId(parsedLocation?.tag || source?.location);
    if (
        !parsedLocation?.isRealInstance &&
        lastLocationHasFriend(lastLocation, friend?.id)
    ) {
        locationTag = normalizeId(lastLocation?.location);
    }
    return isRealInstance(locationTag) ? locationTag : '';
}

export function readFriendInstanceEpoch(source: any, isTraveling: any) {
    const locationEpoch =
        source?.$location_at || source?.locationAt || source?.location_at;
    if (!isTraveling) {
        return locationEpoch;
    }
    return (
        source?.$travelingToTime ||
        source?.travelingToTime ||
        source?.traveling_to_time ||
        locationEpoch
    );
}

export function sameInstanceFallbackKey(locationTag: any, friend: any) {
    const friendId = normalizeId(friend?.id);
    return `${locationTag}:${friendId || normalizeId(readFriendRef(friend)?.id)}`;
}

export function withSameInstanceJoinTime(
    friend: any,
    locationTag: any,
    fallbackJoinTimes: any
) {
    const source = readFriendStatusSource(friend);
    if (timestampMsFromValue(readFriendInstanceEpoch(source, false))) {
        return friend;
    }
    const fallbackKey = sameInstanceFallbackKey(locationTag, friend);
    if (!fallbackJoinTimes.has(fallbackKey)) {
        fallbackJoinTimes.set(fallbackKey, Date.now());
    }
    const fallbackJoinTime = fallbackJoinTimes.get(fallbackKey);
    const ref = readFriendRef(friend);
    if (ref && ref !== friend) {
        return {
            ...friend,
            ref: {
                ...ref,
                $location_at: fallbackJoinTime
            }
        };
    }
    return {
        ...friend,
        $location_at: fallbackJoinTime
    };
}

export function buildSameInstanceGroups(
    rows: any,
    prefs: any,
    lastLocation: any,
    fallbackJoinTimes: any
) {
    const groupsByLocation = new Map();
    const activeFallbackKeys = new Set();
    for (const friend of sortRows(rows, prefs)) {
        const locationTag = sameInstanceLocationTag(friend, lastLocation);
        if (!locationTag) {
            continue;
        }
        if (!groupsByLocation.has(locationTag)) {
            groupsByLocation.set(locationTag, []);
        }
        const source = readFriendStatusSource(friend);
        const needsFallback = !timestampMsFromValue(
            readFriendInstanceEpoch(source, false)
        );
        groupsByLocation
            .get(locationTag)
            .push(
                withSameInstanceJoinTime(friend, locationTag, fallbackJoinTimes)
            );
        if (needsFallback) {
            activeFallbackKeys.add(
                sameInstanceFallbackKey(locationTag, friend)
            );
        }
    }
    for (const key of fallbackJoinTimes.keys()) {
        if (!activeFallbackKeys.has(key)) {
            fallbackJoinTimes.delete(key);
        }
    }
    return Array.from(groupsByLocation.entries())
        .filter(([, groupRows]: any) => groupRows.length > 1)
        .sort((left: any, right: any) => right[1].length - left[1].length)
        .map(([location, groupRows]: any) => ({ location, rows: groupRows }));
}
