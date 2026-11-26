import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appFavoriteLocalSnapshot: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteLocalSnapshot: mocks.appFavoriteLocalSnapshot
    }
}));

import { loadLocalWorldFavoritesSnapshot } from './localWorldFavoritesService';

function worldGroup(id: number, name: string) {
    return { id, kind: 'world' as const, name, shared: false };
}

function worldRow(worldId: string, groupId: number, createdAt: string) {
    return {
        createdAt,
        worldId,
        avatarId: null,
        userId: null,
        groupId,
        groupName: ''
    };
}

describe('localWorldFavoritesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.appFavoriteLocalSnapshot.mockResolvedValue({
            favorites: [],
            groups: []
        });
    });

    it('builds a fresh grouped snapshot keyed by group id', async () => {
        const groups = [worldGroup(1, 'Empty'), worldGroup(2, 'Worlds')];
        mocks.appFavoriteLocalSnapshot.mockResolvedValue({
            groups,
            favorites: [
                worldRow('wrld_1', 2, '2026-08-11T00:00:00Z'),
                worldRow('wrld_2', 2, '2026-08-11T00:00:01Z'),
                worldRow('wrld_1', 2, '2026-08-11T00:00:02Z')
            ]
        });

        await expect(loadLocalWorldFavoritesSnapshot()).resolves.toEqual({
            favoritesByGroup: {
                1: [],
                2: ['wrld_2', 'wrld_1']
            },
            groups
        });
        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledWith('world');
    });

    it('keeps the backend group order instead of sorting by name', async () => {
        const groups = [
            worldGroup(3, 'Zeta'),
            worldGroup(1, '2024'),
            worldGroup(2, 'Alpha')
        ];
        mocks.appFavoriteLocalSnapshot.mockResolvedValue({
            groups,
            favorites: []
        });

        await expect(loadLocalWorldFavoritesSnapshot()).resolves.toMatchObject({
            groups
        });
    });
});
