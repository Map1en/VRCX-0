export function buildRemoteFavoriteFriendGroupOptions(
    favoriteFriendGroups: any
) {
    return (favoriteFriendGroups || [])
        .map((group: any) => ({
            value: group?.key,
            label: group?.displayName || group?.name || group?.key
        }))
        .filter((group: any) => group.value);
}

export function buildLocalFavoriteFriendGroupOptions(
    localFriendFavoriteGroups: any
) {
    return (localFriendFavoriteGroups || [])
        .map((groupName: any) => ({
            value: `local:${groupName}`,
            label: groupName
        }))
        .filter((group: any) => group.value);
}

export function buildFavoriteFriendGroupOptions({
    favoriteFriendGroups,
    localFriendFavoriteGroups,
    localFavoriteFriendsGroups
}: any) {
    const remoteFavoriteFriendGroupOptions =
        buildRemoteFavoriteFriendGroupOptions(favoriteFriendGroups);
    const localFavoriteFriendGroupOptions =
        buildLocalFavoriteFriendGroupOptions(localFriendFavoriteGroups);
    const favoriteFriendGroupOptions = [
        ...remoteFavoriteFriendGroupOptions,
        ...localFavoriteFriendGroupOptions
    ];
    const selectedFavoriteFriendGroupLabel = favoriteFriendGroupOptions
        .filter((group: any) =>
            (localFavoriteFriendsGroups || []).includes(group.value)
        )
        .map((group: any) => group.label)
        .join(', ');

    return {
        favoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        selectedFavoriteFriendGroupLabel
    };
}
