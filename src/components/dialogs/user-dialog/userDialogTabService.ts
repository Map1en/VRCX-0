import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';

const userDialogDataTabs = new Set([
    'mutual',
    'groups',
    'worlds',
    'favorite-worlds',
    'avatars'
]);

export function isUserDialogDataTab(tab: any) {
    return userDialogDataTabs.has(tab);
}

export function userDialogDataKeyForTab(tab: any) {
    return tab === 'favorite-worlds' ? 'favoriteWorlds' : tab;
}

export function userDialogAvatarSortRequest(avatarSort: any) {
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

function countRows(rows: any) {
    return Array.isArray(rows) ? rows.length : 0;
}

function resolvedCount(result: any) {
    return result.status === 'fulfilled' ? countRows(result.value) : undefined;
}

async function loadFavoriteWorldCount({ endpoint, userId, repositories }: any) {
    const favoriteGroups =
        await repositories.vrchatFavoriteRepository.getAllFavoriteGroups({
            endpoint,
            ownerId: userId
        });
    const worldGroups = favoriteGroups.filter(
        (group: any) => group?.type === 'world'
    );
    const worldListResults = await Promise.allSettled(
        worldGroups.map((group: any) =>
            repositories.vrchatFavoriteRepository.getAllFavoriteWorlds({
                endpoint,
                ownerId: userId,
                userId,
                tag: group.name
            })
        )
    );
    return worldListResults.reduce(
        (count: any, result: any) =>
            result.status === 'fulfilled'
                ? count + countRows(result.value)
                : count,
        0
    );
}

async function loadAvatarCount({
    endpoint,
    userId,
    currentUserId,
    currentAvatarId,
    previousAvatarSwapTime,
    effectiveAvatarReleaseStatus,
    providerConfig = null,
    repositories
}: any) {
    if (userId === currentUserId) {
        const rows = await repositories.myAvatarRepository.getMyAvatars({
            endpoint,
            currentUserId,
            currentAvatarId,
            previousAvatarSwapTime
        });
        return countRows(
            effectiveAvatarReleaseStatus === 'all'
                ? rows
                : rows.filter(
                      (avatar: any) =>
                          avatar?.releaseStatus === effectiveAvatarReleaseStatus
                  )
        );
    }

    const resolvedProviderConfig =
        providerConfig ||
        (await repositories.avatarSearchProviderRepository.getConfig());
    if (
        !resolvedProviderConfig.enabled ||
        !resolvedProviderConfig.selectedProvider
    ) {
        return 0;
    }

    const response = await repositories.avatarSearchProviderRepository.search({
        provider: resolvedProviderConfig.selectedProvider,
        query: userId
    });
    return countRows(
        response.avatars.filter((avatar: any) => avatar.authorId === userId)
    );
}

export async function loadUserDialogTabCounts({
    userId,
    endpoint,
    currentUserId,
    currentAvatarId = '',
    previousAvatarSwapTime = 0,
    effectiveAvatarReleaseStatus,
    repositories,
    force = false
}: any) {
    if (!userId) {
        return {};
    }
    const avatarProviderConfig =
        userId === currentUserId
            ? null
            : await repositories.avatarSearchProviderRepository.getConfig();
    const avatarProviderKey =
        userId === currentUserId
            ? 'self'
            : avatarProviderConfig?.enabled &&
                avatarProviderConfig?.selectedProvider
              ? avatarProviderConfig.selectedProvider
              : 'disabled';

    return fetchCachedData({
        queryKey: queryKeys.userDialogTabCounts(
            {
                userId,
                currentUserId,
                avatarProvider: avatarProviderKey,
                avatarReleaseStatus: effectiveAvatarReleaseStatus
            },
            endpoint
        ),
        policy: entityQueryPolicies.userDialogTabCounts,
        force,
        queryFn: async () => {
            const releaseStatus = userId === currentUserId ? 'all' : 'public';
            const [groups, worlds, favoriteWorlds, avatars] =
                await Promise.allSettled([
                    repositories.groupProfileRepository.getUserGroups({
                        userId,
                        endpoint
                    }),
                    repositories.worldProfileRepository.getAllWorldsByUser({
                        userId,
                        endpoint,
                        sort: 'updated',
                        order: 'descending',
                        releaseStatus
                    }),
                    loadFavoriteWorldCount({
                        endpoint,
                        userId,
                        repositories
                    }),
                    loadAvatarCount({
                        endpoint,
                        userId,
                        currentUserId,
                        currentAvatarId,
                        previousAvatarSwapTime,
                        effectiveAvatarReleaseStatus,
                        providerConfig: avatarProviderConfig,
                        repositories
                    })
                ]);

            return {
                groups: resolvedCount(groups),
                worlds: resolvedCount(worlds),
                'favorite-worlds':
                    favoriteWorlds.status === 'fulfilled'
                        ? Number(favoriteWorlds.value) || 0
                        : undefined,
                avatars:
                    avatars.status === 'fulfilled'
                        ? Number(avatars.value) || 0
                        : undefined
            };
        }
    });
}

export async function loadUserDialogTabData({
    tab,
    userId,
    endpoint,
    currentUserId,
    currentAvatarId = '',
    previousAvatarSwapTime = 0,
    worldSort,
    worldOrder,
    repositories
}: any): Promise<{ rows: unknown[]; favoriteWorldGroups: unknown[] }> {
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
            const rows = await repositories.myAvatarRepository.getMyAvatars({
                endpoint,
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime
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
                (avatar: any) => avatar.authorId === userId
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
        (group: any) => group?.type === 'world'
    );
    const worldListResults = await Promise.allSettled(
        worldGroups.map(async (group: any) => {
            const worlds =
                await repositories.vrchatFavoriteRepository.getAllFavoriteWorlds(
                    {
                        endpoint,
                        ownerId: userId,
                        userId,
                        tag: group.name
                    }
                );
            return worlds.map((world: any) => ({
                ...world,
                $favoriteGroup: group.displayName || group.name,
                $favoriteGroupKey: group.name
            }));
        })
    );
    return {
        rows: worldListResults
            .filter((result: any) => result.status === 'fulfilled')
            .flatMap((result: any) => result.value),
        favoriteWorldGroups: worldGroups
    };
}
