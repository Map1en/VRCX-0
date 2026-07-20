import {
    getFriendsSortFunction,
    sortStatus,
    type FriendSortItem,
    type FriendSortMethod
} from '@/shared/utils/friend';
import { isRealInstance } from '@/shared/utils/instance';
export { resolveCurrentInviteLocation } from '@/shared/utils/invite';
import type {
    FriendLocationProjection,
    FriendRecordInput
} from '@/domain/friends/friendRosterTypes';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { getTrustColor } from '@/shared/utils/trustColors';
import { computeTrustLevel } from '@/shared/utils/userTransforms';

export type SidebarFriendRecord = FriendRecordInput & {
    $friendNumber?: number;
    $lastSeen?: string | number;
    $location_at?: string | number | null;
    $online_for?: string | number;
    $userColour?: string;
    created_at?: string;
    developerType?: string;
    displayName?: string;
    id?: string;
    last_activity?: string | number;
    last_login?: string | number;
    location?: string;
    memberCount?: number;
    name?: string;
    state?: string;
    stateBucket?: string;
    status?: string | null;
    tags?: string[];
    updated_at?: string;
    username?: string;
    activeFriends?: unknown[];
    isFriend?: unknown;
    offlineFriends?: unknown[];
    onlineFriends?: unknown[];
    pendingOffline?: unknown;
    ref?: SidebarFriendRecord | null;
    statusDescription?: unknown;
    travelingToLocation?: unknown;
    traveling_to_time?: unknown;
    travelingToTime?: unknown;
};

export type SidebarPreferences = {
    gameLogDisabled?: boolean;
    isHideFriendsInSameInstance?: boolean;
    isSameInstanceAboveFavorites?: boolean;
    isSidebarDivideByFriendGroup?: boolean;
    sidebarFavoriteGroupOrder?: string[];
    sidebarFavoriteGroups?: string[];
    sidebarGroupByInstance?: boolean;
    sidebarSortMethod1?: FriendSortMethod | '';
    sidebarSortMethod2?: FriendSortMethod | '';
    sidebarSortMethod3?: FriendSortMethod | '';
};

export type LastLocationSnapshot = {
    friendList?:
        | Set<unknown>
        | Map<string, unknown>
        | readonly string[]
        | Record<string, unknown>;
    location?: unknown;
};

type SidebarStatusOptions = {
    hideNonFriend?: boolean;
    isGameRunning?: boolean | null;
};

export type SameInstanceGroup = {
    location: string;
    rows: SidebarFriendRecord[];
};

function locationProjection(value: unknown): FriendLocationProjection | null {
    return value && typeof value === 'object'
        ? (value as FriendLocationProjection)
        : null;
}

function isFriendSortMethod(
    value: FriendSortMethod | '' | undefined
): value is FriendSortMethod {
    return Boolean(value);
}

export function normalizeLocationStatus(value: unknown) {
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

export function resolvePresenceLocation(profile: unknown) {
    return resolveFriendPresenceLocation(profile);
}

export function readFriendRef(
    friend: SidebarFriendRecord | null | undefined
): SidebarFriendRecord | null | undefined {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

export function readFriendStatusSource(
    friend: SidebarFriendRecord | null | undefined
) {
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

export function readFriendRefLocation(
    friend: SidebarFriendRecord | null | undefined
) {
    const source = readFriendStatusSource(friend);
    return normalizeId(
        source?.location || locationProjection(source?.$location)?.tag
    );
}

export function readFriendRefTravelingLocation(
    friend: SidebarFriendRecord | null | undefined
) {
    const source = readFriendStatusSource(friend);
    return normalizeId(
        source?.travelingToLocation || source?.$travelingToLocation
    );
}

export function timestampMsFromValue(value: unknown) {
    if (value === null || value === undefined || value === '') {
        return 0;
    }
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) {
        return numberValue;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function clearStaleOfflineLocation(location: unknown, state: unknown) {
    const normalizedState = normalizeLocationStatus(state);
    if (
        (normalizedState === 'online' || normalizedState === 'active') &&
        normalizeLocationStatus(location) === 'offline'
    ) {
        return '';
    }
    return location;
}

export function buildFavoriteIdSet(
    remoteFavoriteIds: readonly unknown[] | null | undefined,
    localFriendFavorites: Record<string, unknown> | null | undefined
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

export function resolveTrustNameColour(
    friend: SidebarFriendRecord | null | undefined,
    trustColor: unknown
) {
    if (!friend?.$trustClass && Array.isArray(friend?.tags)) {
        const trust = computeTrustLevel(
            friend.tags,
            typeof friend.developerType === 'string' ? friend.developerType : ''
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

export function legacyStatusDotClassName(status: unknown) {
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

export function normalizeStateBucket(value: unknown) {
    const normalized = normalizeLocationStatus(value);
    return normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
        ? normalized
        : '';
}

export function resolveCurrentUserStateBucket(
    currentUser: SidebarFriendRecord | null | undefined
) {
    const explicitState =
        normalizeStateBucket(currentUser?.stateBucket) ||
        normalizeStateBucket(currentUser?.state);
    if (explicitState) {
        return explicitState;
    }
    if (
        normalizeLocationStatus(
            currentUser?.location ||
                locationProjection(currentUser?.$location)?.tag
        ) === 'offline'
    ) {
        return 'offline';
    }
    return 'online';
}

function activeStatusDotClassName(status: unknown) {
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

function activeStatusSortValue(friend: SidebarFriendRecord) {
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

function compareByActiveStatus(
    left: SidebarFriendRecord,
    right: SidebarFriendRecord
) {
    return sortStatus(
        activeStatusSortValue(left),
        activeStatusSortValue(right)
    );
}

export function resolveSidebarStatusDotClassName(
    friend: SidebarFriendRecord | null | undefined,
    currentUser: SidebarFriendRecord | null | undefined,
    isCurrentUser = false,
    { hideNonFriend = true, isGameRunning = false }: SidebarStatusOptions = {}
) {
    const source = readFriendStatusSource(friend);
    if (!source) {
        return '';
    }
    const userId = normalizeId(source?.id || source?.userId);
    const status = normalizeLocationStatus(source?.status);
    const location = normalizeLocationStatus(
        source?.location || locationProjection(source?.$location)?.tag
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

export function toLegacyFriendSortRow(
    friend: SidebarFriendRecord
): FriendSortItem {
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
    } as FriendSortItem;
}

export function sortRows(
    rows: readonly SidebarFriendRecord[],
    prefs: SidebarPreferences
) {
    const methods = [
        prefs.sidebarSortMethod1,
        prefs.sidebarSortMethod2,
        prefs.sidebarSortMethod3
    ].filter(isFriendSortMethod);
    if (!methods.length) {
        return rows;
    }
    const sort = getFriendsSortFunction(methods);
    return [...rows].sort((left, right) =>
        sort(toLegacyFriendSortRow(left), toLegacyFriendSortRow(right))
    );
}

export function sortActiveRows(
    rows: readonly SidebarFriendRecord[],
    prefs: SidebarPreferences
) {
    const sortedRows = sortRows(rows, prefs);
    return [...sortedRows].sort(compareByActiveStatus);
}

export function lastLocationHasFriend(
    lastLocation: LastLocationSnapshot | null | undefined,
    friendId: unknown
) {
    const normalizedFriendId = normalizeId(friendId);
    if (!normalizedFriendId) {
        return false;
    }
    const friendList = lastLocation?.friendList;
    if (friendList instanceof Set || friendList instanceof Map) {
        return friendList.has(normalizedFriendId);
    }
    if (Array.isArray(friendList)) {
        return friendList.some((id) => normalizeId(id) === normalizedFriendId);
    }
    if (friendList && typeof friendList === 'object') {
        return Boolean(
            (friendList as Record<string, unknown>)[normalizedFriendId]
        );
    }
    return false;
}

export function sameInstanceLocationTag(
    friend: SidebarFriendRecord,
    lastLocation: LastLocationSnapshot | null | undefined
) {
    const source = readFriendStatusSource(friend);
    if (
        normalizeLocationStatus(source?.stateBucket || source?.state) !==
        'online'
    ) {
        return '';
    }
    const parsedLocation =
        locationProjection(source?.$location) ||
        parseLocation(source?.location);
    let locationTag = normalizeId(parsedLocation?.tag || source?.location);
    if (
        !parsedLocation?.isRealInstance &&
        lastLocationHasFriend(lastLocation, friend?.id)
    ) {
        locationTag = normalizeId(lastLocation?.location);
    }
    return isRealInstance(locationTag) ? locationTag : '';
}

export function readFriendInstanceEpoch(
    source: SidebarFriendRecord | null | undefined,
    isTraveling: boolean
) {
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

export function sameInstanceFallbackKey(
    locationTag: unknown,
    friend: SidebarFriendRecord
) {
    const friendId = normalizeId(friend?.id);
    return `${locationTag}:${friendId || normalizeId(readFriendRef(friend)?.id)}`;
}

export function withSameInstanceJoinTime(
    friend: SidebarFriendRecord,
    locationTag: string,
    fallbackJoinTimes: Map<string, number>
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
    rows: readonly SidebarFriendRecord[],
    prefs: SidebarPreferences,
    lastLocation: LastLocationSnapshot | null | undefined,
    fallbackJoinTimes: Map<string, number>
) {
    const groupsByLocation = new Map<string, SidebarFriendRecord[]>();
    const activeFallbackKeys = new Set<string>();
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
        const groupRows = groupsByLocation.get(locationTag);
        if (!groupRows) {
            continue;
        }
        groupRows.push(
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
        .filter(([, groupRows]) => groupRows.length > 1)
        .sort((left, right) => right[1].length - left[1].length)
        .map(
            ([location, groupRows]): SameInstanceGroup => ({
                location,
                rows: groupRows
            })
        );
}
