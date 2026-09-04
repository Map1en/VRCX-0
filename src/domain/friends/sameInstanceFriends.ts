import type {
    FriendProfileFields,
    FriendRecordInput,
    FriendRosterBucket
} from '@/domain/friends/types';
import { hasUserIdPrefix } from '@/shared/constants/vrchatIds';
import { isRealInstance } from '@/shared/utils/instance';
import {
    getFriendsLocations,
    normalizeLocationValue,
    type FriendListMembership
} from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';

type FriendPresenceRecord = FriendRecordInput &
    Partial<FriendProfileFields> & {
        ref?: FriendPresenceRecord | null;
        stateBucket?: FriendRosterBucket;
    };

type SameInstanceLastLocation = {
    friendList?: FriendListMembership;
    location?: string | null;
};

type SameInstanceFriendGroup<TFriend> = {
    location: string;
    friends: TFriend[];
    isCurrentInstance: boolean;
};

const OTHER_INSTANCE_MIN_FRIENDS = 2;

export type SameInstanceFriendGroupOptions = {
    includeCurrentUser?: boolean;
    locationTimes?: Readonly<
        Record<
            string,
            {
                location: string;
                source: 'gameLog' | 'realtime';
            }
        >
    >;
};

function asRecord(value: unknown): FriendPresenceRecord | null {
    return isRecord(value) ? value : null;
}

function friendPresenceSource(friend: unknown): FriendPresenceRecord | null {
    const direct = asRecord(friend);
    if (!direct) {
        return null;
    }
    const ref = asRecord(direct.ref);
    if (!ref) {
        return direct;
    }
    return {
        ...ref,
        ...direct,
        ref: null
    };
}

function normalizeFriendState(value: unknown): string {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    return normalized.includes(':') ? normalized.split(':')[0] : normalized;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function firstUserId(...values: unknown[]): string {
    for (const value of values) {
        const userId = text(value);
        if (hasUserIdPrefix(userId)) {
            return userId;
        }
    }
    return '';
}

function resolveObservedPlayerUserId(
    player: unknown,
    friendsById: Record<string, unknown>
): string {
    const source = asRecord(player);
    const explicitUserId = firstUserId(
        source?.userId,
        source?.user_id,
        source?.id
    );
    if (explicitUserId) {
        return explicitUserId;
    }

    const displayName = text(source?.displayName || source?.display_name);
    if (!displayName) {
        return '';
    }
    for (const [friendId, friend] of Object.entries(friendsById)) {
        const friendSource = friendPresenceSource(friend);
        if (
            text(
                friendSource?.displayName ||
                    friendSource?.display_name ||
                    friendSource?.username
            ) === displayName
        ) {
            return firstUserId(
                friendSource?.id,
                friendSource?.userId,
                friendSource?.user_id,
                friendId
            );
        }
    }
    return '';
}

function resolveObservedPlayerUserIds(
    playerIds: unknown,
    players: unknown,
    friendsById: Record<string, unknown>
): string[] {
    const userIds = new Set<string>();
    for (const playerId of Array.isArray(playerIds) ? playerIds : []) {
        const userId = firstUserId(playerId);
        if (userId) {
            userIds.add(userId);
        }
    }
    for (const player of Array.isArray(players) ? players : []) {
        const userId = resolveObservedPlayerUserId(player, friendsById);
        if (userId) {
            userIds.add(userId);
        }
    }
    return Array.from(userIds);
}

function isOnlineSameInstanceFriend(friend: unknown): boolean {
    const source = friendPresenceSource(friend);
    return normalizeFriendState(source?.state) === 'online';
}

function isExplicitlyOfflineFriend(friend: unknown): boolean {
    const source = friendPresenceSource(friend);
    return Boolean(
        source?.pendingOffline ||
        normalizeFriendState(source?.state) === 'offline'
    );
}

function resolveSameInstanceFriendLocation(
    friend: unknown,
    lastLocation: SameInstanceLastLocation | null | undefined
): string {
    const source = friendPresenceSource(friend);
    if (!source) {
        return '';
    }
    const location = normalizeLocationValue(
        getFriendsLocations([source], lastLocation)
    );
    return isRealInstance(location) ? location : '';
}

function buildSameInstanceFriendGroups<TFriend>(
    friends: readonly TFriend[],
    lastLocation: SameInstanceLastLocation | null | undefined,
    {
        includeCurrentUser = false,
        locationTimes
    }: SameInstanceFriendGroupOptions = {}
): SameInstanceFriendGroup<TFriend>[] {
    const groupsByLocation = new Map<string, TFriend[]>();
    const currentLocation = normalizeLocationValue(lastLocation?.location);
    const currentInstanceMinFriends = includeCurrentUser
        ? 1
        : OTHER_INSTANCE_MIN_FRIENDS;

    for (const friend of friends) {
        const source = friendPresenceSource(friend);
        const time =
            locationTimes?.[
                firstUserId(source?.id, source?.userId, source?.user_id)
            ];
        if (time?.source !== 'gameLog' && !isOnlineSameInstanceFriend(friend)) {
            continue;
        }
        const location =
            time?.location ??
            resolveSameInstanceFriendLocation(friend, lastLocation);
        if (!isRealInstance(location)) {
            continue;
        }
        const group = groupsByLocation.get(location);
        if (group) {
            group.push(friend);
        } else {
            groupsByLocation.set(location, [friend]);
        }
    }

    return Array.from(groupsByLocation.entries())
        .filter(
            ([location, groupedFriends]) =>
                groupedFriends.length >=
                (currentLocation !== '' && location === currentLocation
                    ? currentInstanceMinFriends
                    : OTHER_INSTANCE_MIN_FRIENDS)
        )
        .sort((left, right) => right[1].length - left[1].length)
        .map(([location, groupedFriends]) => ({
            location,
            friends: groupedFriends,
            isCurrentInstance:
                currentLocation !== '' && location === currentLocation
        }));
}

export {
    buildSameInstanceFriendGroups,
    isExplicitlyOfflineFriend,
    isOnlineSameInstanceFriend,
    resolveObservedPlayerUserId,
    resolveObservedPlayerUserIds,
    resolveSameInstanceFriendLocation
};
export type { SameInstanceFriendGroup, SameInstanceLastLocation };
