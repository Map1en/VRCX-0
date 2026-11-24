import {
    localGameLocation,
    presenceLiveInstanceTag,
    presenceOf
} from '@/domain/friends/presence';
import type {
    FriendProfileFields,
    FriendRecordInput
} from '@/domain/friends/types';
import { hasUserIdPrefix } from '@/shared/constants/vrchatIds';
import {
    isRealInstance,
    normalizeLocationValue
} from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';

type FriendPresenceRecord = FriendRecordInput &
    Partial<FriendProfileFields> & {
        ref?: FriendPresenceRecord | null;
    };

type FriendListMembershipValue = boolean | object | null | undefined;
type FriendListMembership =
    | ReadonlySet<string>
    | ReadonlyMap<string, FriendListMembershipValue>
    | readonly string[]
    | Readonly<Record<string, FriendListMembershipValue>>;

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

function isLastLocationFriend(
    lastLocation: SameInstanceLastLocation | null | undefined,
    friend: FriendPresenceRecord | null
): boolean {
    const friendId = text(friend?.id) || text(friend?.userId);
    const friendList = lastLocation?.friendList;
    if (!friendId || !friendList) {
        return false;
    }
    if (friendList instanceof Set || friendList instanceof Map) {
        return friendList.has(friendId);
    }
    if (Array.isArray(friendList)) {
        return friendList.some(
            (candidate) => normalizeLocationValue(candidate) === friendId
        );
    }
    return Boolean(Reflect.get(friendList, friendId));
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
        const friendSource = asRecord(friend);
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
    return presenceOf(friend)?.kind === 'online';
}

function isOfflineOrLeavingFriend(friend: unknown): boolean {
    const kind = presenceOf(friend)?.kind;
    return kind === 'offline' || kind === 'pendingOffline';
}

function resolveSameInstanceFriendLocation(
    friend: unknown,
    lastLocation: SameInstanceLastLocation | null | undefined
): string {
    const presence = presenceOf(friend);
    if (!presence) {
        return '';
    }
    const liveLocation = presenceLiveInstanceTag(presence, {
        preferTraveling: true
    });
    if (liveLocation || presence.kind !== 'online') {
        return liveLocation;
    }
    const lastLocationValue = normalizeLocationValue(lastLocation?.location);
    return isRealInstance(lastLocationValue) &&
        isLastLocationFriend(lastLocation, asRecord(friend))
        ? lastLocationValue
        : '';
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
        const source = asRecord(friend);
        const time =
            locationTimes?.[
                firstUserId(source?.id, source?.userId, source?.user_id)
            ];
        const localLocation = localGameLocation(time);
        if (!localLocation && !isOnlineSameInstanceFriend(friend)) {
            continue;
        }
        const location =
            localLocation ||
            (time?.location ??
                resolveSameInstanceFriendLocation(friend, lastLocation));
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
    isOfflineOrLeavingFriend,
    resolveObservedPlayerUserId,
    resolveObservedPlayerUserIds,
    resolveSameInstanceFriendLocation
};
export type { SameInstanceLastLocation };
