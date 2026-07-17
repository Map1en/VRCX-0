import { beforeEach, describe, expect, it, vi } from 'vitest';

import avatarCacheRepository from '@/repositories/avatarCacheRepository';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    cacheAvatarDetails,
    cacheAvatarDetailsById,
    cacheFavoriteAvatarDetails
} from './favoriteAvatarCacheService';

vi.mock('@/repositories/avatarCacheRepository', () => ({
    default: {
        addAvatarToCache: vi.fn(),
        getCachedAvatarById: vi.fn()
    }
}));

describe('favoriteAvatarCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(avatarCacheRepository.getCachedAvatarById).mockResolvedValue(
            null
        );
        useFavoriteStore.getState().resetFavorites();
    });

    it('normalizes avatar details before writing the cache DB', async () => {
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

        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'avtr_cache',
                name: 'Cached Avatar',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/thumb.png',
                created_at: '2026-06-01T00:00:00.000Z',
                updated_at: '2026-06-02T00:00:00.000Z',
                version: 7
            })
        );
    });

    it('ignores empty avatar payloads', async () => {
        await expect(cacheAvatarDetails({ name: 'Missing id' })).resolves.toBe(
            false
        );
        expect(avatarCacheRepository.addAvatarToCache).not.toHaveBeenCalled();
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

        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'avtr_fallback',
                name: 'Fallback Avatar'
            })
        );
    });

    it('writes each avatar detail from a favorite detail map', async () => {
        await cacheAvatarDetailsById({
            avtr_a: {
                name: 'Avatar A',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/a.png'
            },
            avtr_b: {
                id: 'avtr_b',
                name: 'Avatar B',
                releaseStatus: 'private',
                thumbnailImageUrl: 'https://example.test/b.png'
            }
        });

        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'avtr_a',
                name: 'Avatar A'
            })
        );
        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'avtr_b',
                name: 'Avatar B',
                releaseStatus: 'private'
            })
        );
    });

    it('refreshes DB cache automatically for local favorite avatars', async () => {
        const avatar = {
            id: 'avtr_cached',
            name: 'Cached Local Avatar',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/local.png'
        };

        await expect(cacheFavoriteAvatarDetails(avatar)).resolves.toBe(false);
        expect(avatarCacheRepository.addAvatarToCache).not.toHaveBeenCalled();

        useFavoriteStore.getState().addLocalFavorite({
            kind: 'avatar',
            groupName: 'Keep',
            entityId: 'avtr_cached',
            entity: avatar
        });

        await expect(cacheFavoriteAvatarDetails(avatar)).resolves.toBe(true);
        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledTimes(1);
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
        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'avtr_remote_cached',
                name: 'Cached Remote Avatar'
            })
        );
    });

    it('inserts complete hidden avatar details when no DB cache exists', async () => {
        await expect(
            cacheAvatarDetails({
                id: 'avtr_hidden',
                name: 'Hidden Avatar',
                releaseStatus: 'hidden',
                thumbnailImageUrl: 'https://example.test/hidden.png'
            })
        ).resolves.toBe(true);

        expect(avatarCacheRepository.getCachedAvatarById).toHaveBeenCalledWith(
            'avtr_hidden'
        );
        expect(avatarCacheRepository.addAvatarToCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'avtr_hidden',
                name: 'Hidden Avatar',
                releaseStatus: 'hidden'
            })
        );
    });

    it('does not overwrite DB cache with non-public avatar details', async () => {
        const existingAvatar = {
            id: 'avtr_private',
            authorId: 'usr_author',
            authorName: 'Cache Author',
            created_at: '2026-06-01T00:00:00.000Z',
            description: 'Existing description',
            imageUrl: 'https://example.test/existing-image.png',
            name: 'Existing Public Avatar',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/existing-thumb.png',
            updated_at: '2026-06-02T00:00:00.000Z',
            version: 1
        };

        vi.mocked(avatarCacheRepository.getCachedAvatarById).mockResolvedValue(
            existingAvatar
        );

        await expect(
            cacheAvatarDetails({
                id: 'avtr_private',
                name: 'Private Avatar',
                releaseStatus: 'private',
                thumbnailImageUrl: 'https://example.test/private.png'
            })
        ).resolves.toBe(false);

        expect(avatarCacheRepository.getCachedAvatarById).toHaveBeenCalledWith(
            'avtr_private'
        );
        expect(avatarCacheRepository.addAvatarToCache).not.toHaveBeenCalled();
    });

    it('does not overwrite DB cache with incomplete avatar details', async () => {
        await expect(
            cacheAvatarDetails({
                id: 'avtr_broken',
                releaseStatus: 'public'
            })
        ).resolves.toBe(false);

        await expect(
            cacheAvatarDetails({
                id: 'avtr_broken',
                name: 'Broken Avatar',
                releaseStatus: 'public'
            })
        ).resolves.toBe(false);

        expect(avatarCacheRepository.addAvatarToCache).not.toHaveBeenCalled();
    });
});
