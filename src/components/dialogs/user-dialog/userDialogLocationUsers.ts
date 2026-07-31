import { resolveObservedPlayerUserId } from '@/domain/friends/sameInstanceFriends';
import {
    buildInstanceRosterRows,
    firstText,
    resolvePresenceLocation
} from '@/domain/instances/instanceRoster';
import { parseLocation } from '@/shared/utils/location';

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
    return !(
        friendState !== 'online' &&
        parseLocation(resolvePresenceLocation(friend)).isPrivate &&
        !observedInCurrentInstance
    );
}

function filterVisibleUserDialogLocationUsers<TUser>({
    currentUserId,
    friendsById,
    users
}: {
    currentUserId: unknown;
    friendsById: unknown;
    users: readonly TUser[];
}): TUser[] {
    const friendIds = new Set(
        Object.keys(
            friendsById && typeof friendsById === 'object' ? friendsById : {}
        )
    );
    const normalizedCurrentUserId = firstText(currentUserId);
    return users.filter((user) => {
        const userRecord =
            user && typeof user === 'object'
                ? (user as Record<string, unknown>)
                : {};
        const userId = firstText(userRecord.id, userRecord.userId);
        return Boolean(
            userId &&
            (userId === normalizedCurrentUserId || friendIds.has(userId))
        );
    });
}

export function buildUserDialogLocationUsers({
    currentUserId,
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
    const roster = buildInstanceRosterRows({
        includeProfileFallback: true,
        instanceCreatorLabel: t('dialog.user.info.instance_creator'),
        ownerFallbackId,
        ownerGroup: source(locationOwnerGroup),
        ownerUser: source(locationOwnerUser),
        parsedLocation,
        profile: source(profile),
        users: (Array.isArray(sameInstanceUsers) ? sameInstanceUsers : []).map(
            (user) => {
                const userId = resolveObservedPlayerUserId(
                    user,
                    friendDirectory
                );
                return userId
                    ? {
                          ...record(user),
                          id: userId,
                          userId
                      }
                    : user;
            }
        )
    });
    const visibleRows = filterVisibleUserDialogLocationUsers({
        currentUserId,
        friendsById,
        users: roster.rows
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
