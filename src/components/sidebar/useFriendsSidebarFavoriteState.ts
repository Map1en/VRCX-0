import { useFavoriteStore } from '@/state/favoriteStore';

export function useFriendsSidebarFavoriteState() {
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );

    return {
        favoriteFriendGroups,
        favoriteFriendIds,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites
    };
}
