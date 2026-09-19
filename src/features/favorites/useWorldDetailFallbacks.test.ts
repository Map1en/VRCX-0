// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

import {
    filterRemoteEntityCacheFallbacksById,
    loadRemoteEntityCacheFallbacksById
} from './remoteEntityCacheFallbacks';
import {
    getWorldDetailFallbackIds,
    useWorldDetailFallbacks
} from './useWorldDetailFallbacks';

const fetchWorldById = (worldId: string) =>
    worldProfileRepository.getWorldProfile({ worldId, dialog: true });

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: {
        getWorldProfile: vi.fn()
    }
}));

function cachedWorld(
    id: string,
    name: string,
    releaseStatus = 'private'
): WorldProfileRecord {
    return {
        id,
        authorId: 'usr_author',
        authorName: 'Cache Author',
        capacity: 0,
        created_at: '2026-06-01T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        description: 'Cached description',
        favorites: 0,
        heat: 0,
        imageUrl: 'https://example.test/image.png',
        isLabs: false,
        name,
        occupants: 0,
        platforms: [],
        popularity: 0,
        publicationDate: null,
        recommendedCapacity: 0,
        releaseStatus,
        tags: [],
        thumbnailImageUrl: 'https://example.test/thumb.png',
        updated_at: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        version: 1,
        visits: 0
    };
}

function emptyWorld(id: string): WorldProfileRecord {
    return {
        ...cachedWorld(id, '', ''),
        authorId: '',
        authorName: '',
        createdAt: '',
        description: '',
        imageUrl: '',
        thumbnailImageUrl: '',
        updatedAt: '',
        version: 0
    };
}

describe('world detail fallback helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useFavoriteRevisionStore.setState({ worldDetailsRevision: 0 });
    });

    it('reloads visible fallback details when world details are invalidated', async () => {
        vi.mocked(worldProfileRepository.getWorldProfile).mockResolvedValue(
            cachedWorld('wrld_local', 'Local World')
        );

        const { result, unmount } = renderHook(() =>
            useWorldDetailFallbacks({
                worldIds: ['wrld_local'],
                kind: 'world',
                remoteEntityDetailsStatus: 'ready'
            })
        );

        await waitFor(() => {
            expect(result.current).toHaveProperty('wrld_local');
            expect(
                worldProfileRepository.getWorldProfile
            ).toHaveBeenCalledTimes(1);
        });

        act(() => {
            useFavoriteRevisionStore.getState().bumpWorldDetailsRevision();
        });

        await waitFor(() => {
            expect(
                worldProfileRepository.getWorldProfile
            ).toHaveBeenCalledTimes(2);
        });
        unmount();
    });

    it('only asks Rust for worlds with no hydrated remote detail', async () => {
        const fallbackIds = getWorldDetailFallbackIds({
            worldIds: [
                'wrld_remote',
                'wrld_fact',
                'wrld_local',
                'wrld_missing'
            ],
            kind: 'world',
            remoteEntityDetailsData: {
                wrld_remote: { name: 'Remote World' }
            },
            remoteEntityDetailsStatus: 'ready'
        });

        vi.mocked(worldProfileRepository.getWorldProfile).mockResolvedValue(
            cachedWorld('wrld_missing', 'DB Missing World')
        );

        const fallbacks = await loadRemoteEntityCacheFallbacksById(
            fallbackIds,
            fetchWorldById
        );

        expect(fallbackIds).toEqual([
            'wrld_fact',
            'wrld_local',
            'wrld_missing'
        ]);
        expect(worldProfileRepository.getWorldProfile).toHaveBeenCalledTimes(3);
        expect(worldProfileRepository.getWorldProfile).toHaveBeenCalledWith({
            worldId: 'wrld_missing',
            dialog: true
        });
        expect(fallbacks).toMatchObject({
            wrld_missing: {
                name: 'DB Missing World',
                releaseStatus: 'private'
            }
        });
    });

    it('requests missing local favorite worlds through the same domain getter', () => {
        expect(
            getWorldDetailFallbackIds({
                worldIds: ['wrld_remote', 'wrld_local'],
                kind: 'world',
                remoteEntityDetailsData: {
                    wrld_remote: { name: 'Already Loaded' }
                },
                remoteEntityDetailsStatus: 'ready'
            })
        ).toEqual(['wrld_local']);
    });

    it('ignores empty cache shells returned from cache_world', async () => {
        vi.mocked(worldProfileRepository.getWorldProfile).mockImplementation(
            async ({ worldId }) => {
                if (worldId === 'wrld_cached') {
                    return cachedWorld('wrld_cached', 'Cached World', 'public');
                }
                if (worldId === 'wrld_shell') {
                    return emptyWorld('wrld_shell');
                }
                throw new Error('World not found');
            }
        );

        const fallbacks = await loadRemoteEntityCacheFallbacksById(
            ['wrld_cached', 'wrld_shell', 'wrld_missing'],
            fetchWorldById
        );

        expect(fallbacks).toMatchObject({
            wrld_cached: {
                name: 'Cached World',
                releaseStatus: 'public'
            }
        });
        expect(fallbacks).not.toHaveProperty('wrld_shell');
        expect(fallbacks).not.toHaveProperty('wrld_missing');
    });

    it('filters stale fallback rows when the current favorite ids change', () => {
        const fallbacks = filterRemoteEntityCacheFallbacksById(
            {
                wrld_old: cachedWorld('wrld_old', 'Old World'),
                wrld_new: cachedWorld('wrld_new', 'New World')
            },
            ['wrld_new']
        );

        expect(fallbacks).toMatchObject({
            wrld_new: {
                name: 'New World'
            }
        });
        expect(fallbacks).not.toHaveProperty('wrld_old');
    });

    it('does not search cache_world before remote world details are ready', () => {
        expect(
            getWorldDetailFallbackIds({
                worldIds: ['wrld_pending'],
                kind: 'world',
                remoteEntityDetailsStatus: 'running'
            })
        ).toEqual([]);
    });
});
