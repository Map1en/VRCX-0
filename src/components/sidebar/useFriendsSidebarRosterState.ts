import { useMemo } from 'react';

import { mergeRosterFriendFacts } from '@/domain/friends/friendRosterFacts';
import { useKnownUserFacts } from '@/lib/useKnownUser';
import { useFriendRosterStore } from '@/state/friendRosterStore';

export function useFriendsSidebarRosterState() {
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const offlineIds = useFriendRosterStore((state) => state.offlineIds);
    const loadStatus = useFriendRosterStore((state) => state.loadStatus);
    const factsById = useKnownUserFacts(orderedFriendIds);
    const mergedFriendsById = useMemo(
        () => mergeRosterFriendFacts(friendsById, factsById),
        [friendsById, factsById]
    );

    return {
        activeIds,
        friendsById: mergedFriendsById,
        loadStatus,
        offlineIds,
        onlineIds,
        orderedFriendIds
    };
}
