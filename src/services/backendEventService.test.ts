import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    subscribe: vi.fn(),
    ingestBackendGameLogEvent: vi.fn(),
    resetNowPlayingState: vi.fn(),
    recordBackendGameClientEvent: vi.fn(),
    handleGameRunningUpdate: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    refreshHostCapabilities: vi.fn(),
    handleIpcEvent: vi.fn(),
    pushSharedFeedNotification: vi.fn(),
    showSQLiteErrorDialog: vi.fn(),
    handleBrowserFocus: vi.fn()
}));

vi.mock('@/platform/index.js', () => ({
    backend: {
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('./gameLogIngestService.js', () => ({
    ingestBackendGameLogEvent: mocks.ingestBackendGameLogEvent,
    resetNowPlayingState: mocks.resetNowPlayingState
}));

vi.mock('./gameClientLifecycle.js', () => ({
    recordBackendGameClientEvent: mocks.recordBackendGameClientEvent
}));

vi.mock('./gameStateService.js', () => ({
    handleGameRunningUpdate: mocks.handleGameRunningUpdate
}));

vi.mock('./hostCapabilityService.js', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable,
    refreshHostCapabilities: mocks.refreshHostCapabilities
}));

vi.mock('./ipcEventService.js', () => ({
    handleIpcEvent: mocks.handleIpcEvent
}));

vi.mock('./sharedFeedFilterService.js', () => ({
    pushSharedFeedNotification: mocks.pushSharedFeedNotification
}));

vi.mock('./sqliteErrorDialogService.js', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

vi.mock('./vrcStatusService.js', () => ({
    handleBrowserFocus: mocks.handleBrowserFocus
}));

import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { bindBackendEvents } from './backendEventService.js';

describe('backendEventService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.subscribe.mockResolvedValue(() => {});
    });

    it('records GameLog persistence fallback as telemetry without frontend ingest', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.subscribe.mockImplementation((name, handler) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });

        await bindBackendEvents();

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
                    'backend-game-log',
                    '2026-05-15T00:00:00.000Z',
                    'video-play',
                    'https://video.example.test',
                    ''
                ]
            ]
        });

        expect(mocks.ingestBackendGameLogEvent).not.toHaveBeenCalled();
        expect(mocks.showSQLiteErrorDialog).not.toHaveBeenCalled();
        expect(
            useRuntimeStore.getState().backendEvents.gameLogPersistenceFallback
                .count
        ).toBe(1);
        expect(warn).toHaveBeenCalledWith(
            'Backend GameLog persistence failed:',
            'database is locked'
        );

        warn.mockRestore();
    });
});
