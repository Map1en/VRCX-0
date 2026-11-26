import type { LocalFavoriteGroup } from '@/domain/favorites/types';

type RemoteFavoriteFriendGroup = {
    key?: string;
    displayName?: string;
    name?: string;
};

export type FavoriteFriendGroupOption = {
    value: string;
    label: string;
};

function buildRemoteFavoriteFriendGroupOptions(
    favoriteFriendGroups:
        | readonly RemoteFavoriteFriendGroup[]
        | null
        | undefined
) {
    return (favoriteFriendGroups || [])
        .map((group): FavoriteFriendGroupOption => ({
            value: group?.key || '',
            label: group?.displayName || group?.name || group?.key || ''
        }))
        .filter((group) => group.value);
}

function buildLocalFavoriteFriendGroupOptions(
    localFriendFavoriteGroups: readonly LocalFavoriteGroup[] | null | undefined
) {
    return (localFriendFavoriteGroups || []).map(
        (group): FavoriteFriendGroupOption => ({
            value: `local:${group.id}`,
            label: group.name
        })
    );
}

type BuildFavoriteFriendGroupOptionsInput = {
    favoriteFriendGroups?: readonly RemoteFavoriteFriendGroup[] | null;
    localFriendFavoriteGroups?: readonly LocalFavoriteGroup[] | null;
    localFavoriteFriendsGroups?: readonly string[] | null;
};

export function buildFavoriteFriendGroupOptions({
    favoriteFriendGroups,
    localFriendFavoriteGroups,
    localFavoriteFriendsGroups
}: BuildFavoriteFriendGroupOptionsInput) {
    const remoteFavoriteFriendGroupOptions =
        buildRemoteFavoriteFriendGroupOptions(favoriteFriendGroups);
    const localFavoriteFriendGroupOptions =
        buildLocalFavoriteFriendGroupOptions(localFriendFavoriteGroups);
    const favoriteFriendGroupOptions = [
        ...remoteFavoriteFriendGroupOptions,
        ...localFavoriteFriendGroupOptions
    ];
    const selectedFavoriteFriendGroupLabel = favoriteFriendGroupOptions
        .filter((group) =>
            (localFavoriteFriendsGroups || []).includes(group.value)
        )
        .map((group) => group.label)
        .join(', ');

    return {
        favoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        selectedFavoriteFriendGroupLabel
    };
}
