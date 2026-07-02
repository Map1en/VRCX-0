import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    recordGameRuntimePresence: vi.fn()
}));

vi.mock('./domainIngestionService', () => ({
    recordGameRuntimePresence: mocks.recordGameRuntimePresence
}));

async function loadGameLogService() {
    vi.resetModules();
    const [service, runtimeStore] = await Promise.all([
        import('./gameLogIngestService'),
        import('@/state/runtimeStore')
    ]);

    runtimeStore.useRuntimeStore.getState().resetRuntimeState();

    return {
        service,
        useRuntimeStore: runtimeStore.useRuntimeStore
    };
}

describe('gameLogIngestService characterization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('applies runtime projections while ignoring empty players', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();

        service.applyRuntimeGameLogProjection({
            currentLocation: 'wrld_test:123',
            currentWorldId: 'wrld_test',
            currentWorldName: 'Test World',
            currentLocationStartedAt: '2026-05-14T00:00:00.000Z',
            lastGameLogAt: '2026-05-14T00:00:01.000Z',
            lastGameLogType: 'location',
            currentLocationPlayers: [
                {},
                {
                    displayName: 'Name Only',
                    joinTimeMs: 1_768_348_800_000
                },
                {
                    userId: 'usr_1',
                    displayName: 'Known User',
                    joinTimeMs: 1_768_348_801_000
                }
            ]
        });

        const gameState = useRuntimeStore.getState().gameState;
        expect(gameState).toMatchObject({
            currentLocation: 'wrld_test:123',
            currentWorldId: 'wrld_test',
            currentWorldName: 'Test World',
            currentLocationStartedAt: '2026-05-14T00:00:00.000Z',
            currentLocationPlayerIds: ['usr_1'],
            lastGameLogAt: '2026-05-14T00:00:01.000Z',
            lastGameLogType: 'location'
        });
        expect(gameState.currentLocationPlayers).toEqual([
            expect.objectContaining({
                id: 'display:Name Only',
                displayName: 'Name Only',
                joinedAtMs: 1_768_348_800_000
            }),
            expect.objectContaining({
                id: 'usr_1',
                userId: 'usr_1',
                displayName: 'Known User',
                joinedAtMs: 1_768_348_801_000
            })
        ]);
        expect(mocks.recordGameRuntimePresence).toHaveBeenCalledWith(
            expect.objectContaining({
                currentLocation: 'wrld_test:123',
                currentWorldName: 'Test World'
            })
        );
    });

    it('replaces the roster on each projection instead of merging', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();

        service.applyRuntimeGameLogProjection({
            currentLocation: 'wrld_test:123',
            currentLocationPlayers: [{ userId: 'usr_1', displayName: 'First' }]
        });
        service.applyRuntimeGameLogProjection({
            currentLocation: 'wrld_test:123',
            currentLocationPlayers: [{ userId: 'usr_2', displayName: 'Second' }]
        });

        expect(
            useRuntimeStore.getState().gameState.currentLocationPlayerIds
        ).toEqual(['usr_2']);
    });

    it('resets session state and now-playing on game stop', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();
        service.applyRuntimeGameLogProjection({
            currentLocation: 'wrld_test:123',
            currentWorldId: 'wrld_test',
            currentWorldName: 'Test World',
            currentLocationStartedAt: '2026-05-14T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    userId: 'usr_1',
                    displayName: 'Known User',
                    joinTimeMs: Date.parse('2026-05-14T00:01:00.000Z')
                }
            ]
        });
        useRuntimeStore.getState().setNowPlayingState({
            url: 'https://video.example.test',
            name: 'Some Video'
        });

        service.resetGameLogSessionState('2026-05-14T00:03:00.000Z');

        expect(useRuntimeStore.getState().nowPlaying).toMatchObject({
            url: '',
            name: ''
        });
        expect(useRuntimeStore.getState().gameState).toMatchObject({
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentLocationStartedAt: null,
            currentLocationPlayerIds: [],
            currentLocationPlayers: [],
            lastGameLogAt: '2026-05-14T00:03:00.000Z',
            lastGameLogType: 'game-stopped'
        });
    });
});
