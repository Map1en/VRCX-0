import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    LocalFavoriteGroup,
    LocalFavoriteSnapshot
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appFavoriteLocalSnapshot: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteLocalSnapshot: mocks.appFavoriteLocalSnapshot
    }
}));

const EMPTY_SNAPSHOT: LocalFavoriteSnapshot = {
    favorites: [],
    groups: []
};

function group(
    id: number,
    name: string,
    kind: LocalFavoriteGroup['kind'] = 'avatar'
): LocalFavoriteGroup {
    return { id, kind, name, shared: false };
}

describe('favoriteLocalRefreshService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        useFavoriteStore.getState().resetFavorites();

        mocks.appFavoriteLocalSnapshot.mockResolvedValue(EMPTY_SNAPSHOT);
    });

    it('leaves local world favorites out of the frontend store refresh path', async () => {
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['world']);

        expect(mocks.appFavoriteLocalSnapshot).not.toHaveBeenCalled();
    });

    it('deduplicates repeated kinds and refreshes each requested kind once', async () => {
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['avatar', 'avatar', 'friend']);

        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledTimes(2);
        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledWith('avatar');
        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledWith('friend');
    });

    it('keeps the backend group order and lists the newest favorites first', async () => {
        mocks.appFavoriteLocalSnapshot.mockResolvedValueOnce({
            favorites: [
                {
                    createdAt: '2026-01-01',
                    avatarId: 'avtr_1',
                    groupId: 2,
                    groupName: 'B'
                },
                {
                    createdAt: '2026-01-02',
                    avatarId: 'avtr_2',
                    groupId: 2,
                    groupName: 'B'
                }
            ],
            groups: [group(2, 'B'), group(1, 'A')]
        } satisfies LocalFavoriteSnapshot);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['avatar']);

        const state = useFavoriteStore.getState();
        expect(state.localAvatarFavoriteGroups).toEqual([
            group(2, 'B'),
            group(1, 'A')
        ]);
        expect(state.localAvatarFavorites).toEqual({
            1: [],
            2: ['avtr_2', 'avtr_1']
        });
    });

    it('keeps the newest result when same-kind refreshes finish out of order', async () => {
        let resolveFirst: (snapshot: LocalFavoriteSnapshot) => void = () =>
            undefined;
        mocks.appFavoriteLocalSnapshot
            .mockImplementationOnce(
                () =>
                    new Promise<LocalFavoriteSnapshot>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce({
                favorites: [
                    {
                        createdAt: '2026-01-02',
                        avatarId: 'avtr_new',
                        groupId: 2,
                        groupName: 'New'
                    }
                ],
                groups: [group(2, 'New')]
            } satisfies LocalFavoriteSnapshot);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        const first = refreshLocalFavoritesForKinds(['avatar']);
        await refreshLocalFavoritesForKinds(['avatar']);
        resolveFirst({
            favorites: [
                {
                    createdAt: '2026-01-01',
                    avatarId: 'avtr_old',
                    groupId: 1,
                    groupName: 'Old'
                }
            ],
            groups: [group(1, 'Old')]
        });
        await first;

        expect(useFavoriteStore.getState().localAvatarFavorites).toEqual({
            2: ['avtr_new']
        });
    });

    it('drops a completed read after the favorite owner changes', async () => {
        let resolveSnapshot: (snapshot: LocalFavoriteSnapshot) => void = () =>
            undefined;
        mocks.appFavoriteLocalSnapshot.mockImplementationOnce(
            () =>
                new Promise<LocalFavoriteSnapshot>((resolve) => {
                    resolveSnapshot = resolve;
                })
        );
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');
        useFavoriteStore.getState().setFavoritesLoading('usr_old');

        const refresh = refreshLocalFavoritesForKinds(['friend']);
        useFavoriteStore.getState().setFavoritesLoading('usr_new');
        resolveSnapshot({
            favorites: [
                {
                    createdAt: '2026-01-01',
                    userId: 'usr_friend',
                    groupId: 1,
                    groupName: 'Friends'
                }
            ],
            groups: [group(1, 'Friends', 'friend')]
        });
        await refresh;

        const state = useFavoriteStore.getState();
        expect(state.currentUserId).toBe('usr_new');
        expect(state.localFriendFavorites).toEqual({});
    });
});
