import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';

import {
    isRecord,
    normalizeDisplayText,
    normalizeFriendsLocationId,
    resolveDisplayWorldName,
    resolveWorldIdCandidate,
    sourceFromFriend
} from './normalization';
import type {
    FriendLocationFriend,
    FriendsLocationsLastLocation,
    SameInstanceGroup
} from './types';

export function resolveFriendWorldName(
    friend: FriendLocationFriend | null | undefined
) {
    const source = sourceFromFriend(friend);
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

export function resolveFriendTravelingWorldName(
    friend: FriendLocationFriend | null | undefined
) {
    const source = sourceFromFriend(friend);
    return resolveDisplayWorldName(
        source?.travelingToWorld,
        source?.$travelingToWorld,
        resolveFriendWorldName(friend)
    );
}

export function resolveFriendTravelingWorldId(
    friend: FriendLocationFriend | null | undefined
) {
    const source = sourceFromFriend(friend);
    return resolveWorldIdCandidate(
        source?.travelingToWorld,
        source?.$travelingToWorld
    );
}

export function resolveFriendGroupName(
    friend: FriendLocationFriend | null | undefined
) {
    const source = sourceFromFriend(friend);
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

export function uniqueFriendsById<TFriend extends FriendLocationFriend>(
    friends: TFriend[] | null
) {
    const seen = new Set<string>();
    const rows: TFriend[] = [];
    for (const friend of friends ?? []) {
        const id = normalizeFriendsLocationId(
            isRecord(friend) ? friend.id || friend.userId : ''
        );
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

export function resolvePresenceLocation(
    friend: FriendLocationFriend | null | undefined
) {
    return resolveFriendPresenceLocation(friend);
}

export function isOnlineFriend(
    friend: FriendLocationFriend | null | undefined
) {
    return Boolean(
        isRecord(friend) &&
        (friend.stateBucket === 'online' || friend.state === 'online')
    );
}

export function isShareableInstanceLocation(location: unknown) {
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

export function buildSameInstanceGroups<TFriend extends FriendLocationFriend>(
    friends: TFriend[] | null,
    lastLocation: FriendsLocationsLastLocation | null = null
): SameInstanceGroup<TFriend>[] {
    const groupsByLocation = new Map<string, TFriend[]>();

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
        groupsByLocation.get(location)?.push(friend);
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
