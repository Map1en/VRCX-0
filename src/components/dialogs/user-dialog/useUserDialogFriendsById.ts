import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { resolveFriendPresenceLocation } from '@/domain/friends/presence';
import type { FriendRecord, FriendRosterById } from '@/domain/friends/types';
import { isSameInstanceLocation } from '@/domain/instances/instanceRoster';
import { parseLocation } from '@/shared/utils/location';
import { useFriendRosterStore } from '@/state/friendRosterStore';

const EMPTY_FRIENDS: FriendRecord[] = [];

function isFriendAtInstance(friend: FriendRecord, location: string) {
    return isSameInstanceLocation(
        resolveFriendPresenceLocation(friend, { preferTraveling: true }),
        location
    );
}

export function useUserDialogTargetFriendsById({
    normalizedUserId,
    snapshotKey,
    targetFriend
}: {
    normalizedUserId: string;
    snapshotKey: string;
    targetFriend: FriendRecord | null;
}): FriendRosterById {
    const rosterOwnerId = useFriendRosterStore((state) => state.currentUserId);
    const rosterStatus = useFriendRosterStore((state) => state.loadStatus);
    const key = `${snapshotKey}:${rosterOwnerId ?? ''}:${rosterStatus}`;
    const [snapshotState, setSnapshotState] = useState(() => ({
        key,
        friendsById: useFriendRosterStore.getState().friendsById
    }));
    if (snapshotState.key !== key) {
        setSnapshotState({
            key,
            friendsById: useFriendRosterStore.getState().friendsById
        });
    }
    const snapshot = snapshotState.friendsById;
    return useMemo(() => {
        if (
            !normalizedUserId ||
            (snapshot[normalizedUserId] ?? null) === targetFriend
        ) {
            return snapshot;
        }
        const next = { ...snapshot };
        if (targetFriend) {
            next[normalizedUserId] = targetFriend;
        } else {
            delete next[normalizedUserId];
        }
        return next;
    }, [normalizedUserId, snapshot, targetFriend]);
}

export function useUserDialogLocationFriendsById(
    targetFriendsById: FriendRosterById,
    presenceLocation: string
): FriendRosterById {
    const tracksInstance = parseLocation(presenceLocation).isRealInstance;
    const coLocatedFriends = useFriendRosterStore(
        useShallow((state) =>
            tracksInstance
                ? Object.values(state.friendsById).filter((friend) =>
                      isFriendAtInstance(friend, presenceLocation)
                  )
                : EMPTY_FRIENDS
        )
    );
    return useMemo(() => {
        if (!tracksInstance) {
            return targetFriendsById;
        }
        const liveFriendsById = useFriendRosterStore.getState().friendsById;
        const trackedIds = new Set(coLocatedFriends.map((friend) => friend.id));
        for (const friend of Object.values(targetFriendsById)) {
            if (isFriendAtInstance(friend, presenceLocation)) {
                trackedIds.add(friend.id);
            }
        }
        let next: FriendRosterById | null = null;
        for (const friendId of trackedIds) {
            const liveFriend = liveFriendsById[friendId];
            if (targetFriendsById[friendId] === liveFriend) {
                continue;
            }
            next ??= { ...targetFriendsById };
            if (liveFriend) {
                next[friendId] = liveFriend;
            } else {
                delete next[friendId];
            }
        }
        return next ?? targetFriendsById;
    }, [coLocatedFriends, presenceLocation, targetFriendsById, tracksInstance]);
}
