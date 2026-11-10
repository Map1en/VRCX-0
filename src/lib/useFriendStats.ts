import { useEffect, useMemo } from 'react';

import type { FriendStatsById } from '@/domain/friends/friendStats';
import { loadFriendStats } from '@/services/friendStatsService';
import type { FriendSortContext } from '@/shared/utils/friend';
import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useFriendStatsStore } from '@/state/friendStatsStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const STATS_HYDRATION_DEBOUNCE_MS = 400;
const NO_FRIEND_STATS: FriendStatsById = {};

export function useFriendStatsHydration(enabled: boolean) {
    const ownerUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendsKey = useFriendRosterStore((state) =>
        enabled
            ? state.orderedFriendIds
                  .map(
                      (id) =>
                          `${id}:${state.friendsById[id]?.displayName ?? ''}`
                  )
                  .sort()
                  .join('\u0001')
            : ''
    );

    useEffect(() => {
        if (!enabled || !ownerUserId || !friendsKey) {
            return undefined;
        }
        let active = true;
        const timer = setTimeout(() => {
            const { orderedFriendIds, friendsById } =
                useFriendRosterStore.getState();
            const friends = orderedFriendIds.map((id) => ({
                id,
                displayName: friendsById[id]?.displayName ?? ''
            }));
            loadFriendStats(ownerUserId, friends)
                .then((byUserId) => {
                    if (active) {
                        useFriendStatsStore
                            .getState()
                            .replaceStats(ownerUserId, byUserId);
                    }
                })
                .catch((error: unknown) => {
                    console.warn('[FriendStats] Failed to load', error);
                });
        }, STATS_HYDRATION_DEBOUNCE_MS);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [enabled, friendsKey, ownerUserId]);
}

export function useFriendStatsById(): FriendStatsById {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    return useFriendStatsStore((state) =>
        state.ownerUserId === currentUserId ? state.byUserId : NO_FRIEND_STATS
    );
}

export function useFriendSortContext(
    sortMethods: readonly (string | undefined)[],
    locationTimes: Record<string, FriendLocationTimeEntry>
): FriendSortContext {
    const sortsByStay = sortMethods.includes('Sort by Time in Instance');
    const sortsByLastSeen = sortMethods.includes('Sort by Last Seen');
    useFriendStatsHydration(sortsByLastSeen);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendStatsById = useFriendStatsStore((state) =>
        sortsByLastSeen && state.ownerUserId === currentUserId
            ? state.byUserId
            : NO_FRIEND_STATS
    );
    const staySinceMs = useMemo(
        () =>
            sortsByStay
                ? (friendId: string) => locationTimes[friendId]?.sinceMs
                : undefined,
        [locationTimes, sortsByStay]
    );
    const lastSeen = useMemo(
        () =>
            sortsByLastSeen
                ? (friendId: string) => friendStatsById[friendId]?.lastSeen
                : undefined,
        [friendStatsById, sortsByLastSeen]
    );
    return useMemo(() => ({ staySinceMs, lastSeen }), [lastSeen, staySinceMs]);
}
