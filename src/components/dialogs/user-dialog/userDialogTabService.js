const userDialogDataTabs = new Set([
    'mutual',
    'groups',
    'worlds',
    'favorite-worlds',
    'avatars'
]);

export function isUserDialogDataTab(tab) {
    return userDialogDataTabs.has(tab);
}

export function userDialogDataKeyForTab(tab) {
    return tab === 'favorite-worlds' ? 'favoriteWorlds' : tab;
}

export function userDialogAvatarSortRequest(avatarSort) {
    return {
        sort:
            avatarSort === 'createdAt'
                ? 'createdAt'
                : avatarSort === 'update'
                  ? 'updated'
                  : 'name',
        order: avatarSort === 'name' ? 'ascending' : 'descending'
    };
}

export async function loadUserDialogTabData({
    tab,
    userId,
    endpoint,
    currentUserId,
    worldSort,
    worldOrder,
    avatarSort,
    effectiveAvatarReleaseStatus,
    repositories
}) {
    if (!isUserDialogDataTab(tab)) {
        return { rows: [], favoriteWorldGroups: [] };
    }

    if (tab === 'mutual') {
        const rows =
            await repositories.userProfileRepository.getAllMutualFriends({
                userId,
                endpoint
            });
        return { rows, favoriteWorldGroups: [] };
    }

    if (tab === 'groups') {
        const rows = await repositories.groupProfileRepository.getUserGroups({
            userId,
            endpoint
        });
        return { rows, favoriteWorldGroups: [] };
    }

    if (tab === 'worlds') {
        const rows =
            await repositories.worldProfileRepository.getAllWorldsByUser({
                userId,
                endpoint,
                sort: worldSort,
                order: worldOrder,
                releaseStatus: userId === currentUserId ? 'all' : 'public'
            });
        return { rows, favoriteWorldGroups: [] };
    }

    if (tab === 'avatars') {
        if (userId === currentUserId) {
            const { sort, order } = userDialogAvatarSortRequest(avatarSort);
            const rows =
                await repositories.avatarProfileRepository.getAllAvatarsByUser({
                    userId,
                    user: 'me',
                    endpoint,
                    sort,
                    order,
                    releaseStatus: effectiveAvatarReleaseStatus
                });
            return { rows, favoriteWorldGroups: [] };
        }

        const providerConfig =
            await repositories.avatarSearchProviderRepository.getConfig();
        if (!providerConfig.enabled || !providerConfig.selectedProvider) {
            return { rows: [], favoriteWorldGroups: [] };
        }

        const response =
            await repositories.avatarSearchProviderRepository.search({
                provider: providerConfig.selectedProvider,
                query: userId
            });
        return {
            rows: response.avatars.filter(
                (avatar) => avatar.authorId === userId
            ),
            favoriteWorldGroups: []
        };
    }

    const favoriteGroups =
        await repositories.vrchatFavoriteRepository.getAllFavoriteGroups({
            endpoint,
            ownerId: userId
        });
    const worldGroups = favoriteGroups.filter(
        (group) => group?.type === 'world'
    );
    const worldListResults = await Promise.allSettled(
        worldGroups.map(async (group) => {
            const worlds =
                await repositories.vrchatFavoriteRepository.getAllFavoriteWorlds(
                    {
                        endpoint,
                        ownerId: userId,
                        userId,
                        tag: group.name
                    }
                );
            return worlds.map((world) => ({
                ...world,
                $favoriteGroup: group.displayName || group.name,
                $favoriteGroupKey: group.name
            }));
        })
    );
    return {
        rows: worldListResults
            .filter((result) => result.status === 'fulfilled')
            .flatMap((result) => result.value),
        favoriteWorldGroups: worldGroups
    };
}
