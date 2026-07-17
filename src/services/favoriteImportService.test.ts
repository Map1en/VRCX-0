import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    FavoriteImportStartInput,
    FavoriteImportStatus
} from '@/platform/tauri/bindings';

const AVATAR_ID = 'avtr_00000000-0000-0000-0000-000000000001';

const mocks = vi.hoisted(() => ({
    favoriteImportStart: vi.fn(),
    favoriteImportStatus: vi.fn(),
    favoriteImportCancel: vi.fn(),
    bootstrapFavorites: vi.fn(),
    translate: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteImportStart: mocks.favoriteImportStart,
        appFavoriteImportStatus: mocks.favoriteImportStatus,
        appFavoriteImportCancel: mocks.favoriteImportCancel
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

function completedStatus(
    input: FavoriteImportStartInput,
    options: {
        succeeded?: number;
        failed?: number;
        message?: string;
    } = {}
): FavoriteImportStatus {
    const succeeded = options.succeeded ?? input.ids?.length ?? 0;
    const failed = options.failed ?? 0;
    return {
        runId: 'favorite-test-1',
        status: 'completed',
        operation: input.operation,
        kind: input.kind,
        authScopeGeneration: 1,
        total: input.ids?.length ?? 0,
        processed: input.ids?.length ?? 0,
        succeeded,
        failed,
        cancelRequested: false,
        items: (input.ids ?? []).map((id, index) => ({
            id,
            state: index < succeeded ? 'succeeded' : 'failed',
            message: index < succeeded ? '' : options.message || 'failed',
            entity:
                input.operation === 'hydrate' && index < succeeded
                    ? { id, name: 'Avatar' }
                    : null
        })),
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:00:01Z',
        lastError: failed ? options.message || 'failed' : null
    };
}

describe('favoriteImportService typed worker adapter', () => {
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

        mocks.favoriteImportStart.mockImplementation(
            async (input: FavoriteImportStartInput) => completedStatus(input)
        );
        mocks.favoriteImportStatus.mockResolvedValue(
            completedStatus({
                kind: 'avatar',
                operation: 'hydrate',
                ids: [],
                target: null
            })
        );
        mocks.favoriteImportCancel.mockResolvedValue(
            completedStatus({
                kind: 'avatar',
                operation: 'hydrate',
                ids: [],
                target: null
            })
        );
        mocks.bootstrapFavorites.mockResolvedValue(undefined);
        mocks.translate.mockImplementation((_key: string, params?: unknown) =>
            params && typeof params === 'object' && 'value' in params
                ? String(params.value)
                : 'translated'
        );
    });

    it('extracts and deduplicates ids before starting backend hydration', async () => {
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { processFavoriteImportList } =
            await import('./favoriteImportService');
        useFavoriteImportStore.getState().openDialog({
            type: 'avatar',
            input: `${AVATAR_ID}\n${AVATAR_ID}\nnot-an-id`
        });

        await processFavoriteImportList();

        expect(mocks.favoriteImportStart).toHaveBeenCalledWith({
            kind: 'avatar',
            operation: 'hydrate',
            ids: [AVATAR_ID],
            target: null
        });
        expect(useFavoriteImportStore.getState()).toMatchObject({
            loading: false,
            errors: '',
            rows: [{ id: AVATAR_ID, name: 'Avatar' }]
        });
    });

    it('keeps type parsing and unsupported dialog validation on the frontend', async () => {
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

    it('shows backend local duplicate failures without removing the preview row', async () => {
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { importFavoriteImportRows } =
            await import('./favoriteImportService');
        mocks.favoriteImportStart.mockImplementation(
            async (input: FavoriteImportStartInput) =>
                completedStatus(input, {
                    succeeded: 0,
                    failed: 1,
                    message: 'Avatar is already in local favorites.'
                })
        );
        useFavoriteImportStore.getState().openDialog({ type: 'avatar' });
        useFavoriteImportStore
            .getState()
            .setRows([{ id: AVATAR_ID, name: 'Avatar' }]);
        useFavoriteImportStore.getState().setLocalGroupName('Avatars');

        await importFavoriteImportRows();

        expect(mocks.favoriteImportStart).toHaveBeenCalledWith({
            kind: 'avatar',
            operation: 'import',
            ids: [AVATAR_ID],
            target: {
                location: 'local',
                group: 'Avatars',
                favoriteType: ''
            }
        });
        expect(useFavoriteImportStore.getState().rows).toHaveLength(1);
        expect(useFavoriteImportStore.getState().errors).toContain(
            'Avatar is already in local favorites.'
        );
    });

    it('passes the selected remote group to Rust and refreshes after success', async () => {
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
            ]
        });
        useFavoriteImportStore.getState().openDialog({ type: 'avatar' });
        useFavoriteImportStore
            .getState()
            .setRows([{ id: AVATAR_ID, name: 'Avatar' }]);
        useFavoriteImportStore.getState().setRemoteGroupName('avatars1');

        await importFavoriteImportRows();

        expect(mocks.favoriteImportStart).toHaveBeenCalledWith({
            kind: 'avatar',
            operation: 'import',
            ids: [AVATAR_ID],
            target: {
                location: 'remote',
                group: 'avatars1',
                favoriteType: 'avatar'
            }
        });
        expect(mocks.bootstrapFavorites).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            currentUserSnapshot: { id: 'usr_self' }
        });
        expect(useFavoriteImportStore.getState().rows).toEqual([]);
    });

    it('keeps typed start failures inside the active dialog error list', async () => {
        const { useFavoriteImportStore } =
            await import('@/state/favoriteImportStore');
        const { processFavoriteImportList } =
            await import('./favoriteImportService');
        mocks.favoriteImportStart.mockRejectedValue(
            new Error('Authenticated session changed.')
        );
        useFavoriteImportStore.getState().openDialog({
            type: 'avatar',
            input: AVATAR_ID
        });

        await processFavoriteImportList();

        expect(useFavoriteImportStore.getState().errors).toContain(
            'Authenticated session changed.'
        );
        expect(useFavoriteImportStore.getState().loading).toBe(false);
    });
});
