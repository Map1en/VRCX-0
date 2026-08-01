import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getWorldFavorites: vi.fn(),
    getAvatarFavorites: vi.fn(),
    getFriendFavorites: vi.fn(),
    getExplicitLocalFavoriteGroups: vi.fn()
}));

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: {
        getWorldFavorites: mocks.getWorldFavorites,
        getAvatarFavorites: mocks.getAvatarFavorites,
        getFriendFavorites: mocks.getFriendFavorites,
        getExplicitLocalFavoriteGroups: mocks.getExplicitLocalFavoriteGroups
    }
}));

describe('favoriteLocalRefreshService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        useFavoriteStore.getState().resetFavorites();

        mocks.getWorldFavorites.mockResolvedValue([]);
        mocks.getAvatarFavorites.mockResolvedValue([]);
        mocks.getFriendFavorites.mockResolvedValue([]);
        mocks.getExplicitLocalFavoriteGroups.mockResolvedValue([]);
    });

    it('rereads only the requested kind and writes it into the matching store slice', async () => {
        mocks.getWorldFavorites.mockResolvedValue([
            { created_at: '2026-01-01', worldId: 'wrld_1', groupName: 'Worlds' }
        ]);
        mocks.getExplicitLocalFavoriteGroups.mockResolvedValue(['Worlds']);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['world']);

        expect(mocks.getWorldFavorites).toHaveBeenCalledTimes(1);
        expect(mocks.getAvatarFavorites).not.toHaveBeenCalled();
        expect(mocks.getFriendFavorites).not.toHaveBeenCalled();
        expect(useFavoriteStore.getState()).toMatchObject({
            localWorldFavorites: { Worlds: ['wrld_1'] },
            localWorldFavoriteGroups: ['Worlds'],
            localWorldFavoritesList: ['wrld_1']
        });
    });

    it('deduplicates repeated kinds and refreshes each requested kind once', async () => {
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['avatar', 'avatar', 'friend']);

        expect(mocks.getAvatarFavorites).toHaveBeenCalledTimes(1);
        expect(mocks.getFriendFavorites).toHaveBeenCalledTimes(1);
        expect(mocks.getWorldFavorites).not.toHaveBeenCalled();
    });

    it('keeps the newest result when same-kind refreshes finish out of order', async () => {
        let resolveFirst: (rows: unknown[]) => void = () => undefined;
        mocks.getWorldFavorites
            .mockImplementationOnce(
                () =>
                    new Promise<unknown[]>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce([
                {
                    created_at: '2026-01-02',
                    worldId: 'wrld_new',
                    groupName: 'New'
                }
            ]);
        mocks.getExplicitLocalFavoriteGroups
            .mockResolvedValueOnce(['Old'])
            .mockResolvedValueOnce(['New']);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        const first = refreshLocalFavoritesForKinds(['world']);
        await refreshLocalFavoritesForKinds(['world']);
        resolveFirst([
            {
                created_at: '2026-01-01',
                worldId: 'wrld_old',
                groupName: 'Old'
            }
        ]);
        await first;

        expect(useFavoriteStore.getState().localWorldFavorites).toEqual({
            New: ['wrld_new']
        });
    });

    it('drops a completed read after the favorite owner changes', async () => {
        let resolveRows: (rows: unknown[]) => void = () => undefined;
        mocks.getFriendFavorites.mockImplementationOnce(
            () =>
                new Promise<unknown[]>((resolve) => {
                    resolveRows = resolve;
                })
        );
        mocks.getExplicitLocalFavoriteGroups.mockResolvedValue(['Friends']);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');
        useFavoriteStore.getState().setFavoritesLoading('usr_old');

        const refresh = refreshLocalFavoritesForKinds(['friend']);
        useFavoriteStore.getState().setFavoritesLoading('usr_new');
        resolveRows([
            {
                created_at: '2026-01-01',
                userId: 'usr_friend',
                groupName: 'Friends'
            }
        ]);
        await refresh;

        expect(useFavoriteStore.getState()).toMatchObject({
            currentUserId: 'usr_new',
            localFriendFavorites: {}
        });
    });
});
