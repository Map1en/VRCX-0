import { beforeEach, describe, expect, it, vi } from 'vitest';

const AVATAR_ID = 'avtr_00000000-0000-0000-0000-000000000001';
const WORLD_ID = 'wrld_00000000-0000-0000-0000-000000000002';
const USER_ID = 'usr_00000000-0000-0000-0000-000000000003';

const mocks = vi.hoisted(() => ({
    addAvatarToCache: vi.fn(),
    getAvatarProfile: vi.fn(),
    addAvatarToFavorites: vi.fn(),
    addWorldToFavorites: vi.fn(),
    addFriendToLocalFavorites: vi.fn(),
    addWorldToCache: vi.fn(),
    getUserProfile: vi.fn(),
    addFavorite: vi.fn(),
    getWorldProfile: vi.fn(),
    bootstrapFavorites: vi.fn(),
    translate: vi.fn()
}));

vi.mock('@/repositories/avatarCacheRepository', () => ({
    default: {
        addAvatarToCache: mocks.addAvatarToCache
    }
}));

vi.mock('@/repositories/avatarProfileRepository', () => ({
    default: {
        getAvatarProfile: mocks.getAvatarProfile
    }
}));

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: {
        addAvatarToFavorites: mocks.addAvatarToFavorites,
        addWorldToFavorites: mocks.addWorldToFavorites,
        addFriendToLocalFavorites: mocks.addFriendToLocalFavorites,
        addWorldToCache: mocks.addWorldToCache
    }
}));

vi.mock('@/repositories/userProfileRepository', () => ({
    default: {
        getUserProfile: mocks.getUserProfile
    }
}));

vi.mock('@/repositories/vrchatFavoriteRepository', () => ({
    default: {
        addFavorite: mocks.addFavorite
    }
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: {
        getWorldProfile: mocks.getWorldProfile
    }
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: mocks.translate
    }
}));

vi.mock('./favoriteBootstrapService', () => ({
    bootstrapFavorites: mocks.bootstrapFavorites
}));

describe('favoriteImportService parsing and validation', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { useNotificationStore } =
            await import('@/state/notificationStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');

        useFavoriteImportStore.getState().resetImportState();
        useFavoriteImportStore.getState().closeDialog();
        useFavoriteStore.getState().resetFavorites();
        useNotificationStore.getState().resetNotificationState();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test',
            currentUserSnapshot: { id: 'usr_self' }
        });

        mocks.getAvatarProfile.mockResolvedValue({
            id: AVATAR_ID,
            name: 'Avatar'
        });
        mocks.getWorldProfile.mockResolvedValue({
            id: WORLD_ID,
            name: 'World',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z'
        });
        mocks.getUserProfile.mockResolvedValue({
            id: USER_ID,
            displayName: 'Friend'
        });
        mocks.addAvatarToCache.mockResolvedValue(undefined);
        mocks.addWorldToCache.mockResolvedValue(undefined);
        mocks.addAvatarToFavorites.mockResolvedValue(undefined);
        mocks.addWorldToFavorites.mockResolvedValue(undefined);
        mocks.addFriendToLocalFavorites.mockResolvedValue(undefined);
        mocks.addFavorite.mockResolvedValue(undefined);
        mocks.bootstrapFavorites.mockResolvedValue(undefined);
        mocks.translate.mockImplementation((_key: string, params?: unknown) =>
            params && typeof params === 'object' && 'value' in params
                ? String(params.value)
                : 'translated'
        );
    });

    it('extracts and deduplicates avatar ids before resolving profiles', async () => {
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { processFavoriteImportList } =
            await import('./favoriteImportService');
        useFavoriteImportStore.getState().openDialog({
            type: 'avatar',
            input: `${AVATAR_ID}\n${AVATAR_ID}\nnot-an-id`
        });

        await processFavoriteImportList();

        expect(mocks.getAvatarProfile).toHaveBeenCalledTimes(1);
        expect(mocks.getAvatarProfile).toHaveBeenCalledWith({
            avatarId: AVATAR_ID,
            endpoint: 'https://api.example.test'
        });
        expect(mocks.addAvatarToCache).toHaveBeenCalledWith({
            id: AVATAR_ID,
            name: 'Avatar'
        });
        expect(useFavoriteImportStore.getState()).toMatchObject({
            loading: false,
            progress: 0,
            progressTotal: 0,
            errors: '',
            rows: [
                {
                    id: AVATAR_ID,
                    name: 'Avatar'
                }
            ]
        });
    });

    it('uses the selected favorite type config and rejects unsupported dialog types', async () => {
        const { getFavoriteImportTypeConfig, openFavoriteImportDialog } =
            await import('./favoriteImportService');

        expect(getFavoriteImportTypeConfig('avatar')).toMatchObject({
            label: 'Avatar'
        });
        expect(getFavoriteImportTypeConfig('world')).toMatchObject({
            label: 'World'
        });
        expect(getFavoriteImportTypeConfig('friend')).toMatchObject({
            label: 'Friend'
        });
        expect(getFavoriteImportTypeConfig('bad')).toBeNull();
        expect(() =>
            openFavoriteImportDialog({ type: 'bad', input: AVATAR_ID })
        ).toThrow('Unsupported favorite import type: bad');
    });

    it('blocks local imports when the item is already in the selected local group', async () => {
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { importFavoriteImportRows } =
            await import('./favoriteImportService');
        useFavoriteStore.getState().setFavoritesSnapshot({
            localAvatarFavoriteGroups: ['Avatars'],
            localAvatarFavorites: {
                Avatars: [AVATAR_ID]
            },
            localAvatarFavoritesList: [AVATAR_ID]
        });
        useFavoriteImportStore.getState().openDialog({
            type: 'avatar',
            input: ''
        });
        useFavoriteImportStore.getState().setRows([
            {
                id: AVATAR_ID,
                name: 'Avatar'
            }
        ]);
        useFavoriteImportStore.getState().setLocalGroupName('Avatars');

        await importFavoriteImportRows();

        expect(mocks.addAvatarToFavorites).not.toHaveBeenCalled();
        expect(useFavoriteImportStore.getState().rows).toEqual([
            {
                id: AVATAR_ID,
                name: 'Avatar'
            }
        ]);
        expect(useFavoriteImportStore.getState().errors).toContain(
            'Avatar is already in local favorites.'
        );
        expect(useFavoriteImportStore.getState()).toMatchObject({
            loading: false,
            importProgress: 0,
            importProgressTotal: 0
        });
    });

    it('imports remote favorites and refreshes the authenticated favorite snapshot', async () => {
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { importFavoriteImportRows } =
            await import('./favoriteImportService');
        useFavoriteStore.getState().setFavoritesSnapshot({
            favoriteAvatarGroups: [
                {
                    name: 'avatars1',
                    type: 'avatar',
                    displayName: 'Avatars'
                }
            ],
            remoteFavoritesByObjectId: {}
        });
        useFavoriteImportStore.getState().openDialog({
            type: 'avatar',
            input: ''
        });
        useFavoriteImportStore.getState().setRows([
            {
                id: AVATAR_ID,
                name: 'Avatar'
            }
        ]);
        useFavoriteImportStore.getState().setRemoteGroupName('avatars1');

        await importFavoriteImportRows();

        expect(mocks.addFavorite).toHaveBeenCalledWith({
            endpoint: 'https://api.example.test',
            type: 'avatar',
            favoriteId: AVATAR_ID,
            tags: 'avatars1'
        });
        expect(mocks.bootstrapFavorites).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            currentUserSnapshot: { id: 'usr_self' }
        });
        expect(useFavoriteImportStore.getState().rows).toEqual([]);
    });
});
