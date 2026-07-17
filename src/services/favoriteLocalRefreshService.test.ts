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
});
