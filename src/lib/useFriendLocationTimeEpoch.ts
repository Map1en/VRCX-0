import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

export function resolveFriendLocationTimeEpoch(
    friend: { state?: string } | null | undefined,
    entry: FriendLocationTimeEntry | null | undefined,
    location: string
): number {
    const expectedLocation = location.trim();
    if (
        !friend ||
        !entry ||
        (entry.source !== 'gameLog' && friend.state !== 'online') ||
        entry.location !== expectedLocation ||
        !entry.sinceMs
    ) {
        return 0;
    }
    return entry.sinceMs;
}

export function useFriendLocationTimeEpoch(
    userId: string,
    location: string
): number {
    const normalizedUserId = userId.trim();
    const friend = useFriendRosterStore((state) =>
        normalizedUserId ? (state.friendsById[normalizedUserId] ?? null) : null
    );
    const entry = useFriendLocationTimeStore((state) =>
        normalizedUserId ? (state.byUserId[normalizedUserId] ?? null) : null
    );
    return resolveFriendLocationTimeEpoch(friend, entry, location);
}
