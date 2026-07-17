import { beforeEach, describe, expect, it, vi } from 'vitest';

import favoritePersistenceRepository, {
    type FavoriteCacheEntity
} from '@/repositories/favoritePersistenceRepository';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    cacheFavoriteWorldDetails,
    cacheWorldDetails,
    cacheWorldDetailsById
} from './favoriteWorldCacheService';

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: {
        addWorldToCache: vi.fn(),
        getCachedWorldById: vi.fn()
    }
}));

describe('favoriteWorldCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(
            favoritePersistenceRepository.getCachedWorldById
        ).mockResolvedValue(null);
        useFavoriteStore.getState().resetFavorites();
    });

    it('normalizes world details before writing the cache DB', async () => {
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

        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'wrld_cache',
                name: 'Cached World',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/thumb.png',
                created_at: '2026-06-01T00:00:00.000Z',
                updated_at: '2026-06-02T00:00:00.000Z',
                version: 7
            })
        );
    });

    it('ignores empty world payloads', async () => {
        await expect(cacheWorldDetails({ name: 'Missing id' })).resolves.toBe(
            false
        );
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).not.toHaveBeenCalled();
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

        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'wrld_fallback',
                name: 'Fallback World'
            })
        );
    });

    it('writes each world detail from a favorite detail map', async () => {
        await cacheWorldDetailsById({
            wrld_a: {
                name: 'World A',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/a.png'
            },
            wrld_b: {
                id: 'wrld_b',
                name: 'World B',
                releaseStatus: 'unknown',
                thumbnailImageUrl: 'https://example.test/b.png'
            }
        });

        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'wrld_a',
                name: 'World A'
            })
        );
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledTimes(1);
    });

    it('refreshes DB cache automatically for local favorite worlds', async () => {
        const world = {
            id: 'wrld_cached',
            name: 'Cached Local World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/local.png'
        };

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(false);
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).not.toHaveBeenCalled();

        useFavoriteStore.getState().addLocalFavorite({
            kind: 'world',
            groupName: 'Keep',
            entityId: 'wrld_cached',
            entity: world
        });

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(true);
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledTimes(1);
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
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'wrld_remote_cached',
                name: 'Cached Remote World'
            })
        );
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

        expect(
            favoritePersistenceRepository.getCachedWorldById
        ).toHaveBeenCalledWith('wrld_private');
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'wrld_private',
                name: 'Private World',
                releaseStatus: 'private'
            })
        );
    });

    it('does not overwrite DB cache with private world details', async () => {
        const existingWorld: FavoriteCacheEntity = {
            id: 'wrld_private',
            authorId: 'usr_author',
            authorName: 'Cache Author',
            created_at: '2026-06-01T00:00:00.000Z',
            description: 'Existing description',
            imageUrl: 'https://example.test/existing-image.png',
            name: 'Existing Public World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/existing-thumb.png',
            updated_at: '2026-06-02T00:00:00.000Z',
            version: 1
        };

        vi.mocked(
            favoritePersistenceRepository.getCachedWorldById
        ).mockResolvedValue(existingWorld);

        await expect(
            cacheWorldDetails({
                id: 'wrld_private',
                name: 'Private World',
                releaseStatus: 'private',
                thumbnailImageUrl: 'https://example.test/private.png'
            })
        ).resolves.toBe(false);

        expect(
            favoritePersistenceRepository.getCachedWorldById
        ).toHaveBeenCalledWith('wrld_private');
        expect(
            favoritePersistenceRepository.addWorldToCache
        ).not.toHaveBeenCalled();
    });

    it('does not overwrite DB cache with unknown world details', async () => {
        await expect(
            cacheWorldDetails({
                id: 'wrld_unknown',
                name: 'Unknown World',
                releaseStatus: 'unknown',
                thumbnailImageUrl: 'https://example.test/unknown.png'
            })
        ).resolves.toBe(false);

        expect(
            favoritePersistenceRepository.addWorldToCache
        ).not.toHaveBeenCalled();
    });

    it('does not overwrite DB cache with incomplete world details', async () => {
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

        expect(
            favoritePersistenceRepository.addWorldToCache
        ).not.toHaveBeenCalled();
    });
});
