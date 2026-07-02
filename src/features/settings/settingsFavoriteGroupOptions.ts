type RemoteFavoriteFriendGroup = {
    key?: string;
    displayName?: string;
    name?: string;
};

export type FavoriteFriendGroupOption = {
    value: string;
    label: string;
};

export function buildRemoteFavoriteFriendGroupOptions(
    favoriteFriendGroups:
        | readonly RemoteFavoriteFriendGroup[]
        | null
        | undefined
) {
    return (favoriteFriendGroups || [])
        .map(
            (group): FavoriteFriendGroupOption => ({
                value: group?.key || '',
                label: group?.displayName || group?.name || group?.key || ''
            })
        )
        .filter((group) => group.value);
}

export function buildLocalFavoriteFriendGroupOptions(
    localFriendFavoriteGroups: readonly string[] | null | undefined
) {
    return (localFriendFavoriteGroups || [])
        .map(
            (groupName): FavoriteFriendGroupOption => ({
                value: `local:${groupName}`,
                label: groupName
            })
        )
        .filter((group) => group.value);
}

type BuildFavoriteFriendGroupOptionsInput = {
    favoriteFriendGroups?: readonly RemoteFavoriteFriendGroup[] | null;
    localFriendFavoriteGroups?: readonly string[] | null;
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
