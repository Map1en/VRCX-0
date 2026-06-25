import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    logWatcherSetDateTill: vi.fn(),
    logWatcherGet: vi.fn(),
    appQuitGame: vi.fn(),
    getBool: vi.fn(),
    initGlobalTables: vi.fn(),
    getLastDateGameLogDatabase: vi.fn(),
    addGamelogLocationToDatabase: vi.fn(),
    addGamelogJoinLeaveToDatabase: vi.fn(),
    addGamelogJoinLeaveBulk: vi.fn(),
    updateGamelogLocationTimeToDatabase: vi.fn(),
    recordGameRuntimePresence: vi.fn(),
    resetRuntimeNowPlayingState: vi.fn(),
    isHostCapabilityAvailable: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        logWatcherSetDateTill: mocks.logWatcherSetDateTill,
        logWatcherGet: mocks.logWatcherGet,
        appQuitGame: mocks.appQuitGame
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool
    }
}));

vi.mock('@/repositories/databaseMaintenanceRepository', () => ({
    default: {
        initGlobalTables: mocks.initGlobalTables
    }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getLastDateGameLogDatabase: mocks.getLastDateGameLogDatabase,
        addGamelogLocationToDatabase: mocks.addGamelogLocationToDatabase,
        addGamelogJoinLeaveToDatabase: mocks.addGamelogJoinLeaveToDatabase,
        addGamelogJoinLeaveBulk: mocks.addGamelogJoinLeaveBulk,
        updateGamelogLocationTimeToDatabase:
            mocks.updateGamelogLocationTimeToDatabase
    }
}));

vi.mock('./domainIngestionService', () => ({
    recordGameRuntimePresence: mocks.recordGameRuntimePresence
}));

vi.mock('./game-log-ingest/instanceMediaSave', () => ({
    enqueueEmojiSave: vi.fn(),
    enqueuePrintSave: vi.fn(),
    enqueueStickerSave: vi.fn()
}));

vi.mock('./game-log-ingest/screenshotMetadata', () => ({
    processScreenshot: vi.fn()
}));

vi.mock('./game-log-ingest/videoPersistence', () => ({
    createVideoEntryWithMetadata: vi.fn(),
    persistProviderVideo: vi.fn(),
    persistVideoEntry: vi.fn(),
    resetRuntimeNowPlayingState: mocks.resetRuntimeNowPlayingState
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
}));

async function loadGameLogService() {
    vi.resetModules();
    const [service, runtimeStore, sessionStore] = await Promise.all([
        import('./gameLogIngestService'),
        import('@/state/runtimeStore'),
        import('@/state/sessionStore')
    ]);

    runtimeStore.useRuntimeStore.getState().resetRuntimeState();
    sessionStore.useSessionStore.getState().resetSessionState();
    service.resetGameLogIngestSessionState();
    service.resetNowPlayingState();

    return {
        service,
        useRuntimeStore: runtimeStore.useRuntimeStore,
        useSessionStore: sessionStore.useSessionStore
    };
}

describe('gameLogIngestService characterization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getBool.mockResolvedValue(false);
        mocks.initGlobalTables.mockResolvedValue(undefined);
        mocks.getLastDateGameLogDatabase.mockResolvedValue(
            '2026-05-01T00:00:00.000Z'
        );
        mocks.logWatcherSetDateTill.mockResolvedValue(undefined);
        mocks.logWatcherGet.mockResolvedValue([]);
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name: string) => name === 'gameLogWatcher'
        );
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

    it('persists location and join/leave runtime log events', async () => {
        const { service, useRuntimeStore } = await loadGameLogService();

        await service.ingestRuntimeGameLogEvent([
            'log',
            '2026-05-14T00:00:00.000Z',
            'location',
            'wrld_test:123',
            'Test World'
        ]);
        await service.ingestRuntimeGameLogEvent([
            'log',
            '2026-05-14T00:01:00.000Z',
            'player-joined',
            'Known User',
            'usr_1'
        ]);
        await service.ingestRuntimeGameLogEvent([
            'log',
            '2026-05-14T00:03:00.000Z',
            'player-left',
            'Known User',
            'usr_1'
        ]);

        expect(mocks.addGamelogLocationToDatabase).toHaveBeenCalledWith(
            expect.objectContaining({
                created_at: '2026-05-14T00:00:00.000Z',
                location: 'wrld_test:123',
                worldId: 'wrld_test',
                worldName: 'Test World'
            })
        );
        expect(mocks.addGamelogJoinLeaveToDatabase).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                type: 'OnPlayerJoined',
                displayName: 'Known User',
                userId: 'usr_1',
                location: 'wrld_test:123'
            })
        );
        expect(mocks.addGamelogJoinLeaveToDatabase).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                type: 'OnPlayerLeft',
                displayName: 'Known User',
                userId: 'usr_1',
                location: 'wrld_test:123',
                time: 120_000
            })
        );
        expect(useRuntimeStore.getState().gameState).toMatchObject({
            currentLocation: 'wrld_test:123',
            currentLocationPlayerIds: [],
            currentLocationPlayers: []
        });
    });

    it('finalizes the current session with synthetic leave rows and duration', async () => {
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

        await service.finalizeCurrentGameLogSession('2026-05-14T00:03:00.000Z');

        expect(mocks.addGamelogJoinLeaveBulk).toHaveBeenCalledWith([
            expect.objectContaining({
                type: 'OnPlayerLeft',
                displayName: 'Known User',
                userId: 'usr_1',
                location: 'wrld_test:123',
                time: 120_000
            })
        ]);
        expect(mocks.updateGamelogLocationTimeToDatabase).toHaveBeenCalledWith({
            created_at: '2026-05-14T00:00:00.000Z',
            time: 180_000
        });
        expect(mocks.resetRuntimeNowPlayingState).toHaveBeenCalled();
        expect(useRuntimeStore.getState().gameState).toMatchObject({
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentLocationStartedAt: null,
            lastGameLogAt: '2026-05-14T00:03:00.000Z',
            lastGameLogType: 'game-stopped'
        });
    });

    it('skips tail sync when logged out or watcher support is unavailable', async () => {
        const { service, useSessionStore } = await loadGameLogService();

        await expect(service.syncGameLogTail()).resolves.toEqual({
            processed: 0,
            skipped: true
        });

        useSessionStore.getState().setLoggedIn(true);
        mocks.isHostCapabilityAvailable.mockReturnValue(false);

        await expect(service.syncGameLogTail()).resolves.toEqual({
            processed: 0,
            skipped: true,
            unavailable: true
        });
    });

    it('lets backend side effects own tail sync when the capability is active', async () => {
        const { service, useRuntimeStore, useSessionStore } =
            await loadGameLogService();
        useSessionStore.getState().setLoggedIn(true);
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name: string) =>
                name === 'gameLogWatcher' ||
                name === 'runtimeGameLogSideEffects'
        );

        await expect(service.syncGameLogTail()).resolves.toEqual({
            processed: 0,
            runtime: true
        });
        expect(useRuntimeStore.getState().updateLoop).toMatchObject({
            lastGameLogSyncDetail: 'Backend GameLog side effects are active.'
        });
        expect(mocks.logWatcherGet).not.toHaveBeenCalled();
    });

    it('processes queued tail rows until the watcher is empty', async () => {
        const { service, useSessionStore } = await loadGameLogService();
        useSessionStore.getState().setLoggedIn(true);
        mocks.logWatcherGet
            .mockResolvedValueOnce([
                [
                    'log',
                    '2026-05-14T00:00:00.000Z',
                    'location',
                    'wrld_test:123',
                    'Test World'
                ],
                [
                    'log',
                    '2026-05-14T00:01:00.000Z',
                    'player-joined',
                    'Known User',
                    'usr_1'
                ]
            ])
            .mockResolvedValueOnce([]);

        await expect(service.syncGameLogTail()).resolves.toEqual({
            processed: 2
        });
        expect(mocks.logWatcherGet).toHaveBeenCalledTimes(2);
        expect(mocks.addGamelogLocationToDatabase).toHaveBeenCalledTimes(1);
        expect(mocks.addGamelogJoinLeaveToDatabase).toHaveBeenCalledTimes(1);
    });

    it('does not consume tail rows when game logs are disabled', async () => {
        const { service, useSessionStore } = await loadGameLogService();
        useSessionStore.getState().setLoggedIn(true);
        mocks.getBool.mockImplementation((key: string) =>
            Promise.resolve(key === 'gameLogDisabled')
        );

        await expect(service.syncGameLogTail()).resolves.toEqual({
            processed: 0,
            disabled: true
        });
        expect(mocks.logWatcherGet).not.toHaveBeenCalled();
    });
});
