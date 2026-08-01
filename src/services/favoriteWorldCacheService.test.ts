import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    cacheFavoriteWorldDetails,
    cacheWorldDetails
} from './favoriteWorldCacheService';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteCacheSnapshot: vi.fn()
    }
}));

describe('favoriteWorldCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(true);
        useFavoriteStore.getState().resetFavorites();
    });

    it('forwards the existing payload to the Rust cache policy', async () => {
        const world = {
            id: ' wrld_cache ',
            name: 'Cached World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/thumb.png',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
            version: 7
        };

        await expect(cacheWorldDetails(world)).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'world',
            entity: world,
            fallbackEntityId: ''
        });
    });

    it('ignores empty world payloads', async () => {
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(false);
        await expect(cacheWorldDetails({ name: 'Missing id' })).resolves.toBe(
            false
        );
    });

    it('uses the caller world id when a detail payload is missing id', async () => {
        await expect(
            cacheWorldDetails(
                {
                    name: 'Fallback World',
                    releaseStatus: 'public',
                    thumbnailImageUrl: 'https://example.test/fallback.png'
                },
                'wrld_fallback'
            )
        ).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'world',
            entity: {
                name: 'Fallback World',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/fallback.png'
            },
            fallbackEntityId: 'wrld_fallback'
        });
    });

    it('refreshes DB cache automatically for local favorite worlds', async () => {
        const world = {
            id: 'wrld_cached',
            name: 'Cached Local World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/local.png'
        };

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(false);
        expect(commands.appFavoriteCacheSnapshot).not.toHaveBeenCalled();

        useFavoriteStore.getState().addLocalFavorite({
            kind: 'world',
            groupName: 'Keep',
            entityId: 'wrld_cached',
            entity: world
        });

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(true);
        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(1);
    });

    it('refreshes DB cache automatically for remote favorite worlds', async () => {
        const world = {
            id: 'wrld_remote_cached',
            name: 'Cached Remote World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/remote.png'
        };

        useFavoriteStore.setState({
            favoriteWorldIds: ['wrld_remote_cached']
        });

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(true);
        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'world',
            entity: world,
            fallbackEntityId: ''
        });
    });

    it('inserts complete private world details when no DB cache exists', async () => {
        await expect(
            cacheWorldDetails({
                id: 'wrld_private',
                name: 'Private World',
                releaseStatus: 'private',
                thumbnailImageUrl: 'https://example.test/private.png'
            })
        ).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite DB cache with private world details', async () => {
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(false);

        await expect(
            cacheWorldDetails({
                id: 'wrld_private',
                name: 'Private World',
                releaseStatus: 'private',
                thumbnailImageUrl: 'https://example.test/private.png'
            })
        ).resolves.toBe(false);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite DB cache with unknown world details', async () => {
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(false);
        await expect(
            cacheWorldDetails({
                id: 'wrld_unknown',
                name: 'Unknown World',
                releaseStatus: 'unknown',
                thumbnailImageUrl: 'https://example.test/unknown.png'
            })
        ).resolves.toBe(false);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite DB cache with incomplete world details', async () => {
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(false);
        await expect(
            cacheWorldDetails({
                id: 'wrld_broken',
                releaseStatus: 'public'
            })
        ).resolves.toBe(false);

        await expect(
            cacheWorldDetails({
                id: 'wrld_broken',
                name: 'Broken World',
                releaseStatus: 'public'
            })
        ).resolves.toBe(false);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(2);
    });
});
