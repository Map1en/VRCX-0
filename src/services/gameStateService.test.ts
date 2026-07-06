import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assetBundleSweepCache: vi.fn(),
    appFocusWindow: vi.fn(),
    appGetVrchatRegistryKey: vi.fn(),
    appIsSteamvrRunning: vi.fn(),
    appSetVrchatRegistryKey: vi.fn(),
    appStartGame: vi.fn(),
    appStartGameFromPath: vi.fn(),
    logWatcherVrcClosedGracefully: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    setString: vi.fn(),
    addGamelogEventToDatabase: vi.fn(),
    startCurrentAvatarWearTimer: vi.fn(),
    stopCurrentAvatarWearTimer: vi.fn(),
    queueDiscordPresenceGameStopCloseAttempts: vi.fn(),
    refreshDiscordPresence: vi.fn(),
    isRuntimeGameClientLifecycleActive: vi.fn(),
    resetRuntimeCrashRelaunchDecision: vi.fn(),
    shouldSkipFrontendCrashRelaunch: vi.fn(),
    waitForRuntimeCrashRelaunchDecision: vi.fn(),
    resetGameLogSessionState: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    isHostCapabilitySupported: vi.fn(),
    requireHostCapabilitySupported: vi.fn(),
    showSQLiteErrorDialog: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        assetBundleSweepCache: mocks.assetBundleSweepCache,
        appFocusWindow: mocks.appFocusWindow,
        appGetVrchatRegistryKey: mocks.appGetVrchatRegistryKey,
        appIsSteamvrRunning: mocks.appIsSteamvrRunning,
        appSetVrchatRegistryKey: mocks.appSetVrchatRegistryKey,
        appStartGame: mocks.appStartGame,
        appStartGameFromPath: mocks.appStartGameFromPath,
        logWatcherVrcClosedGracefully: mocks.logWatcherVrcClosedGracefully
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool,
        getString: mocks.getString,
        setString: mocks.setString
    }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        addGamelogEventToDatabase: mocks.addGamelogEventToDatabase
    }
}));

vi.mock('@/services/avatarWearTimeService', () => ({
    startCurrentAvatarWearTimer: mocks.startCurrentAvatarWearTimer,
    stopCurrentAvatarWearTimer: mocks.stopCurrentAvatarWearTimer
}));

vi.mock('@/services/discordPresenceService', () => ({
    queueDiscordPresenceGameStopCloseAttempts:
        mocks.queueDiscordPresenceGameStopCloseAttempts,
    refreshDiscordPresence: mocks.refreshDiscordPresence
}));

vi.mock('@/services/gameClientLifecycle', () => ({
    isRuntimeGameClientLifecycleActive:
        mocks.isRuntimeGameClientLifecycleActive,
    resetRuntimeCrashRelaunchDecision: mocks.resetRuntimeCrashRelaunchDecision,
    shouldSkipFrontendCrashRelaunch: mocks.shouldSkipFrontendCrashRelaunch,
    waitForRuntimeCrashRelaunchDecision:
        mocks.waitForRuntimeCrashRelaunchDecision
}));

vi.mock('@/services/gameLogIngestService', () => ({
    resetGameLogSessionState: mocks.resetGameLogSessionState
}));

vi.mock('@/services/hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable,
    isHostCapabilitySupported: mocks.isHostCapabilitySupported,
    requireHostCapabilitySupported: mocks.requireHostCapabilitySupported
}));

vi.mock('@/services/sqliteErrorDialogService', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    handleGameRunningUpdate,
    stopGameStateService
} from './gameStateService';

function installWindowStub() {
    globalThis.window = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    } as unknown as Window & typeof globalThis;
}

describe('gameStateService lifecycle transitions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-08T10:00:00.000Z'));
        installWindowStub();
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useNotificationStore.getState().resetNotificationState();
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        mocks.getBool.mockResolvedValue(false);
        mocks.getString.mockImplementation((_key: string, fallback = '') =>
            Promise.resolve(String(fallback ?? ''))
        );
        mocks.setString.mockResolvedValue(undefined);
        mocks.stopCurrentAvatarWearTimer.mockResolvedValue(undefined);
        mocks.refreshDiscordPresence.mockResolvedValue(undefined);
        mocks.isRuntimeGameClientLifecycleActive.mockReturnValue(false);
        mocks.shouldSkipFrontendCrashRelaunch.mockReturnValue(false);
        mocks.waitForRuntimeCrashRelaunchDecision.mockResolvedValue(undefined);
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.isHostCapabilitySupported.mockReturnValue(true);
        mocks.logWatcherVrcClosedGracefully.mockResolvedValue(true);
    });

    afterEach(() => {
        stopGameStateService();
        vi.useRealTimers();
    });

    it('starts a new game session by clearing location mirrors and starting avatar timing', async () => {
        useRuntimeStore.getState().setNowPlayingState({
            url: 'https://video.example/test',
            name: 'Video',
            updatedAt: '2026-06-08T09:59:00.000Z'
        });

        await handleGameRunningUpdate({
            isGameRunning: true,
            isSteamVRRunning: true,
            lastGameStartedAt: '2026-06-08T10:00:00.000Z',
            lastGameStateChangedAt: '2026-06-08T10:00:00.000Z'
        });

        expect(useRuntimeStore.getState().gameState).toMatchObject({
            isGameRunning: true,
            isSteamVRRunning: true,
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentDestination: '',
            currentLocationStartedAt: null,
            currentLocationPlayerIds: [],
            currentLocationPlayers: [],
            lastGameStartedAt: '2026-06-08T10:00:00.000Z',
            lastGameStateChangedAt: '2026-06-08T10:00:00.000Z'
        });
        expect(useRuntimeStore.getState().nowPlaying).toMatchObject({
            url: '',
            name: ''
        });
        expect(mocks.resetRuntimeCrashRelaunchDecision).toHaveBeenCalledTimes(
            1
        );
        expect(mocks.startCurrentAvatarWearTimer).toHaveBeenCalledTimes(1);
        expect(mocks.refreshDiscordPresence).toHaveBeenCalledWith({
            force: true
        });
        expect(useNotificationStore.getState().items).toEqual([]);
    });

    it('stops a game session by clearing stale local current-user presence and persisting duration', async () => {
        useRuntimeStore.getState().setGameState({
            isGameRunning: true,
            isSteamVRRunning: true,
            currentLocation: 'wrld_old:123',
            currentWorldId: 'wrld_old',
            currentWorldName: 'Old World',
            currentDestination: 'wrld_next:456',
            lastGameStartedAt: '2026-06-08T09:00:00.000Z'
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                location: 'wrld_old:123',
                $locationTag: 'wrld_old:123',
                travelingToLocation: 'wrld_next:456',
                $travelingToLocation: 'wrld_next:456',
                worldId: 'wrld_old',
                status: 'active'
            }
        });
        useRuntimeStore.getState().setInstanceQueueState({
            active: true,
            instanceLocation: 'wrld_old:123',
            position: 2,
            queueSize: 5,
            label: 'Queue'
        });
        useRuntimeStore.getState().setTransportState({
            ipcAnnounced: true
        });

        await handleGameRunningUpdate({
            isGameRunning: false,
            isSteamVRRunning: false,
            changedAt: '2026-06-08T10:00:00.000Z'
        });

        expect(useRuntimeStore.getState().gameState).toMatchObject({
            isGameRunning: false,
            isSteamVRRunning: false,
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentDestination: '',
            lastGameLogAt: '2026-06-08T10:00:00.000Z',
            lastGameLogType: 'game-stopped'
        });
        expect(useRuntimeStore.getState().instanceQueue.active).toBe(false);
        expect(useRuntimeStore.getState().transport.ipcAnnounced).toBe(false);
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            id: 'usr_self',
            location: '',
            $locationTag: '',
            travelingToLocation: '',
            $travelingToLocation: '',
            worldId: '',
            status: 'active'
        });
        expect(mocks.resetGameLogSessionState).toHaveBeenCalledWith(
            '2026-06-08T10:00:00.000Z'
        );
        expect(
            mocks.queueDiscordPresenceGameStopCloseAttempts
        ).toHaveBeenCalledTimes(1);
        expect(mocks.stopCurrentAvatarWearTimer).toHaveBeenCalledWith({
            fallbackStartedAt: Date.parse('2026-06-08T09:00:00.000Z'),
            now: Date.parse('2026-06-08T10:00:00.000Z')
        });
        expect(mocks.setString).toHaveBeenCalledWith(
            'lastGameSessionMs',
            String(60 * 60 * 1000)
        );
        expect(mocks.setString).toHaveBeenCalledWith(
            'lastGameOfflineAt',
            String(Date.parse('2026-06-08T10:00:00.000Z'))
        );
        expect(useNotificationStore.getState().items[0]).toMatchObject({
            level: 'info',
            title: 'VRChat stopped',
            message: 'SteamVR is not running.'
        });
    });
});
