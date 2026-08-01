import {
    isExplicitlyOfflineFriend,
    resolveObservedPlayerUserId
} from '@/domain/friends/sameInstanceFriends';
import {
    applyInstanceDwellEpochs,
    buildInstanceRosterRows,
    firstText,
    isSameInstanceLocation,
    resolvePresenceLocation
} from '@/domain/instances/instanceRoster';
import { parseLocation } from '@/shared/utils/location';

const EMPTY_DWELL_EPOCHS_BY_USER_ID = new Map<string, unknown>();

function shouldIncludeUserDialogLocationFriend({
    currentLocationMatches,
    currentLocationPlayerIds,
    friend
}: {
    currentLocationMatches: boolean;
    currentLocationPlayerIds: ReadonlySet<string>;
    friend: unknown;
}): boolean {
    const friendRecord =
        friend && typeof friend === 'object'
            ? (friend as Record<string, unknown>)
            : {};
    const friendId = firstText(
        friendRecord.id,
        friendRecord.userId,
        friendRecord.user_id
    );
    const friendState = firstText(
        friendRecord.stateBucket,
        friendRecord.state
    ).toLowerCase();
    const observedInCurrentInstance = Boolean(
        currentLocationMatches &&
        friendId &&
        currentLocationPlayerIds.has(friendId)
    );
    if (isExplicitlyOfflineFriend(friend)) {
        return false;
    }
    return Boolean(
        observedInCurrentInstance ||
        friendState === 'online' ||
        !parseLocation(resolvePresenceLocation(friend)).isPrivate
    );
}

function filterVisibleUserDialogLocationUsers<TUser>({
    currentUserId,
    friendsById,
    location,
    memberUserIds,
    users
}: {
    currentUserId: unknown;
    friendsById: unknown;
    location?: unknown;
    memberUserIds?: ReadonlySet<string>;
    users: readonly TUser[];
}): TUser[] {
    const friendDirectory =
        friendsById && typeof friendsById === 'object'
            ? Object.fromEntries(Object.entries(friendsById))
            : {};
    const normalizedCurrentUserId = firstText(currentUserId);
    return users.filter((user) => {
        const userRecord =
            user && typeof user === 'object'
                ? (user as Record<string, unknown>)
                : {};
        const userId = firstText(userRecord.id, userRecord.userId);
        const friend = userId ? friendDirectory[userId] : null;
        const friendLocation = resolvePresenceLocation(friend);
        const friendIsElsewhere = Boolean(
            location &&
            parseLocation(friendLocation).isRealInstance &&
            !isSameInstanceLocation(friendLocation, location)
        );
        return Boolean(
            userId &&
            (userId === normalizedCurrentUserId ||
                (friend &&
                    !isExplicitlyOfflineFriend(friend) &&
                    !friendIsElsewhere &&
                    (!memberUserIds || memberUserIds.has(userId))))
        );
    });
}

export function buildUserDialogLocationUsers({
    currentUserId,
    dwellEpochsByUserId = EMPTY_DWELL_EPOCHS_BY_USER_ID,
    friendsById,
    locationInstance,
    locationOwnerGroup,
    locationOwnerUser,
    profile,
    sameInstanceUsers,
    t,
    visiblePresenceParsedLocation
}: {
    currentUserId: unknown;
    dwellEpochsByUserId?: ReadonlyMap<string, unknown>;
    friendsById: unknown;
    locationInstance: unknown;
    locationOwnerGroup: unknown;
    locationOwnerUser: unknown;
    profile: unknown;
    sameInstanceUsers: unknown;
    t: (key: string) => string;
    visiblePresenceParsedLocation: unknown;
}) {
    const record = (value: unknown) =>
        value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value))
            : {};
    const source = (value: unknown) =>
        typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? record(value)
              : null;
    const instance = record(locationInstance);
    const parsedLocation = record(visiblePresenceParsedLocation);
    const friendDirectory = record(friendsById);
    const group =
        instance.group && typeof instance.group === 'object'
            ? Object.fromEntries(Object.entries(instance.group))
            : {};
    const ownerFallbackId = firstText(
        parsedLocation.userId,
        instance.ownerUserId,
        instance.owner_user_id,
        instance.ownerId,
        instance.owner_id,
        instance.userId,
        instance.user_id,
        instance.groupId,
        instance.group_id,
        group.id,
        parsedLocation.groupId
    );
    const rosterUsers = (
        Array.isArray(sameInstanceUsers) ? sameInstanceUsers : []
    ).map((user) => {
        const userId = resolveObservedPlayerUserId(user, friendDirectory);
        return userId
            ? {
                  ...record(user),
                  id: userId,
                  userId
              }
            : user;
    });
    const memberUserIds = new Set(
        rosterUsers
            .map((user) => firstText(record(user).id, record(user).userId))
            .filter(Boolean)
    );
    const roster = buildInstanceRosterRows({
        includeProfileFallback: true,
        instanceCreatorLabel: t('dialog.user.info.instance_creator'),
        ownerFallbackId,
        ownerGroup: source(locationOwnerGroup),
        ownerUser: source(locationOwnerUser),
        parsedLocation,
        profile: source(profile),
        users: rosterUsers
    });
    const visibleRows = filterVisibleUserDialogLocationUsers({
        currentUserId,
        friendsById,
        location: parsedLocation.tag,
        memberUserIds,
        users: applyInstanceDwellEpochs(roster.rows, dwellEpochsByUserId)
    });

    return {
        locationInstanceUsers: visibleRows,
        locationOwnerId: roster.ownerId
    };
}

export {
    filterVisibleUserDialogLocationUsers,
    shouldIncludeUserDialogLocationFriend
};
