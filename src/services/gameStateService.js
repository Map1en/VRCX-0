import { backend } from '@/platform/index.js';
import {
    avatarLocalRepository,
    configRepository,
    gameLogRepository
} from '@/repositories/index.js';
import { refreshDiscordPresence } from '@/services/discordPresenceService.js';
import {
    finalizeCurrentGameLogSession,
    resetGameLogIngestSessionState,
    resetNowPlayingState
} from '@/services/gameLogIngestService.js';
import { showSQLiteErrorDialog } from '@/services/sqliteErrorDialogService.js';
import { isRealInstance } from '@/shared/utils/instance.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

let debugLoggingTimer = null;
let crashRelaunchTimer = null;

function normalizeBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function scheduleDebugLoggingCheck(delayMs = 60000) {
    if (debugLoggingTimer !== null) {
        window.clearTimeout(debugLoggingTimer);
    }

    debugLoggingTimer = window.setTimeout(() => {
        debugLoggingTimer = null;
        checkVRChatDebugLogging().catch((error) => {
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

function buildLaunchUrl(location) {
    return `vrchat://launch?ref=vrcx.app&id=${encodeURIComponent(location)}`;
}

async function launchVrchat(location, desktopMode) {
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
        args.push(launchArguments);
    }
    if (desktopMode) {
        args.push('--no-vr');
    }

    const argumentString = args.join(' ');
    const launched = launchPathOverride
        ? await backend.app.StartGameFromPath(
              launchPathOverride,
              argumentString
          )
        : await backend.app.StartGame(argumentString);
    if (!launched) {
        throw new Error(
            launchPathOverride
                ? 'Failed to launch VRChat from the configured custom path.'
                : 'Failed to find VRChat. Configure a custom launch path in launch options.'
        );
    }
}

async function persistGameStopSession(previousGameState, currentUserSnapshot) {
    const startedAt = Date.parse(previousGameState.lastGameStartedAt || '');
    if (!Number.isFinite(startedAt)) {
        return;
    }

    const offlineAt = Date.now();
    const sessionDuration = Math.max(0, offlineAt - startedAt);
    if (sessionDuration <= 0) {
        return;
    }

    await Promise.all([
        configRepository.setString(
            'lastGameSessionMs',
            String(sessionDuration)
        ),
        configRepository.setString('lastGameOfflineAt', String(offlineAt))
    ]);

    const currentAvatar = currentUserSnapshot?.currentAvatar;
    const currentUserId = useRuntimeStore.getState().auth.currentUserId;
    if (currentAvatar && currentUserId) {
        await avatarLocalRepository.addAvatarTimeSpent(
            currentUserId,
            currentAvatar,
            sessionDuration
        );
    }
}

async function sweepVrchatCacheIfEnabled() {
    if (!(await configRepository.getBool('autoSweepVRChatCache', false))) {
        return;
    }

    try {
        const removedPaths = await backend.assetBundle.SweepCache();
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

async function scheduleCrashRelaunchIfNeeded(previousGameState) {
    if (!(await configRepository.getBool('relaunchVRChatAfterCrash', false))) {
        return;
    }

    const location = previousGameState.currentLocation;
    if (!isRealInstance(location)) {
        return;
    }

    const closedGracefully = await backend.logWatcher
        .VrcClosedGracefully()
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
                if (!previousGameState.isGameNoVR) {
                    const steamVrRunning = await backend.app
                        .IsSteamVRRunning()
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

                await backend.app.FocusWindow().catch(() => {});
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
            })().catch((error) => {
                void showSQLiteErrorDialog(error);
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

async function handleGameStopped(previousGameState, currentUserSnapshot) {
    const stoppedAt = new Date().toISOString();
    resetNowPlayingState();
    useRuntimeStore.getState().setTransportState({
        ipcAnnounced: false
    });

    const finalizeResult = await Promise.allSettled([
        finalizeCurrentGameLogSession(stoppedAt)
    ]);
    for (const result of finalizeResult) {
        if (result.status === 'rejected') {
            void showSQLiteErrorDialog(result.reason);
            console.warn(
                'Game stop session finalization failed:',
                result.reason
            );
        }
    }

    clearStoppedGameLocationSnapshot(previousGameState, currentUserSnapshot);
    await refreshDiscordPresence({ force: true }).catch((error) => {
        console.warn('Discord presence refresh after game stop failed:', error);
    });

    const results = await Promise.allSettled([
        persistGameStopSession(previousGameState, currentUserSnapshot),
        sweepVrchatCacheIfEnabled(),
        scheduleCrashRelaunchIfNeeded(previousGameState)
    ]);
    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('Game stop side effect failed:', result.reason);
        }
    }
}

function buildNewGameSessionPatch(startedAt) {
    return {
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        lastGameStartedAt: startedAt
    };
}

function clearStoppedGameLocationSnapshot(
    previousGameState,
    currentUserSnapshot
) {
    if (!currentUserSnapshot || typeof currentUserSnapshot !== 'object') {
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

    const clearedFields = {};
    const clearIfMatches = (field, ...values) => {
        const currentValue = normalizeString(currentUserSnapshot[field]);
        if (
            currentValue &&
            values.some((value) => value && currentValue === value)
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
    if (await configRepository.getBool('gameLogDisabled', false)) {
        return;
    }

    let loggingEnabled;
    try {
        loggingEnabled =
            await backend.app.GetVRChatRegistryKey('LOGGING_ENABLED');
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
        const result = await backend.app.SetVRChatRegistryKey(
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
            'VRCX noticed VRChat debug logging is disabled. Enable debug logging in VRChat quick menu settings > debug > enable debug logging, then rejoin the instance or restart VRChat.'
    });
}

export async function handleGameRunningUpdate(payload = {}) {
    const runtimeStore = useRuntimeStore.getState();
    const previousGameState = runtimeStore.gameState;
    const currentUserSnapshot = runtimeStore.auth.currentUserSnapshot;
    const previousGameRunning = runtimeStore.gameState.isGameRunning;
    const previousSteamVrRunning = runtimeStore.gameState.isSteamVRRunning;
    const nextGameRunning = normalizeBoolean(payload?.isGameRunning);
    const nextSteamVrRunning = normalizeBoolean(payload?.isSteamVRRunning);
    const gameRunningChanged = previousGameRunning !== nextGameRunning;
    const steamVrRunningChanged = previousSteamVrRunning !== nextSteamVrRunning;
    const changed = gameRunningChanged || steamVrRunningChanged;
    const now = new Date().toISOString();
    const gameStartedAt =
        gameRunningChanged && nextGameRunning
            ? now
            : runtimeStore.gameState.lastGameStartedAt;
    const newSessionPatch =
        gameRunningChanged && nextGameRunning
            ? buildNewGameSessionPatch(gameStartedAt)
            : {};

    runtimeStore.setGameState({
        isGameRunning: nextGameRunning,
        isSteamVRRunning: nextSteamVrRunning,
        lastGameStateChangedAt: changed
            ? now
            : runtimeStore.gameState.lastGameStateChangedAt,
        lastGameStartedAt: gameStartedAt,
        ...newSessionPatch
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
            resetGameLogIngestSessionState();
            resetNowPlayingState();
        }
        clearCrashRelaunchTimer();
        scheduleDebugLoggingCheck(1000);
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

    if (gameRunningChanged) {
        await refreshDiscordPresence({ force: true }).catch((error) => {
            console.warn(
                'Discord presence refresh after game state update failed:',
                error
            );
        });
    }
}

export function stopGameStateService() {
    if (debugLoggingTimer !== null) {
        window.clearTimeout(debugLoggingTimer);
        debugLoggingTimer = null;
    }
    clearCrashRelaunchTimer();
}
