import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import databaseMaintenanceRepository from '@/repositories/databaseMaintenanceRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import { buildCurrentUserGameStatePresencePatch } from '@/shared/utils/currentUserPresence';
import {
    createJoinLeaveEntry,
    createLocationEntry,
    createPortalSpawnEntry,
    createResourceLoadEntry
} from '@/shared/utils/gameLog';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { recordGameRuntimePresence } from './domainIngestionService';
import {
    enqueueEmojiSave,
    enqueuePrintSave,
    enqueueStickerSave
} from './game-log-ingest/instanceMediaSave';
import {
    getPlayerKey,
    parseRawRow,
    type ParsedGameLog
} from './game-log-ingest/parsing';
import {
    shouldSkipRuntimeHandledGameLogSideEffect as shouldSkipRuntimeHandledGameLogSideEffectByCapability,
    shouldSkipRuntimePersistedGameLog as shouldSkipRuntimePersistedGameLogByCapability
} from './game-log-ingest/persistenceOwnership';
import { processScreenshot } from './game-log-ingest/screenshotMetadata';
import {
    getCurrentLocation,
    getCurrentLocationPlayers,
    getCurrentLocationPlayerIds,
    ingestState,
    instanceMediaState,
    nowPlayingState,
    resetCurrentGameLogSessionState,
    type GameLogPlayer
} from './game-log-ingest/state';
import {
    createVideoEntryWithMetadata,
    persistProviderVideo,
    persistVideoEntry,
    resetRuntimeNowPlayingState
} from './game-log-ingest/videoPersistence';
import { isHostCapabilityAvailable } from './hostCapabilityService';

const GAME_LOG_BATCH_LIMIT = 50;
type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameStatePatch = Parameters<RuntimeState['setGameState']>[0];
type GameLogRow = ParsedGameLog;
type GameLogPersistOptions = {
    copyScreenshotToClipboard?: boolean;
};
type LocationUpdateInput = {
    location: unknown;
    worldName?: unknown;
    createdAt?: unknown;
};

function isRuntimeGameLogIngestActive() {
    return isHostCapabilityAvailable('runtimeGameLogIngest');
}

export function isRuntimeGameLogSideEffectsActive() {
    return isHostCapabilityAvailable('runtimeGameLogSideEffects');
}

function shouldSkipRuntimePersistedGameLog(gameLog: GameLogRow) {
    return shouldSkipRuntimePersistedGameLogByCapability(gameLog, {
        runtimeGameLogIngestAvailable: isRuntimeGameLogIngestActive()
    });
}

function shouldSkipRuntimeHandledGameLogSideEffect(gameLog: GameLogRow) {
    return shouldSkipRuntimeHandledGameLogSideEffectByCapability(gameLog, {
        runtimeGameLogSideEffectsAvailable: isRuntimeGameLogSideEffectsActive()
    });
}

function updateCurrentLocation({
    location,
    worldName = '',
    createdAt = ''
}: LocationUpdateInput) {
    const normalizedLocation = normalizeString(location);
    const normalizedWorldName = normalizeString(worldName);
    const normalizedCreatedAt = normalizeString(createdAt);
    const parsed = parseLocation(normalizedLocation);
    const preserveTravelingPlayers =
        ingestState.currentLocation === 'traveling' &&
        normalizedLocation !== 'traveling';
    ingestState.currentLocation = normalizedLocation;
    ingestState.currentWorldName = normalizedWorldName;
    ingestState.currentLocationStartedAt =
        normalizedCreatedAt || new Date().toISOString();
    if (!preserveTravelingPlayers) {
        ingestState.playersByKey.clear();
    }
    ingestState.lastVideoUrl = '';
    ingestState.lastResourceUrl = '';

    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGameState({
        currentLocation: normalizedLocation,
        currentWorldId: parsed.worldId || '',
        currentWorldName: normalizedWorldName,
        currentDestination: '',
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayerIds: getCurrentLocationPlayerIds(),
        currentLocationPlayers: getCurrentLocationPlayers(),
        lastGameLogAt: new Date().toISOString(),
        lastGameLogType: 'location'
    });

    patchCurrentUserLocationFromGameState(runtimeStore, {
        currentLocation: normalizedLocation,
        currentWorldId: parsed.worldId || '',
        currentWorldName: normalizedWorldName,
        currentDestination: '',
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayerIds: getCurrentLocationPlayerIds(),
        currentLocationPlayers: getCurrentLocationPlayers()
    });
    const domainRuntime = useRuntimeStore.getState();
    recordGameRuntimePresence({
        endpoint: domainRuntime.auth.currentUserEndpoint,
        currentUserId: domainRuntime.auth.currentUserId,
        currentUserSnapshot: domainRuntime.auth.currentUserSnapshot,
        currentLocation: normalizedLocation,
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayers: getCurrentLocationPlayers(),
        currentWorldName: normalizedWorldName
    });
}

function normalizeProjectionPlayers(value: unknown): GameLogPlayer[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((player): GameLogPlayer | null =>
            player && typeof player === 'object'
                ? (player as GameLogPlayer)
                : null
        )
        .filter((player): player is GameLogPlayer => Boolean(player));
}

export function applyRuntimeGameLogProjection(payload: unknown) {
    const projection =
        payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : {};
    const currentLocation = normalizeString(projection.currentLocation);
    const currentWorldId = normalizeString(projection.currentWorldId);
    const currentWorldName = normalizeString(projection.currentWorldName);
    const currentDestination = normalizeString(projection.currentDestination);
    const currentLocationStartedAt = normalizeString(
        projection.currentLocationStartedAt
    );
    const lastGameLogAt =
        normalizeString(projection.lastGameLogAt) || new Date().toISOString();
    const lastGameLogType = normalizeString(projection.lastGameLogType);
    const players = normalizeProjectionPlayers(
        projection.currentLocationPlayers
    );

    ingestState.currentLocation = currentLocation;
    ingestState.currentWorldName = currentWorldName;
    ingestState.currentLocationStartedAt = currentLocationStartedAt;
    ingestState.playersByKey.clear();
    for (const player of players) {
        const userId = normalizeString(player.userId);
        const displayName = normalizeString(player.displayName);
        if (!userId && !displayName) {
            continue;
        }
        const playerKey = getPlayerKey(userId, displayName);
        ingestState.playersByKey.set(playerKey, {
            userId,
            displayName,
            joinTime: Number(player.joinTimeMs) || 0
        });
    }
    if (!currentLocation) {
        ingestState.lastVideoUrl = '';
        ingestState.lastResourceUrl = '';
    }

    const currentLocationPlayerIds = getCurrentLocationPlayerIds();
    const currentLocationPlayers = getCurrentLocationPlayers();
    const gameStatePatch: GameStatePatch = {
        currentLocation,
        currentWorldId,
        currentWorldName,
        currentDestination,
        currentLocationStartedAt: currentLocationStartedAt || null,
        currentLocationPlayerIds,
        currentLocationPlayers,
        lastGameLogAt,
        lastGameLogType
    };
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGameState(gameStatePatch);

    if (currentLocation || currentDestination) {
        patchCurrentUserLocationFromGameState(runtimeStore, gameStatePatch);
    }

    const domainRuntime = useRuntimeStore.getState();
    recordGameRuntimePresence({
        endpoint: domainRuntime.auth.currentUserEndpoint,
        currentUserId: domainRuntime.auth.currentUserId,
        currentUserSnapshot: domainRuntime.auth.currentUserSnapshot,
        currentLocation,
        currentDestination,
        currentLocationStartedAt,
        currentLocationPlayers,
        currentWorldName
    });
}

function patchCurrentUserLocationFromGameState(
    runtimeStore: RuntimeState,
    gameStatePatch: GameStatePatch
) {
    const currentSnapshot = runtimeStore.auth.currentUserSnapshot;
    if (!currentSnapshot || typeof currentSnapshot !== 'object') {
        return;
    }

    const presencePatch = buildCurrentUserGameStatePresencePatch(
        {
            ...runtimeStore.gameState,
            ...gameStatePatch,
            isGameRunning: true
        },
        currentSnapshot
    );
    if (!presencePatch) {
        return;
    }

    const startedAt = Date.parse(
        normalizeString(gameStatePatch.currentLocationStartedAt)
    );
    const locationTime = Number.isFinite(startedAt) ? startedAt : Date.now();
    const timedPresencePatch: Record<string, unknown> = {
        ...presencePatch,
        ...(gameStatePatch.currentLocation === 'traveling'
            ? { $travelingToTime: locationTime }
            : { $location_at: locationTime })
    };

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...currentSnapshot,
            ...timedPresencePatch
        }
    });
}

function removeCurrentLocationPlayer(userId: unknown, displayName: unknown) {
    const playerKey = getPlayerKey(userId, displayName);
    const player = ingestState.playersByKey.get(playerKey);
    if (player) {
        ingestState.playersByKey.delete(playerKey);
        return player;
    }

    const normalizedDisplayName = normalizeString(displayName).toLowerCase();
    if (!normalizedDisplayName) {
        return undefined;
    }

    const matches = Array.from(ingestState.playersByKey.entries()).filter(
        ([, value]) =>
            normalizeString(value?.displayName).toLowerCase() ===
            normalizedDisplayName
    );
    if (matches.length !== 1) {
        return undefined;
    }

    const [matchedKey, matchedPlayer] = matches[0];
    ingestState.playersByKey.delete(matchedKey);
    return matchedPlayer;
}

async function persistGameLog(
    gameLog: GameLogRow,
    options: GameLogPersistOptions = {}
) {
    const runtimeStore = useRuntimeStore.getState();
    const location = getCurrentLocation();
    const copyScreenshotToClipboard =
        options.copyScreenshotToClipboard !== false;
    const runtimePersisted = shouldSkipRuntimePersistedGameLog(gameLog);
    const runtimeSideEffectHandled =
        shouldSkipRuntimeHandledGameLogSideEffect(gameLog);
    let entry = null;

    runtimeStore.setGameState({
        lastGameLogAt: gameLog.dt || new Date().toISOString(),
        lastGameLogType: gameLog.type
    });

    switch (gameLog.type) {
        case 'location-destination': {
            const destination = normalizeString(gameLog.location);
            if (
                !destination ||
                (isHostCapabilityAvailable('gameProcessMonitor') &&
                    !runtimeStore.gameState.isGameRunning)
            ) {
                break;
            }
            const changedAt = gameLog.dt || new Date().toISOString();
            await finalizeCurrentGameLogSession(changedAt, {
                skipPersistence: runtimePersisted
            });
            ingestState.currentLocation = 'traveling';
            ingestState.currentWorldName = '';
            ingestState.currentLocationStartedAt = changedAt;
            runtimeStore.setGameState({
                currentLocation: 'traveling',
                currentWorldId: '',
                currentWorldName: '',
                currentDestination: destination,
                currentLocationStartedAt: changedAt,
                currentLocationPlayerIds: [],
                currentLocationPlayers: [],
                lastGameLogAt: changedAt,
                lastGameLogType: gameLog.type
            });
            patchCurrentUserLocationFromGameState(runtimeStore, {
                currentLocation: 'traveling',
                currentWorldId: '',
                currentWorldName: '',
                currentDestination: destination,
                currentLocationStartedAt: changedAt,
                currentLocationPlayerIds: [],
                currentLocationPlayers: []
            });
            const domainRuntime = useRuntimeStore.getState();
            recordGameRuntimePresence({
                endpoint: domainRuntime.auth.currentUserEndpoint,
                currentUserId: domainRuntime.auth.currentUserId,
                currentUserSnapshot: domainRuntime.auth.currentUserSnapshot,
                currentLocation: 'traveling',
                currentDestination: destination,
                currentLocationStartedAt: changedAt,
                currentLocationPlayers: []
            });
            break;
        }
        case 'location': {
            const normalizedLocation = normalizeString(gameLog.location);
            const worldName = normalizeString(gameLog.worldName);
            if (!normalizedLocation) {
                break;
            }
            const parsed = parseLocation(normalizedLocation);
            entry = createLocationEntry(
                gameLog.dt,
                normalizedLocation,
                parsed.worldId || '',
                worldName
            );
            if (!runtimePersisted) {
                await gameLogRepository.addGamelogLocationToDatabase(entry);
            }
            updateCurrentLocation({
                location: normalizedLocation,
                worldName,
                createdAt: gameLog.dt
            });
            break;
        }
        case 'player-joined': {
            const userId = normalizeString(gameLog.userId);
            const displayName = normalizeString(gameLog.displayName);
            const playerKey = getPlayerKey(userId, displayName);
            ingestState.playersByKey.set(playerKey, {
                userId,
                displayName,
                joinTime: Date.parse(gameLog.dt)
            });
            runtimeStore.setGameState({
                currentLocationPlayerIds: getCurrentLocationPlayerIds(),
                currentLocationPlayers: getCurrentLocationPlayers()
            });
            const domainRuntime = useRuntimeStore.getState();
            recordGameRuntimePresence({
                endpoint: domainRuntime.auth.currentUserEndpoint,
                currentUserId: domainRuntime.auth.currentUserId,
                currentUserSnapshot: domainRuntime.auth.currentUserSnapshot,
                currentLocation: domainRuntime.gameState.currentLocation,
                currentDestination: domainRuntime.gameState.currentDestination,
                currentLocationStartedAt:
                    domainRuntime.gameState.currentLocationStartedAt,
                currentLocationPlayers: getCurrentLocationPlayers(),
                currentWorldName: domainRuntime.gameState.currentWorldName
            });
            entry = createJoinLeaveEntry(
                'OnPlayerJoined',
                gameLog.dt,
                displayName,
                location,
                userId
            );
            if (!runtimePersisted) {
                await gameLogRepository.addGamelogJoinLeaveToDatabase(entry);
            }
            break;
        }
        case 'player-left': {
            const userId = normalizeString(gameLog.userId);
            const displayName = normalizeString(gameLog.displayName);
            const joined = removeCurrentLocationPlayer(userId, displayName);
            const leftAt = Date.parse(gameLog.dt);
            const joinedAt = Number(joined?.joinTime);
            const duration =
                Number.isFinite(joinedAt) && Number.isFinite(leftAt)
                    ? Math.max(0, leftAt - joinedAt)
                    : 0;
            runtimeStore.setGameState({
                currentLocationPlayerIds: getCurrentLocationPlayerIds(),
                currentLocationPlayers: getCurrentLocationPlayers()
            });
            const domainRuntime = useRuntimeStore.getState();
            recordGameRuntimePresence({
                endpoint: domainRuntime.auth.currentUserEndpoint,
                currentUserId: domainRuntime.auth.currentUserId,
                currentUserSnapshot: domainRuntime.auth.currentUserSnapshot,
                currentLocation: domainRuntime.gameState.currentLocation,
                currentDestination: domainRuntime.gameState.currentDestination,
                currentLocationStartedAt:
                    domainRuntime.gameState.currentLocationStartedAt,
                currentLocationPlayers: getCurrentLocationPlayers(),
                currentWorldName: domainRuntime.gameState.currentWorldName
            });
            entry = createJoinLeaveEntry(
                'OnPlayerLeft',
                gameLog.dt,
                displayName,
                location,
                userId,
                duration
            );
            if (!runtimePersisted) {
                await gameLogRepository.addGamelogJoinLeaveToDatabase(entry);
            }
            break;
        }
        case 'portal-spawn':
            entry = createPortalSpawnEntry(gameLog.dt, location);
            if (!runtimePersisted) {
                await gameLogRepository.addGamelogPortalSpawnToDatabase(entry);
            }
            break;
        case 'video-play': {
            if (runtimeSideEffectHandled) {
                break;
            }
            const videoUrl = decodeURI(normalizeString(gameLog.videoUrl));
            if (!videoUrl || ingestState.lastVideoUrl === videoUrl) {
                break;
            }
            ingestState.lastVideoUrl = videoUrl;
            entry = await persistVideoEntry(
                await createVideoEntryWithMetadata({
                    dt: gameLog.dt,
                    location,
                    videoUrl,
                    displayName: normalizeString(gameLog.displayName),
                    userId: normalizeString(gameLog.userId)
                })
            );
            break;
        }
        case 'video-sync': {
            if (runtimeSideEffectHandled) {
                break;
            }
            const timestamp = Number.parseInt(
                normalizeString(gameLog.timestamp).replace(/,/g, ''),
                10
            );
            if (!Number.isNaN(timestamp) && runtimeStore.nowPlaying.url) {
                runtimeStore.setNowPlayingState({
                    position: Math.max(0, timestamp),
                    startedAt: gameLog.dt || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
            break;
        }
        case 'resource-load-string':
        case 'resource-load-image': {
            const logResourceLoad = await configRepository.getBool(
                'logResourceLoad',
                false
            );
            const resourceUrl = normalizeString(gameLog.resourceUrl);
            if (
                !logResourceLoad ||
                !resourceUrl ||
                ingestState.lastResourceUrl === resourceUrl
            ) {
                break;
            }
            ingestState.lastResourceUrl = resourceUrl;
            entry = createResourceLoadEntry(
                gameLog.type,
                gameLog.dt,
                resourceUrl,
                location
            );
            if (!runtimePersisted) {
                await gameLogRepository.addGamelogResourceLoadToDatabase(entry);
            }
            break;
        }
        case 'api-request': {
            if (runtimeSideEffectHandled) {
                break;
            }
            const requestUrl = normalizeString(gameLog.url);
            if (await configRepository.getBool('saveInstanceEmoji', false)) {
                enqueueEmojiSave(
                    instanceMediaState.emojiInventoryIds,
                    requestUrl
                );
            }
            if (await configRepository.getBool('saveInstancePrints', false)) {
                enqueuePrintSave(instanceMediaState.printIds, requestUrl);
            }
            break;
        }
        case 'event':
            entry = {
                created_at: gameLog.dt,
                type: 'Event',
                data: normalizeString(gameLog.event)
            };
            if (!runtimePersisted) {
                await gameLogRepository.addGamelogEventToDatabase(entry);
            }
            break;
        case 'vrcx':
            if (runtimeSideEffectHandled) {
                break;
            }
            entry = await persistProviderVideo(gameLog, location);
            break;
        case 'vrc-quit': {
            if (runtimeSideEffectHandled) {
                break;
            }
            const shouldQuit = await configRepository.getBool(
                'vrcQuitFix',
                true
            );
            if (
                shouldQuit &&
                useRuntimeStore.getState().gameState.isGameRunning
            ) {
                const bias = Date.parse(gameLog.dt) + 3000;
                if (bias >= Date.now()) {
                    await commands.appQuitGame().catch((error: unknown) => {
                        console.warn(
                            'QuitGame failed during vrc-quit handling:',
                            error
                        );
                    });
                }
            }
            break;
        }
        case 'openvr-init':
            runtimeStore.setGameState({ isGameNoVR: false });
            if (runtimeSideEffectHandled) {
                break;
            }
            await configRepository.setBool('isGameNoVR', false);
            break;
        case 'desktop-mode':
            runtimeStore.setGameState({ isGameNoVR: true });
            if (runtimeSideEffectHandled) {
                break;
            }
            await configRepository.setBool('isGameNoVR', true);
            break;
        case 'screenshot': {
            if (runtimeSideEffectHandled) {
                break;
            }
            const screenshotPath = await processScreenshot(
                gameLog.screenshotPath,
                {
                    screenshotDateTime: gameLog.dt,
                    copyToClipboard: copyScreenshotToClipboard
                }
            );
            runtimeStore.setGameState({
                lastScreenshotPath:
                    screenshotPath || normalizeString(gameLog.screenshotPath)
            });
            break;
        }
        case 'udon-exception':
            if (runtimeSideEffectHandled) {
                break;
            }
            if (await configRepository.getBool('udonExceptionLogging', false)) {
                console.log('UdonException', gameLog.data);
            }
            break;
        case 'sticker-spawn':
            if (runtimeSideEffectHandled) {
                break;
            }
            if (await configRepository.getBool('saveInstanceStickers', false)) {
                enqueueStickerSave(instanceMediaState.stickerInventoryIds, {
                    displayName: gameLog.displayName,
                    userId: gameLog.userId,
                    inventoryId: gameLog.inventoryId
                });
            }
            break;
        default:
            break;
    }

    return entry;
}

export async function initializeGameLogIngest() {
    if (
        ingestState.initialized &&
        (!isHostCapabilityAvailable('gameLogWatcher') ||
            ingestState.watcherInitialized)
    ) {
        return;
    }

    if (ingestState.initializing) {
        return ingestState.initializing;
    }

    ingestState.initializing = (async () => {
        await databaseMaintenanceRepository.initGlobalTables();
        if (!isHostCapabilityAvailable('gameLogWatcher')) {
            ingestState.tailCaughtUp = true;
            ingestState.initialized = true;
            ingestState.watcherInitialized = false;
            return;
        }
        if (isRuntimeGameLogSideEffectsActive()) {
            ingestState.tailCaughtUp = true;
            ingestState.initialized = true;
            ingestState.watcherInitialized = true;
            return;
        }
        const dateTill = await gameLogRepository.getLastDateGameLogDatabase();
        await commands.logWatcherSetDateTill(dateTill);
        ingestState.tailCaughtUp = false;
        ingestState.initialized = true;
        ingestState.watcherInitialized = true;
    })();

    try {
        await ingestState.initializing;
    } finally {
        ingestState.initializing = null;
    }
}

export function resetNowPlayingState() {
    nowPlayingState.url = '';
    resetRuntimeNowPlayingState();
}

export function resetGameLogIngestSessionState() {
    resetCurrentGameLogSessionState();
}

export async function finalizeCurrentGameLogSession(
    stoppedAt: string = new Date().toISOString(),
    options: { skipPersistence?: boolean } = {}
) {
    const runtimeStore = useRuntimeStore.getState();
    const runtimeGameState = runtimeStore.gameState;
    const location =
        ingestState.currentLocation ||
        normalizeString(runtimeGameState.currentLocation);
    const startedAt = String(
        ingestState.currentLocationStartedAt ||
            runtimeGameState.currentLocationStartedAt ||
            ''
    );
    const stoppedAtTime = Date.parse(stoppedAt);
    let persistenceError = null;
    const skipPersistence =
        options.skipPersistence ?? isRuntimeGameLogSideEffectsActive();

    try {
        if (location && Number.isFinite(stoppedAtTime) && !skipPersistence) {
            const leaveEntries: ReturnType<typeof createJoinLeaveEntry>[] = [];
            for (const player of ingestState.playersByKey.values()) {
                const joinedAt = Number(player.joinTime);
                leaveEntries.unshift(
                    createJoinLeaveEntry(
                        'OnPlayerLeft',
                        stoppedAt,
                        normalizeString(player.displayName),
                        location,
                        normalizeString(player.userId),
                        Number.isFinite(joinedAt)
                            ? Math.max(0, stoppedAtTime - joinedAt)
                            : 0
                    )
                );
            }

            if (leaveEntries.length > 0) {
                await gameLogRepository.addGamelogJoinLeaveBulk(leaveEntries);
            }

            const startedAtTime = Date.parse(startedAt);
            if (
                startedAt &&
                Number.isFinite(startedAtTime) &&
                stoppedAtTime >= startedAtTime
            ) {
                await gameLogRepository.updateGamelogLocationTimeToDatabase({
                    created_at: startedAt,
                    time: stoppedAtTime - startedAtTime
                });
            }
        }
    } catch (error) {
        persistenceError = error;
        console.warn('Failed to finalize game-log session:', error);
    } finally {
        resetCurrentGameLogSessionState();
        resetNowPlayingState();
        runtimeStore.setGameState({
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentDestination: '',
            currentLocationStartedAt: null,
            currentLocationPlayerIds: [],
            currentLocationPlayers: [],
            lastGameLogAt: stoppedAt,
            lastGameLogType: 'game-stopped'
        });
    }

    if (persistenceError) {
        throw persistenceError;
    }
}

export async function ingestRuntimeGameLogEvent(payload: unknown) {
    if (!isHostCapabilityAvailable('gameLogWatcher')) {
        return null;
    }

    if (await configRepository.getBool('gameLogDisabled', false)) {
        return null;
    }

    await initializeGameLogIngest();
    return persistGameLog(parseRawRow(payload) as GameLogRow);
}

export async function syncGameLogTail() {
    if (ingestState.syncing || !useSessionStore.getState().isLoggedIn) {
        return { processed: 0, skipped: true };
    }

    if (!isHostCapabilityAvailable('gameLogWatcher')) {
        return { processed: 0, skipped: true, unavailable: true };
    }

    if (isRuntimeGameLogSideEffectsActive()) {
        useRuntimeStore.getState().setUpdateLoopState({
            lastGameLogSyncAt: new Date().toISOString(),
            lastGameLogSyncDetail: 'Backend GameLog side effects are active.'
        });
        ingestState.tailCaughtUp = true;
        return { processed: 0, runtime: true };
    }

    if (
        ingestState.tailCaughtUp &&
        isHostCapabilityAvailable('gameProcessMonitor') &&
        useRuntimeStore.getState().gameState.isGameRunning === false
    ) {
        return { processed: 0, skipped: true, caughtUp: true };
    }

    ingestState.syncing = true;
    let processed = 0;

    try {
        if (await configRepository.getBool('gameLogDisabled', false)) {
            return { processed, disabled: true };
        }

        await initializeGameLogIngest();

        for (let i = 0; i < GAME_LOG_BATCH_LIMIT; i += 1) {
            const rows = await commands.logWatcherGet();
            if (!Array.isArray(rows) || rows.length === 0) {
                ingestState.tailCaughtUp = true;
                break;
            }

            ingestState.tailCaughtUp = false;
            for (const row of rows) {
                await persistGameLog(parseRawRow(row), {
                    copyScreenshotToClipboard: false
                });
                processed += 1;
            }
        }

        const detail =
            processed > 0
                ? `Processed ${processed} game log events.`
                : 'Game log tail is current.';
        useRuntimeStore.getState().setUpdateLoopState({
            lastGameLogSyncAt: new Date().toISOString(),
            lastGameLogSyncDetail: detail
        });
        return { processed };
    } finally {
        ingestState.syncing = false;
    }
}
