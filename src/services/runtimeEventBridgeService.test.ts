import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    subscribe: vi.fn(),
    applyRuntimeGameLogProjection: vi.fn(),
    recordRuntimeGameClientEvent: vi.fn(),
    handleGameRunningUpdate: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    refreshHostCapabilities: vi.fn(),
    handleIpcEvent: vi.fn(),
    pushSharedFeedNotification: vi.fn(),
    showSQLiteErrorDialog: vi.fn(),
    handleBrowserFocus: vi.fn(),
    getBackendRuntimeSnapshot: vi.fn(),
    runtimeGroupInstancesRefresh: vi.fn()
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        app: {
            GetBackendRuntimeSnapshot: mocks.getBackendRuntimeSnapshot,
            RuntimeGroupInstancesRefresh: mocks.runtimeGroupInstancesRefresh
        },
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('./gameLogIngestService', () => ({
    applyRuntimeGameLogProjection: mocks.applyRuntimeGameLogProjection
}));

vi.mock('./gameClientLifecycle', () => ({
    recordRuntimeGameClientEvent: mocks.recordRuntimeGameClientEvent
}));

vi.mock('./gameStateService', () => ({
    handleGameRunningUpdate: mocks.handleGameRunningUpdate
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
}));

vi.mock('./ipcEventService', () => ({
    handleIpcEvent: mocks.handleIpcEvent
}));

vi.mock('./sharedFeedFilterService', () => ({
    pushSharedFeedNotification: mocks.pushSharedFeedNotification
}));

vi.mock('./sqliteErrorDialogService', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

vi.mock('./vrcStatusService', () => ({
    handleBrowserFocus: mocks.handleBrowserFocus
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { bindRuntimeEvents } from './runtimeEventBridgeService';

describe('runtimeEventBridgeService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.subscribe.mockResolvedValue(() => {});
        mocks.getBackendRuntimeSnapshot.mockResolvedValue(null);
        mocks.runtimeGroupInstancesRefresh.mockResolvedValue(null);
    });

    it('records GameLog persistence fallback as telemetry without frontend ingest', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.subscribe.mockImplementation((name: any, handler: any) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });

        await bindRuntimeEvents();

        handlers.get('gameLogPersistenceFallback')?.({
            error: 'database is locked',
            batch: {
                video_plays: [
                    {
                        created_at: '2026-05-15T00:00:00.000Z',
                        video_url: 'https://video.example.test'
                    }
                ]
            },
            rawRows: [
                [
                    'runtime-game-log',
                    '2026-05-15T00:00:00.000Z',
                    'video-play',
                    'https://video.example.test',
                    ''
                ]
            ]
        });

        expect(mocks.showSQLiteErrorDialog).not.toHaveBeenCalled();
        expect(
            useRuntimeStore.getState().runtimeEvents.gameLogPersistenceFallback
                .count
        ).toBe(1);
        expect(warn).toHaveBeenCalledWith(
            'Backend GameLog persistence failed:',
            'database is locked'
        );

        warn.mockRestore();
    });

    it('records runtime-persisted GameLog mirrors without frontend ingest', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation((name: any, handler: any) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });
        await bindRuntimeEvents();

        const payload: any = {
            runtimePersisted: true,
            raw: [
                'runtime-game-log',
                '2026-05-15T00:00:00.000Z',
                'location',
                'wrld_test:1',
                'Test World'
            ]
        };
        handlers.get('addGameLogEvent')?.(payload);

        expect(
            useRuntimeStore.getState().runtimeEvents.addGameLogEvent.count
        ).toBe(1);
    });

    it('applies runtime GameLog projection when runtime ingest is active', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation((name: any, handler: any) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name: any) => name === 'runtimeGameLogIngest'
        );

        await bindRuntimeEvents();

        const payload: any = {
            currentLocation: 'wrld_test:1',
            currentWorldName: 'Test World',
            currentLocationPlayers: []
        };
        handlers.get('gameLogProjection')?.(payload);

        expect(mocks.applyRuntimeGameLogProjection).toHaveBeenCalledWith(
            payload
        );
        expect(
            useRuntimeStore.getState().runtimeEvents.gameLogProjection.count
        ).toBe(1);
    });
});
