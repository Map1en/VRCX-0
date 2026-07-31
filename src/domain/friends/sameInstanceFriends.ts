import { isRealInstance } from '@/shared/utils/instance';
import {
    getFriendsLocations,
    normalizeLocationValue
} from '@/shared/utils/location';

type FriendPresenceRecord = Record<string, unknown> & {
    ref?: unknown;
    state?: unknown;
    stateBucket?: unknown;
};

type SameInstanceLastLocation = {
    friendList?:
        | Set<unknown>
        | Map<unknown, unknown>
        | readonly unknown[]
        | Record<string, unknown>;
    location?: unknown;
};

type SameInstanceFriendGroup<TFriend> = {
    location: string;
    friends: TFriend[];
    isCurrentInstance: boolean;
};

const CURRENT_INSTANCE_MIN_FRIENDS = 1;
const OTHER_INSTANCE_MIN_FRIENDS = 2;

function asRecord(value: unknown): FriendPresenceRecord | null {
    return value && typeof value === 'object'
        ? (value as FriendPresenceRecord)
        : null;
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

function isOnlineSameInstanceFriend(friend: unknown): boolean {
    const source = friendPresenceSource(friend);
    return (
        normalizeFriendState(source?.stateBucket || source?.state) === 'online'
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
    lastLocation: SameInstanceLastLocation | null | undefined
): SameInstanceFriendGroup<TFriend>[] {
    const groupsByLocation = new Map<string, TFriend[]>();
    const currentLocation = normalizeLocationValue(lastLocation?.location);

    for (const friend of friends) {
        if (!isOnlineSameInstanceFriend(friend)) {
            continue;
        }
        const location = resolveSameInstanceFriendLocation(
            friend,
            lastLocation
        );
        if (!location) {
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
                    ? CURRENT_INSTANCE_MIN_FRIENDS
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
    isOnlineSameInstanceFriend,
    resolveSameInstanceFriendLocation
};
export type { SameInstanceFriendGroup, SameInstanceLastLocation };
