import type { EntityRecord } from '@/domain/entities/profileEntities';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';

export type UserDialogDataTab =
    | 'mutual'
    | 'groups'
    | 'worlds'
    | 'favorite-worlds'
    | 'avatars';

export type UserDialogRepositories = {
    avatarSearchProviderRepository: {
        getConfig(): Promise<{ enabled: boolean; selectedProvider: string }>;
        search(input: {
            provider: string;
            query: string;
        }): Promise<{ avatars: unknown[] }>;
    };
    myAvatarRepository: {
        getMyAvatars(input: Record<string, unknown>): Promise<unknown[]>;
    };
    groupProfileRepository: {
        getUserGroups(input: Record<string, unknown>): Promise<unknown[]>;
    };
    userProfileRepository: {
        getAllMutualFriends(input: Record<string, unknown>): Promise<unknown[]>;
    };
    vrchatFavoriteRepository: {
        getAllFavoriteGroups(
            input: Record<string, unknown>
        ): Promise<unknown[]>;
        getAllFavoriteWorlds(
            input: Record<string, unknown>
        ): Promise<unknown[]>;
    };
    worldProfileRepository: {
        getAllWorldsByUser(input: Record<string, unknown>): Promise<unknown[]>;
    };
};

type UserDialogTabCounts = {
    groups?: number;
    worlds?: number;
    'favorite-worlds'?: number;
    avatars?: number;
};

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function recordRows(value: unknown): EntityRecord[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

const userDialogDataTabs: ReadonlySet<unknown> = new Set<UserDialogDataTab>([
    'mutual',
    'groups',
    'worlds',
    'favorite-worlds',
    'avatars'
]);

export function isUserDialogDataTab(tab: unknown): tab is UserDialogDataTab {
    return userDialogDataTabs.has(tab);
}

export function userDialogDataKeyForTab(tab: UserDialogDataTab) {
    return tab === 'favorite-worlds' ? 'favoriteWorlds' : tab;
}

export function userDialogAvatarSortRequest(avatarSort: unknown) {
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

function countRows(rows: unknown) {
    return Array.isArray(rows) ? rows.length : 0;
}

function resolvedCount(result: PromiseSettledResult<unknown>) {
    return result.status === 'fulfilled' ? countRows(result.value) : undefined;
}

async function loadFavoriteWorldCount({
    endpoint,
    userId,
    repositories
}: {
    endpoint: string;
    userId: string;
    repositories: UserDialogRepositories;
}) {
    const favoriteGroups =
        await repositories.vrchatFavoriteRepository.getAllFavoriteGroups({
            endpoint,
            ownerId: userId
        });
    const worldGroups = favoriteGroups
        .filter(isRecord)
        .filter((group) => group.type === 'world');
    const worldListResults = await Promise.allSettled(
        worldGroups.map((group) =>
            repositories.vrchatFavoriteRepository.getAllFavoriteWorlds({
                endpoint,
                ownerId: userId,
                userId,
                tag: group.name
            })
        )
    );
    return worldListResults.reduce(
        (count, result) =>
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
}: {
    endpoint: string;
    userId: string;
    currentUserId: string;
    currentAvatarId: string;
    previousAvatarSwapTime: number;
    effectiveAvatarReleaseStatus: string;
    providerConfig?: { enabled: boolean; selectedProvider: string } | null;
    repositories: UserDialogRepositories;
}) {
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
                      (avatar) =>
                          isRecord(avatar) &&
                          avatar.releaseStatus === effectiveAvatarReleaseStatus
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
        response.avatars.filter(
            (avatar) => isRecord(avatar) && avatar.authorId === userId
        )
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
}: {
    userId: string;
    endpoint: string;
    currentUserId: string;
    currentAvatarId?: string;
    previousAvatarSwapTime?: number;
    effectiveAvatarReleaseStatus: string;
    repositories: UserDialogRepositories;
    force?: boolean;
}): Promise<UserDialogTabCounts> {
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
}: {
    tab: string;
    userId: string;
    endpoint?: string;
    currentUserId?: string;
    currentAvatarId?: string;
    previousAvatarSwapTime?: number;
    avatarSort?: string;
    effectiveAvatarReleaseStatus?: string;
    worldSort?: string;
    worldOrder?: string;
    repositories: UserDialogRepositories;
}): Promise<{ rows: EntityRecord[]; favoriteWorldGroups: EntityRecord[] }> {
    if (!isUserDialogDataTab(tab)) {
        return { rows: [], favoriteWorldGroups: [] };
    }

    if (tab === 'mutual') {
        const rows =
            await repositories.userProfileRepository.getAllMutualFriends({
                userId,
                endpoint
            });
        return { rows: recordRows(rows), favoriteWorldGroups: [] };
    }

    if (tab === 'groups') {
        const rows = await repositories.groupProfileRepository.getUserGroups({
            userId,
            endpoint
        });
        return { rows: recordRows(rows), favoriteWorldGroups: [] };
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
        return { rows: recordRows(rows), favoriteWorldGroups: [] };
    }

    if (tab === 'avatars') {
        if (userId === currentUserId) {
            const rows = await repositories.myAvatarRepository.getMyAvatars({
                endpoint,
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime
            });
            return { rows: recordRows(rows), favoriteWorldGroups: [] };
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
                (avatar): avatar is EntityRecord =>
                    isRecord(avatar) && avatar.authorId === userId
            ),
            favoriteWorldGroups: []
        };
    }

    const favoriteGroups =
        await repositories.vrchatFavoriteRepository.getAllFavoriteGroups({
            endpoint,
            ownerId: userId
        });
    const worldGroups = favoriteGroups
        .filter(isRecord)
        .filter((group) => group.type === 'world');
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
            return recordRows(worlds).map((world) => ({
                ...world,
                $favoriteGroup: group.displayName || group.name,
                $favoriteGroupKey: group.name
            }));
        })
    );
    return {
        rows: worldListResults.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : []
        ),
        favoriteWorldGroups: recordRows(worldGroups)
    };
}
