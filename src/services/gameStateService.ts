import {
    commands,
    type HostSessionProjection
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import {
    startCurrentAvatarWearTimer,
    stopCurrentAvatarWearTimer
} from '@/services/avatarWearTimeService';
import {
    queueDiscordPresenceGameStopCloseAttempts,
    refreshDiscordPresence
} from '@/services/discordPresenceService';
import {
    isRuntimeGameClientLifecycleActive,
    resetRuntimeCrashRelaunchDecision,
    shouldSkipFrontendCrashRelaunch,
    waitForRuntimeCrashRelaunchDecision
} from '@/services/gameClientLifecycle';
import { resetGameLogSessionState } from '@/services/gameLogIngestService';
import {
    isHostCapabilityAvailable,
    isHostCapabilitySupported,
    requireHostCapabilitySupported
} from '@/services/hostCapabilityService';
import { showSQLiteErrorDialog } from '@/services/sqliteErrorDialogService';
import { MINUTE_MS, SECOND_MS } from '@/shared/constants/time';
import { normalizeBoolean } from '@/shared/utils/coerce';
import { isRealInstance } from '@/shared/utils/instance';
import { normalizeString } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameState = RuntimeState['gameState'];
type GameStatePatch = Parameters<RuntimeState['setGameState']>[0];
type GameRunningPayload = Partial<HostSessionProjection> &
    Record<string, unknown>;

let debugLoggingTimer: ReturnType<typeof window.setTimeout> | null = null;
let crashRelaunchTimer: ReturnType<typeof window.setTimeout> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function scheduleDebugLoggingCheck(delayMs: number = MINUTE_MS) {
    if (debugLoggingTimer !== null) {
        window.clearTimeout(debugLoggingTimer);
    }

    debugLoggingTimer = window.setTimeout(() => {
        debugLoggingTimer = null;
        checkVRChatDebugLogging().catch((error: unknown) => {
            console.warn('VRChat debug logging check failed:', error);
        });
    }, delayMs);
}

function clearCrashRelaunchTimer() {
    if (crashRelaunchTimer !== null) {
        window.clearTimeout(crashRelaunchTimer);
        crashRelaunchTimer = null;
    }
}

function buildLaunchUrl(location: unknown) {
    return `vrchat://launch?ref=vrcx.app&id=${encodeURIComponent(
        normalizeString(location)
    )}`;
}

async function launchVrchat(location: unknown, desktopMode: unknown) {
    requireHostCapabilitySupported('gameLaunch');
    const args = [buildLaunchUrl(location)];
    const launchArguments = await configRepository.getString(
        'launchArguments',
        ''
    );
    const launchPathOverride = await configRepository.getString(
        'vrcLaunchPathOverride',
        ''
    );
    if (launchArguments) {
        args.push(String(launchArguments));
    }
    if (desktopMode) {
        args.push('--no-vr');
    }

    const argumentString = args.join(' ');
    const launched = launchPathOverride
        ? await commands.appStartGameFromPath(
              String(launchPathOverride),
              argumentString
          )
        : await commands.appStartGame(argumentString);
    if (!launched) {
        throw new Error(
            launchPathOverride
                ? 'Failed to launch VRChat from the configured custom path.'
                : 'Failed to find VRChat. Configure a custom launch path in launch options.'
        );
    }
}

async function persistGameStopSession(previousGameState: GameState) {
    const startedAt = Date.parse(previousGameState.lastGameStartedAt || '');
    const offlineAt = Date.now();

    if (!isRuntimeGameClientLifecycleActive() && Number.isFinite(startedAt)) {
        const sessionDuration = Math.max(0, offlineAt - startedAt);
        if (sessionDuration > 0) {
            await Promise.all([
                configRepository.setString(
                    'lastGameSessionMs',
                    String(sessionDuration)
                ),
                configRepository.setString(
                    'lastGameOfflineAt',
                    String(offlineAt)
                )
            ]);
        }
    }

    await stopCurrentAvatarWearTimer({
        fallbackStartedAt: Number.isFinite(startedAt) ? startedAt : 0,
        now: offlineAt
    });
}

async function sweepVrchatCacheIfEnabled() {
    if (isRuntimeGameClientLifecycleActive()) {
        return;
    }

    if (!(await configRepository.getBool('autoSweepVRChatCache', false))) {
        return;
    }

    try {
        const removedPaths = await commands.assetBundleSweepCache();
        const removedCount = Array.isArray(removedPaths)
            ? removedPaths.length
            : 0;
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: 'VRChat cache swept',
            message: removedCount
                ? `Removed ${removedCount} cache entries.`
                : 'No cache entries were removed.'
        });
    } catch (error) {
        console.warn('SweepCache failed:', error);
    }
}

async function scheduleCrashRelaunchIfNeeded(previousGameState: GameState) {
    if (isRuntimeGameClientLifecycleActive()) {
        await waitForRuntimeCrashRelaunchDecision();
        return;
    }

    if (shouldSkipFrontendCrashRelaunch()) {
        return;
    }

    if (!isHostCapabilitySupported('gameLaunch')) {
        return;
    }

    if (!(await configRepository.getBool('relaunchVRChatAfterCrash', false))) {
        return;
    }

    const location = previousGameState.currentLocation;
    if (!isRealInstance(location)) {
        return;
    }

    const closedGracefully = await commands
        .logWatcherVrcClosedGracefully()
        .catch(() => true);
    if (closedGracefully) {
        return;
    }

    const now = Date.now();
    const lastCrashedAt = Date.parse(previousGameState.lastCrashedAt || '');
    if (Number.isFinite(lastCrashedAt) && now - lastCrashedAt < 120_000) {
        return;
    }

    useRuntimeStore.getState().setGameState({
        lastCrashedAt: new Date(now).toISOString()
    });
    clearCrashRelaunchTimer();
    crashRelaunchTimer = window.setTimeout(
        () => {
            crashRelaunchTimer = null;
            (async () => {
                if (shouldSkipFrontendCrashRelaunch()) {
                    return;
                }

                if (!previousGameState.isGameNoVR) {
                    const steamVrRunning = await commands
                        .appIsSteamvrRunning()
                        .catch(
                            () =>
                                useRuntimeStore.getState().gameState
                                    .isSteamVRRunning
                        );
                    if (!steamVrRunning) {
                        console.log(
                            "SteamVR isn't running, not relaunching VRChat"
                        );
                        return;
                    }
                }

                await commands.appFocusWindow().catch(() => {});
                const message =
                    'VRChat crashed, attempting to rejoin last instance.';
                await gameLogRepository.addGamelogEventToDatabase({
                    created_at: new Date().toJSON(),
                    type: 'Event',
                    data: message
                });
                useNotificationStore.getState().pushNotification({
                    level: 'warning',
                    title: 'VRChat crash detected',
                    message
                });
                await launchVrchat(location, previousGameState.isGameNoVR);
            })().catch((error: unknown) => {
                showSQLiteErrorDialog(error);
                useNotificationStore.getState().pushNotification({
                    level: 'error',
                    title: 'VRChat relaunch failed',
                    message:
                        error instanceof Error ? error.message : String(error)
                });
            });
        },
        previousGameState.isGameNoVR ? 2000 : 8000
    );
}

async function handleGameStopped(
    previousGameState: GameState,
    currentUserSnapshot: unknown
) {
    const stoppedAt = new Date().toISOString();
    useRuntimeStore.getState().clearInstanceQueueState();
    useRuntimeStore.getState().setTransportState({
        ipcAnnounced: false
    });

    resetGameLogSessionState(stoppedAt);

    clearStoppedGameLocationSnapshot(previousGameState, currentUserSnapshot);
    queueDiscordPresenceGameStopCloseAttempts();
    await refreshDiscordPresence({ force: true }).catch((error: unknown) => {
        console.warn('Discord presence refresh after game stop failed:', error);
    });

    const results = await Promise.allSettled([
        persistGameStopSession(previousGameState),
        sweepVrchatCacheIfEnabled(),
        scheduleCrashRelaunchIfNeeded(previousGameState)
    ]);
    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('Game stop side effect failed:', result.reason);
        }
    }
}

function buildNewGameSessionPatch(startedAt: string): GameStatePatch {
    return {
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        lastGameStartedAt: startedAt
    };
}

function buildStoppedGameSessionPatch(stoppedAt: string): GameStatePatch {
    return {
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        lastGameLogAt: stoppedAt,
        lastGameLogType: 'game-stopped'
    };
}

function clearStoppedGameLocationSnapshot(
    previousGameState: GameState,
    currentUserSnapshot: unknown
) {
    if (!isRecord(currentUserSnapshot)) {
        return;
    }

    const stoppedLocation = normalizeString(previousGameState.currentLocation);
    const stoppedDestination = normalizeString(
        previousGameState.currentDestination
    );
    const stoppedWorldId = normalizeString(previousGameState.currentWorldId);
    if (!stoppedLocation && !stoppedDestination && !stoppedWorldId) {
        return;
    }

    const clearedFields: Record<string, string> = {};
    const clearIfMatches = (field: string, ...values: unknown[]) => {
        const currentValue = normalizeString(currentUserSnapshot[field]);
        if (
            currentValue &&
            values.some((value) => Boolean(value) && currentValue === value)
        ) {
            clearedFields[field] = '';
        }
    };

    clearIfMatches('location', stoppedLocation);
    clearIfMatches('$locationTag', stoppedLocation);
    clearIfMatches('travelingToLocation', stoppedDestination);
    clearIfMatches('$travelingToLocation', stoppedDestination);
    clearIfMatches('worldId', stoppedWorldId);

    if (Object.keys(clearedFields).length) {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserSnapshot: {
                ...currentUserSnapshot,
                ...clearedFields
            }
        });
    }
}

export async function checkVRChatDebugLogging() {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return;
    }

    if (await configRepository.getBool('gameLogDisabled', false)) {
        return;
    }

    let loggingEnabled;
    try {
        loggingEnabled =
            await commands.appGetVrchatRegistryKey('LOGGING_ENABLED');
    } catch (error) {
        console.warn(
            'Unable to read VRChat debug logging registry key:',
            error
        );
        return;
    }

    if (
        loggingEnabled === null ||
        loggingEnabled === undefined ||
        loggingEnabled === ''
    ) {
        return;
    }

    if (Number.parseInt(loggingEnabled, 10) === 1) {
        return;
    }

    try {
        const result = await commands.appSetVrchatRegistryKey(
            'LOGGING_ENABLED',
            1,
            4
        );
        if (result) {
            useNotificationStore.getState().pushNotification({
                level: 'info',
                title: 'Enabled debug logging',
                message:
                    'VRChat debug logging was disabled and has been re-enabled for game-log ingestion.'
            });
            return;
        }
    } catch (error) {
        console.error('Failed to enable VRChat debug logging:', error);
    }

    useModalStore.getState().alert({
        title: 'Enable debug logging',
        description:
            'VRCX-0 noticed VRChat debug logging is disabled. Enable debug logging in VRChat quick menu settings > debug > enable debug logging, then rejoin the instance or restart VRChat.'
    });
}

export async function handleGameRunningUpdate(payload: unknown = {}) {
    const projection: GameRunningPayload = isRecord(payload)
        ? (payload as GameRunningPayload)
        : {};
    const runtimeStore = useRuntimeStore.getState();
    const previousGameState = runtimeStore.gameState;
    const currentUserSnapshot = runtimeStore.auth.currentUserSnapshot;
    const previousGameRunning = runtimeStore.gameState.isGameRunning;
    const previousSteamVrRunning = runtimeStore.gameState.isSteamVRRunning;
    const nextGameRunning = normalizeBoolean(projection?.isGameRunning);
    const nextSteamVrRunning = normalizeBoolean(projection?.isSteamVRRunning);
    const gameRunningChanged = previousGameRunning !== nextGameRunning;
    const steamVrRunningChanged = previousSteamVrRunning !== nextSteamVrRunning;
    const changed = gameRunningChanged || steamVrRunningChanged;
    const payloadChangedAt =
        normalizeString(projection?.lastGameStateChangedAt) ||
        normalizeString(projection?.changedAt);
    const payloadStartedAt = normalizeString(projection?.lastGameStartedAt);
    const shouldRefreshDiscordPresence =
        gameRunningChanged ||
        (nextGameRunning === true &&
            useSessionStore.getState().sessionPhase === 'ready');
    const now = payloadChangedAt || new Date().toISOString();
    const gameStartedAt =
        gameRunningChanged && nextGameRunning
            ? payloadStartedAt || now
            : payloadStartedAt || runtimeStore.gameState.lastGameStartedAt;
    const newSessionPatch =
        gameRunningChanged && nextGameRunning
            ? buildNewGameSessionPatch(gameStartedAt ?? now)
            : {};
    const stoppedSessionPatch =
        gameRunningChanged && previousGameRunning === true && !nextGameRunning
            ? buildStoppedGameSessionPatch(now)
            : {};

    runtimeStore.setGameState({
        isGameRunning: nextGameRunning,
        isSteamVRRunning: nextSteamVrRunning,
        lastGameStateChangedAt: changed
            ? now
            : runtimeStore.gameState.lastGameStateChangedAt,
        lastGameStartedAt: gameStartedAt,
        ...newSessionPatch,
        ...stoppedSessionPatch
    });

    if (gameRunningChanged && previousGameRunning !== null) {
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: nextGameRunning ? 'VRChat running' : 'VRChat stopped',
            message: nextSteamVrRunning
                ? 'SteamVR is running.'
                : 'SteamVR is not running.'
        });
    }

    if (nextGameRunning) {
        if (gameRunningChanged) {
            resetRuntimeCrashRelaunchDecision();
            useRuntimeStore.getState().resetNowPlayingState();
            startCurrentAvatarWearTimer();
        }
        clearCrashRelaunchTimer();
        scheduleDebugLoggingCheck(SECOND_MS);
    } else if (debugLoggingTimer !== null) {
        window.clearTimeout(debugLoggingTimer);
        debugLoggingTimer = null;
    }

    if (
        gameRunningChanged &&
        previousGameRunning === true &&
        !nextGameRunning
    ) {
        await handleGameStopped(previousGameState, currentUserSnapshot);
        return;
    }

    if (shouldRefreshDiscordPresence) {
        await refreshDiscordPresence({ force: true }).catch(
            (error: unknown) => {
                console.warn(
                    'Discord presence refresh after game state update failed:',
                    error
                );
            }
        );
    }
}

export function stopGameStateService() {
    if (debugLoggingTimer !== null) {
        window.clearTimeout(debugLoggingTimer);
        debugLoggingTimer = null;
    }
    clearCrashRelaunchTimer();
}
