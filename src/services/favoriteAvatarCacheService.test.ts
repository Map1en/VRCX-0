import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    cacheAvatarDetails,
    cacheFavoriteAvatarDetails
} from './favoriteAvatarCacheService';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteCacheSnapshot: vi.fn()
    }
}));

describe('favoriteAvatarCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(true);
        useFavoriteStore.getState().resetFavorites();
    });

    it('forwards the existing payload to the Rust cache policy', async () => {
        const avatar = {
            id: ' avtr_cache ',
            name: 'Cached Avatar',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/thumb.png',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
            version: 7
        };

        await expect(cacheAvatarDetails(avatar)).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'avatar',
            entity: avatar,
            fallbackEntityId: ''
        });
    });

    it('uses the caller avatar id when a detail payload is missing id', async () => {
        await expect(
            cacheAvatarDetails(
                {
                    name: 'Fallback Avatar',
                    releaseStatus: 'public',
                    thumbnailImageUrl: 'https://example.test/fallback.png'
                },
                'avtr_fallback'
            )
        ).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'avatar',
            entity: {
                name: 'Fallback Avatar',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/fallback.png'
            },
            fallbackEntityId: 'avtr_fallback'
        });
    });

    it('refreshes DB cache automatically for local favorite avatars', async () => {
        const avatar = {
            id: 'avtr_cached',
            name: 'Cached Local Avatar',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/local.png'
        };

        await expect(cacheFavoriteAvatarDetails(avatar)).resolves.toBe(false);
        expect(commands.appFavoriteCacheSnapshot).not.toHaveBeenCalled();

        useFavoriteStore.getState().createLocalFavoriteGroup({
            id: 1,
            kind: 'avatar',
            name: 'Keep',
            shared: false
        });
        useFavoriteStore.getState().addLocalFavorite({
            kind: 'avatar',
            groupId: 1,
            entityId: 'avtr_cached',
            entity: avatar
        });

        await expect(cacheFavoriteAvatarDetails(avatar)).resolves.toBe(true);
        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(1);
    });

    it('refreshes DB cache automatically for remote favorite avatars', async () => {
        const avatar = {
            id: 'avtr_remote_cached',
            name: 'Cached Remote Avatar',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/remote.png'
        };

        useFavoriteStore.setState({
            favoriteAvatarIds: ['avtr_remote_cached']
        });

        await expect(cacheFavoriteAvatarDetails(avatar)).resolves.toBe(true);
        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'avatar',
            entity: avatar,
            fallbackEntityId: ''
        });
    });
});
