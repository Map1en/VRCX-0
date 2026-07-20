import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appSocialFavoritesBaselineGet: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSocialFavoritesBaselineGet: mocks.appSocialFavoritesBaselineGet
    }
}));

vi.mock('./startupServicesStatus', () => ({
    syncStartupServicesTask: mocks.syncStartupServicesTask
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

function baseline(detail: string, overrides: Record<string, unknown> = {}) {
    return {
        stale: false,
        count: 1,
        snapshot: {
            currentUserId: 'usr_self',
            detail,
            remoteFavoritesById: {}
        },
        ...overrides
    };
}

const endpoint = 'https://api.example.test/api/1';
const options = {
    userId: 'usr_self',
    endpoint,
    currentUserSnapshot: {
        id: 'usr_self',
        displayName: 'Self'
    }
};

describe('favoriteBootstrapService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.appSocialFavoritesBaselineGet.mockReset();

        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');

        useFavoriteStore.getState().resetFavorites();
        useFriendRosterStore.getState().resetRoster();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: endpoint,
            currentUserSnapshot: options.currentUserSnapshot
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });
        mocks.appSocialFavoritesBaselineGet.mockResolvedValue(
            baseline('loaded')
        );
    });

    it('deduplicates hydration within an active session', async () => {
        const pending = deferred<ReturnType<typeof baseline>>();
        mocks.appSocialFavoritesBaselineGet.mockReturnValue(pending.promise);
        const { bootstrapFavorites } =
            await import('./favoriteBootstrapService');

        const first = bootstrapFavorites(options);
        const second = bootstrapFavorites(options);

        expect(second).toBe(first);
        expect(mocks.appSocialFavoritesBaselineGet).toHaveBeenCalledTimes(1);
        pending.resolve(baseline('deduplicated'));

        await expect(first).resolves.toEqual({
            userId: 'usr_self',
            stale: false,
            count: 1
        });

        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        expect(useFavoriteStore.getState()).toMatchObject({
            currentUserId: 'usr_self',
            loadStatus: 'ready',
            detail: 'deduplicated'
        });
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(true);
        expect(mocks.syncStartupServicesTask).toHaveBeenCalledWith([
            'deduplicated'
        ]);
    });

    it.each([
        {
            name: 'account',
            auth: {
                currentUserId: 'usr_other',
                currentUserEndpoint: endpoint
            }
        },
        {
            name: 'endpoint',
            auth: {
                currentUserId: 'usr_self',
                currentUserEndpoint: 'https://other.example.test/api/1'
            }
        }
    ])('drops a result made stale by an $name change', async ({ auth }) => {
        const pending = deferred<ReturnType<typeof baseline>>();
        mocks.appSocialFavoritesBaselineGet.mockReturnValue(pending.promise);
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { bootstrapFavorites } =
            await import('./favoriteBootstrapService');

        const run = bootstrapFavorites(options);
        useRuntimeStore.getState().setAuthBootstrap(auth);
        pending.resolve(baseline('obsolete', { count: 4 }));

        await expect(run).resolves.toEqual({
            userId: 'usr_self',
            stale: true,
            count: 4
        });

        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        expect(useFavoriteStore.getState().loadStatus).toBe('running');
        expect(useFavoriteStore.getState().detail).not.toBe('obsolete');
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(false);
        expect(mocks.syncStartupServicesTask).not.toHaveBeenCalled();
    });

    it('isolates hydration across same-account login generations', async () => {
        const oldGeneration = deferred<ReturnType<typeof baseline>>();
        const newGeneration = deferred<ReturnType<typeof baseline>>();
        mocks.appSocialFavoritesBaselineGet
            .mockReturnValueOnce(oldGeneration.promise)
            .mockReturnValueOnce(newGeneration.promise);
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFavorites } =
            await import('./favoriteBootstrapService');

        const oldRun = bootstrapFavorites(options);
        useSessionStore.getState().setSessionState({
            isLoggedIn: false,
            sessionPhase: 'signed_out'
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: null,
            currentUserEndpoint: ''
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: endpoint,
            currentUserSnapshot: options.currentUserSnapshot
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });
        const newRun = bootstrapFavorites(options);

        oldGeneration.resolve(baseline('old generation'));
        await expect(oldRun).resolves.toMatchObject({ stale: true });

        newGeneration.resolve(baseline('new generation'));
        await expect(newRun).resolves.toEqual({
            userId: 'usr_self',
            stale: false,
            count: 1
        });

        const { useFavoriteStore } = await import('@/state/favoriteStore');
        expect(newRun).not.toBe(oldRun);
        expect(mocks.appSocialFavoritesBaselineGet).toHaveBeenCalledTimes(2);
        expect(useFavoriteStore.getState()).toMatchObject({
            loadStatus: 'ready',
            detail: 'new generation'
        });
    });

    it.each([
        {
            name: 'stale',
            result: baseline('stale', { stale: true })
        },
        {
            name: 'null snapshot',
            result: baseline('missing', { snapshot: null })
        }
    ])('records an error for a current $name result', async ({ result }) => {
        mocks.appSocialFavoritesBaselineGet.mockResolvedValue(result);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFavorites } =
            await import('./favoriteBootstrapService');

        await expect(bootstrapFavorites(options)).rejects.toThrow(
            'Favorites baseline was stale for usr_self.'
        );

        expect(useFavoriteStore.getState()).toMatchObject({
            currentUserId: 'usr_self',
            loadStatus: 'error',
            detail: 'Favorites baseline was stale for usr_self.'
        });
        expect(useRuntimeStore.getState().startup.services).toMatchObject({
            status: 'error',
            detail: 'Favorites baseline was stale for usr_self.'
        });
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(false);
        expect(mocks.syncStartupServicesTask).not.toHaveBeenCalled();
    });

    it('records rejection state without interpreting transport errors', async () => {
        const failure = new Error('baseline rejected');
        mocks.appSocialFavoritesBaselineGet.mockRejectedValue(failure);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFavorites } =
            await import('./favoriteBootstrapService');

        await expect(bootstrapFavorites(options)).rejects.toBe(failure);

        expect(useFavoriteStore.getState()).toMatchObject({
            loadStatus: 'error',
            detail: 'baseline rejected'
        });
        expect(useRuntimeStore.getState().startup.services).toMatchObject({
            status: 'error',
            detail: 'baseline rejected'
        });
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(false);
    });

    it('rejects missing identity before hydration starts', async () => {
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { bootstrapFavorites } =
            await import('./favoriteBootstrapService');

        await expect(
            bootstrapFavorites({
                userId: ' ',
                endpoint,
                currentUserSnapshot: null
            })
        ).rejects.toThrow(
            'Favorites hydration requires an authenticated user id.'
        );

        expect(mocks.appSocialFavoritesBaselineGet).not.toHaveBeenCalled();
        expect(useFavoriteStore.getState().loadStatus).toBe('idle');
    });
});
