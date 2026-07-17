import { useMemo } from 'react';

import { useKnownUserFacts } from '@/lib/useKnownUser';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { QuickSearchCatalog } from '../quickSearchCatalog';
import { buildQuickSearchResults } from './quickSearchResultModel';

export function useQuickSearchResults({
    catalog,
    normalizedQuery
}: {
    catalog: QuickSearchCatalog;
    normalizedQuery: string;
}) {
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoritesByObjectId = useFavoriteStore(
        (state) => state.remoteFavoritesByObjectId
    );
    const localWorldDetailsById = useFavoriteStore(
        (state) => state.localWorldDetailsById
    );
    const localAvatarDetailsById = useFavoriteStore(
        (state) => state.localAvatarDetailsById
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const friendIds = useMemo(
        () => Object.keys(friendsById || {}).filter(Boolean),
        [friendsById]
    );
    const knownFriendUsersById = useKnownUserFacts(friendIds, {
        endpoint: currentEndpoint
    });

    return useMemo(
        () =>
            buildQuickSearchResults({
                catalog,
                normalizedQuery,
                currentUserId,
                friendsById,
                knownFriendUsersById,
                remoteFavoritesByObjectId,
                localWorldDetailsById,
                localAvatarDetailsById,
                groupInstances
            }),
        [
            catalog,
            currentUserId,
            friendsById,
            groupInstances,
            knownFriendUsersById,
            localAvatarDetailsById,
            localWorldDetailsById,
            normalizedQuery,
            remoteFavoritesByObjectId
        ]
    );
}
