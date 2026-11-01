import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    hydrateRuntimeGameLogProjection: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('./gameLogIngestService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./gameLogIngestService')>()),
    hydrateRuntimeGameLogProjection: mocks.hydrateRuntimeGameLogProjection
}));

async function loadService() {
    vi.resetModules();
    const [service, runtimeStore] = await Promise.all([
        import('./gameIsolationService'),
        import('@/state/runtimeStore')
    ]);
    runtimeStore.useRuntimeStore.getState().resetRuntimeState();
    return { service, useRuntimeStore: runtimeStore.useRuntimeStore };
}

describe('gameIsolationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.hydrateRuntimeGameLogProjection.mockResolvedValue(true);
    });

    it('clears the local game room once the account is isolated', async () => {
        const { service, useRuntimeStore } = await loadService();
        useRuntimeStore.getState().setGameState({
            currentLocation: 'wrld_alt:1',
            currentWorldId: 'wrld_alt',
            currentLocationPlayerIds: ['usr_friend']
        });

        service.applyGameIsolationSnapshot({
            revision: 1,
            enabled: true,
            localGameAccount: null
        });

        expect(useRuntimeStore.getState().gameIsolation.enabled).toBe(true);
        expect(useRuntimeStore.getState().gameState).toMatchObject({
            currentLocation: '',
            currentWorldId: '',
            currentLocationPlayerIds: []
        });
        expect(mocks.hydrateRuntimeGameLogProjection).not.toHaveBeenCalled();
    });

    it('brings the local game room back when isolation ends', async () => {
        const { service, useRuntimeStore } = await loadService();
        service.applyGameIsolationSnapshot({
            revision: 1,
            enabled: true,
            localGameAccount: null
        });

        service.applyGameIsolationSnapshot({
            revision: 2,
            enabled: false,
            localGameAccount: null
        });

        expect(useRuntimeStore.getState().gameIsolation.enabled).toBe(false);
        expect(mocks.hydrateRuntimeGameLogProjection).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale snapshot and a repeated state', async () => {
        const { service, useRuntimeStore } = await loadService();
        useRuntimeStore.getState().setGameState({
            currentLocation: 'wrld_main:1'
        });
        service.applyGameIsolationSnapshot({
            revision: 3,
            enabled: false,
            localGameAccount: null
        });
        service.applyGameIsolationSnapshot({
            revision: 2,
            enabled: true,
            localGameAccount: null
        });

        expect(useRuntimeStore.getState().gameIsolation).toEqual({
            revision: 3,
            enabled: false,
            localGameAccount: null
        });
        expect(useRuntimeStore.getState().gameState.currentLocation).toBe(
            'wrld_main:1'
        );
        expect(mocks.hydrateRuntimeGameLogProjection).not.toHaveBeenCalled();
    });
});
