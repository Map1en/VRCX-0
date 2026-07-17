import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';

import {
    isRecord,
    isSentinelLocationValue,
    localized,
    normalizeFriendsLocationId,
    resolveWorldIdCandidate,
    sourceFromFriend
} from './normalization';
import {
    resolveFriendGroupName,
    resolveFriendTravelingWorldId,
    resolveFriendTravelingWorldName,
    resolveFriendWorldName,
    resolvePresenceLocation
} from './presence';
import type {
    FriendLocationFriend,
    FriendLocationTarget,
    TranslationFn
} from './types';

export function resolveLocationTarget(
    friend: FriendLocationFriend | null | undefined
): FriendLocationTarget {
    const rawLocation = resolvePresenceLocation(friend);
    const parsed = parseLocation(rawLocation);
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    const travelingWorldId = parsed.isTraveling
        ? resolveFriendTravelingWorldId(friend)
        : '';
    const explicitWorldId = resolveWorldIdCandidate(
        isRecord(friend) ? friend.worldId : ''
    );
    const worldId =
        !rawLocation || parsed.isOffline || parsed.isPrivate
            ? ''
            : parsedWorldId || travelingWorldId || explicitWorldId;

    return {
        rawLocation,
        parsed,
        worldId,
        groupId: parsed.groupId || '',
        instanceId: parsed.instanceId || '',
        accessTypeName: parsed.accessTypeName || '',
        isOffline: !rawLocation || parsed.isOffline,
        isPrivate: parsed.isPrivate,
        isTraveling: parsed.isTraveling
    };
}

export function isFriendInPrivateLocation(
    friend: FriendLocationFriend | null | undefined
) {
    const target = resolveLocationTarget(friend);
    return target.isPrivate;
}

export function partitionFriendsByPrivateLocation<
    TFriend extends FriendLocationFriend
>(friends: TFriend[]) {
    const visibleLocation: TFriend[] = [];
    const privateLocation: TFriend[] = [];
    for (const friend of friends) {
        if (isFriendInPrivateLocation(friend)) {
            privateLocation.push(friend);
        } else {
            visibleLocation.push(friend);
        }
    }
    return { visibleLocation, privateLocation };
}

export function resolveLocationSummary(
    friend: FriendLocationFriend | null | undefined,
    t: TranslationFn | null = null
) {
    const source = sourceFromFriend(friend);
    const travelingToLocation = [
        source?.travelingToLocation,
        source?.$travelingToLocation
    ]
        .map(normalizeFriendsLocationId)
        .find((value) => value && !isSentinelLocationValue(value));
    if (travelingToLocation && !isSentinelLocationValue(travelingToLocation)) {
        const parsedTraveling = parseLocation(travelingToLocation);
        return {
            label: resolveFriendTravelingWorldName(friend),
            meta: parsedTraveling.instanceName || travelingToLocation
        };
    }

    const location = resolveFriendPresenceLocation(friend, {
        preferTraveling: false
    });
    const parsedLocation = parseLocation(location);

    if (!location || parsedLocation.isOffline) {
        return {
            label: localized(t, 'location.offline', 'Offline'),
            meta: ''
        };
    }

    if (parsedLocation.isPrivate) {
        return {
            label: localized(t, 'location.private', 'Private'),
            meta: ''
        };
    }

    if (parsedLocation.isTraveling) {
        return {
            label: localized(t, 'location.traveling', 'Traveling'),
            meta: resolveFriendTravelingWorldName(friend) || location
        };
    }

    return {
        label: resolveFriendWorldName(friend),
        meta: [
            resolveFriendGroupName(friend),
            parsedLocation.accessTypeName,
            parsedLocation.instanceName
        ]
            .filter(Boolean)
            .join(' · ')
    };
}

export function resolveWorldDialogTarget(
    target: Partial<FriendLocationTarget> | null
) {
    const rawLocation = normalizeFriendsLocationId(target?.rawLocation);
    const worldId = normalizeFriendsLocationId(target?.worldId);
    const parsed = target?.parsed || parseLocation(rawLocation);
    if (parsed?.isRealInstance && parsed?.tag) {
        return parsed.tag;
    }
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    return resolveWorldIdCandidate(worldId, parsedWorldId, rawLocation);
}
