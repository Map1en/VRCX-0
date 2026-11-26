import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useFavoriteStore } from '@/state/favoriteStore';
import { usePreferencesStore } from '@/state/preferencesStore';

import { buildFeedFavoriteIdSet, normalizeFeedId } from './feedRows';

export function useFeedGroupedFriendIds(enabled: boolean): string[] {
    const {
        favoriteFriendGroups,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites
    } = useFavoriteStore(
        useShallow((state) => ({
            favoriteFriendGroups: state.favoriteFriendGroups,
            groupedFavoriteFriendIdsByGroupKey:
                state.groupedFavoriteFriendIdsByGroupKey,
            localFriendFavoriteGroups: state.localFriendFavoriteGroups,
            localFriendFavorites: state.localFriendFavorites
        }))
    );
    const selectedGroupKeys = usePreferencesStore(
        (state) => state.localFavoriteFriendsGroups
    );

    return useMemo(
        () =>
            enabled
                ? Array.from(
                      buildFeedFavoriteIdSet({
                          remoteGroupKeys: favoriteFriendGroups
                              .map((group) => normalizeFeedId(group.key))
                              .filter(Boolean),
                          remoteIdsByGroupKey:
                              groupedFavoriteFriendIdsByGroupKey,
                          localGroupNames: localFriendFavoriteGroups.length
                              ? localFriendFavoriteGroups
                              : Object.keys(localFriendFavorites),
                          localFriendFavorites,
                          selectedGroupKeys
                      })
                  )
                : [],
        [
            enabled,
            favoriteFriendGroups,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavoriteGroups,
            localFriendFavorites,
            selectedGroupKeys
        ]
    );
}
