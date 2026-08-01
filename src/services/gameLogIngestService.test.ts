import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameLogProjection } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appIsGameRunning: vi.fn(),
    loadCurrentInstanceRoster: vi.fn(),
    recordGameRuntimePresence: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appIsGameRunning: mocks.appIsGameRunning
    }
}));

vi.mock('./currentInstanceRosterService', () => ({
    loadCurrentInstanceRoster: mocks.loadCurrentInstanceRoster
}));

vi.mock('./domainIngestionService', () => ({
    recordGameRuntimePresence: mocks.recordGameRuntimePresence
}));

function projection(overrides: Partial<GameLogProjection>): GameLogProjection {
    return {
        currentDestination: '',
        currentLocation: '',
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        currentLocationStartedAt: null,
        currentWorldId: '',
        currentWorldName: '',
        lastGameLogAt: '',
        lastGameLogType: '',
        ...overrides
    };
}

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
        mocks.appIsGameRunning.mockReset();
        mocks.loadCurrentInstanceRoster.mockReset();
        mocks.appIsGameRunning.mockResolvedValue(true);
    });

    it('applies typed runtime projections including display-name-only players', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();

        service.applyRuntimeGameLogProjection(
            projection({
                currentLocation: 'wrld_test:123',
                currentWorldId: 'wrld_test',
                currentWorldName: 'Test World',
                currentLocationStartedAt: '2026-05-14T00:00:00.000Z',
                lastGameLogAt: '2026-05-14T00:00:01.000Z',
                lastGameLogType: 'location',
                currentLocationPlayers: [
                    {
                        userId: '',
                        displayName: 'Name Only',
                        joinTimeMs: 1_768_348_800_000
                    },
                    {
                        userId: 'usr_1',
                        displayName: 'Known User',
                        joinTimeMs: 1_768_348_801_000
                    }
                ]
            })
        );

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

        service.applyRuntimeGameLogProjection(
            projection({
                currentLocation: 'wrld_test:123',
                currentLocationPlayers: [
                    { userId: 'usr_1', displayName: 'First', joinTimeMs: null }
                ]
            })
        );
        service.applyRuntimeGameLogProjection(
            projection({
                currentLocation: 'wrld_test:123',
                currentLocationPlayers: [
                    { userId: 'usr_2', displayName: 'Second', joinTimeMs: null }
                ]
            })
        );

        expect(
            useRuntimeStore.getState().gameState.currentLocationPlayerIds
        ).toEqual(['usr_2']);
    });

    it('restores a historical roster without requiring a frontend location', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            }
        });
        mocks.loadCurrentInstanceRoster.mockResolvedValue({
            context: {
                location: 'wrld_test:123',
                worldId: 'wrld_test',
                worldName: 'Recovered World',
                createdAt: '2026-05-14T00:00:00.000Z'
            },
            players: [
                {
                    userId: '',
                    displayName: 'Name Only',
                    joinedAtMs: 1_768_348_800_000
                }
            ]
        });

        await expect(
            service.restoreRuntimeGameLogProjectionFromPersistence()
        ).resolves.toBe(true);

        expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            currentLocation: '',
            currentLocationStartedAt: ''
        });
        expect(useRuntimeStore.getState().gameState).toMatchObject({
            currentLocation: 'wrld_test:123',
            currentWorldId: 'wrld_test',
            currentWorldName: 'Recovered World',
            currentLocationPlayerIds: [],
            lastGameLogType: 'startup-roster'
        });
        expect(
            useRuntimeStore.getState().gameState.currentLocationPlayers
        ).toEqual([
            expect.objectContaining({
                id: 'display:Name Only',
                displayName: 'Name Only',
                joinedAt: new Date(1_768_348_800_000).toISOString(),
                joinedAtMs: 1_768_348_800_000
            })
        ]);
    });

    it('does not overwrite a newer live location while the roster query is pending', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self'
        });
        let resolveSnapshot!: (
            value: Awaited<
                ReturnType<
                    typeof import('./currentInstanceRosterService').loadCurrentInstanceRoster
                >
            >
        ) => void;
        mocks.loadCurrentInstanceRoster.mockReturnValue(
            new Promise((resolve) => {
                resolveSnapshot = resolve;
            })
        );

        const restore =
            service.restoreRuntimeGameLogProjectionFromPersistence();
        await vi.waitFor(() =>
            expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalled()
        );
        useRuntimeStore.getState().setGameState({
            currentLocation: 'wrld_new:456'
        });
        resolveSnapshot({
            context: {
                location: 'wrld_old:123',
                worldId: 'wrld_old',
                worldName: 'Old World',
                createdAt: '2026-05-14T00:00:00.000Z',
                time: 0,
                groupName: '',
                playerCount: 0,
                source: 'database'
            },
            players: []
        });

        await expect(restore).resolves.toBe(false);
        expect(useRuntimeStore.getState().gameState.currentLocation).toBe(
            'wrld_new:456'
        );
    });

    it('resets session state and now-playing on game stop', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();
        service.applyRuntimeGameLogProjection(
            projection({
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
            })
        );
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
