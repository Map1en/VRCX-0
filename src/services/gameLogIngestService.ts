import { backend } from '@/platform/index.js';
import {
    configRepository,
    databaseMaintenanceRepository,
    gameLogRepository
} from '@/repositories/index.js';
import { buildCurrentUserGameStatePresencePatch } from '@/shared/utils/currentUserPresence.js';
import {
    createJoinLeaveEntry,
    createLocationEntry,
    createPortalSpawnEntry,
    createResourceLoadEntry
} from '@/shared/utils/gameLog.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    enqueueEmojiSave,
    enqueuePrintSave,
    enqueueStickerSave
} from './game-log-ingest/instanceMediaSave.js';
import {
    shouldSkipBackendHandledGameLogSideEffect as shouldSkipBackendHandledGameLogSideEffectByCapability,
    shouldSkipBackendPersistedGameLog as shouldSkipBackendPersistedGameLogByCapability
} from './game-log-ingest/backendPersistence.js';
import {
    getPlayerKey,
    normalizeString,
    parseRawRow
} from './game-log-ingest/parsing.js';
import { processScreenshot } from './game-log-ingest/screenshotMetadata.js';
import {
    getCurrentLocation,
    getCurrentLocationPlayers,
    getCurrentLocationPlayerIds,
    ingestState,
    instanceMediaState,
    nowPlayingState,
    resetCurrentGameLogSessionState
} from './game-log-ingest/state.js';
import {
    createVideoEntryWithMetadata,
    persistProviderVideo,
    persistVideoEntry,
    resetRuntimeNowPlayingState
} from './game-log-ingest/videoPersistence.js';
import { recordGameRuntimePresence } from './domainIngestionService.js';
import { isHostCapabilityAvailable } from './hostCapabilityService.js';

const GAME_LOG_BATCH_LIMIT = 50;
type GameLogRow = Record<string, any>;

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function listFromBatch(batch: Record<string, any>, key: string): Record<string, any>[] {
    const value = batch[key];
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function field(record: Record<string, any>, snakeKey: string, camelKey?: string) {
    return record[snakeKey] ?? record[camelKey ?? snakeKey];
}

function textField(
    record: Record<string, any>,
    snakeKey: string,
    camelKey?: string
): string {
    return normalizeString(field(record, snakeKey, camelKey));
}

function numberField(record: Record<string, any>, key: string): number {
    const value = Number(field(record, key));
    return Number.isFinite(value) ? value : 0;
}

function isBackendGameLogIngestActive() {
    return isHostCapabilityAvailable('backendGameLogIngest');
}

function isBackendGameLogSideEffectsActive() {
    return isHostCapabilityAvailable('backendGameLogSideEffects');
}

function shouldSkipBackendPersistedGameLog(gameLog: GameLogRow) {
    return shouldSkipBackendPersistedGameLogByCapability(gameLog, {
        backendGameLogIngestAvailable: isBackendGameLogIngestActive()
    });
}

function shouldSkipBackendHandledGameLogSideEffect(gameLog: GameLogRow) {
    return shouldSkipBackendHandledGameLogSideEffectByCapability(gameLog, {
        backendGameLogSideEffectsAvailable: isBackendGameLogSideEffectsActive()
    });
}

function updateCurrentLocation({
    location,
    worldName = '',
    createdAt = ''
}: GameLogRow) {
    const parsed = parseLocation(location);
    const preserveTravelingPlayers =
        ingestState.currentLocation === 'traveling' && location !== 'traveling';
    ingestState.currentLocation = location;
    ingestState.currentWorldName = worldName;
    ingestState.currentLocationStartedAt =
        createdAt || new Date().toISOString();
    if (!preserveTravelingPlayers) {
        ingestState.playersByKey.clear();
    }
    ingestState.lastVideoUrl = '';
    ingestState.lastResourceUrl = '';

    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGameState({
        currentLocation: location,
        currentWorldId: parsed.worldId || '',
        currentWorldName: worldName,
        currentDestination: '',
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayerIds: getCurrentLocationPlayerIds(),
        currentLocationPlayers: getCurrentLocationPlayers(),
        lastGameLogAt: new Date().toISOString(),
        lastGameLogType: 'location'
    });

    patchCurrentUserLocationFromGameState(runtimeStore, {
        currentLocation: location,
        currentWorldId: parsed.worldId || '',
        currentWorldName: worldName,
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
        currentLocation: location,
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayers: getCurrentLocationPlayers(),
        currentWorldName: worldName
    });
}

function patchCurrentUserLocationFromGameState(
    runtimeStore: Record<string, any>,
    gameStatePatch: GameLogRow
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

    const startedAt = Date.parse(gameStatePatch.currentLocationStartedAt || '');
    const locationTime = Number.isFinite(startedAt) ? startedAt : Date.now();
    const timedPresencePatch = {
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

async function persistGameLog(gameLog: GameLogRow, options: GameLogRow = {}) {
    const runtimeStore = useRuntimeStore.getState();
    const location = getCurrentLocation();
    const copyScreenshotToClipboard =
        options.copyScreenshotToClipboard !== false;
    const backendPersisted = shouldSkipBackendPersistedGameLog(gameLog);
    const backendSideEffectHandled =
        shouldSkipBackendHandledGameLogSideEffect(gameLog);
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
                skipPersistence: backendPersisted
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
            if (!backendPersisted) {
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
            if (!backendPersisted) {
                await gameLogRepository.addGamelogJoinLeaveToDatabase(entry);
            }
            break;
        }
        case 'player-left': {
            const userId = normalizeString(gameLog.userId);
            const displayName = normalizeString(gameLog.displayName);
            const playerKey = getPlayerKey(userId, displayName);
            const joined = ingestState.playersByKey.get(playerKey) as
                | Record<string, any>
                | undefined;
            const leftAt = Date.parse(gameLog.dt);
            const duration =
                joined?.joinTime && Number.isFinite(leftAt)
                    ? Math.max(0, leftAt - joined.joinTime)
                    : 0;
            ingestState.playersByKey.delete(playerKey);
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
            if (!backendPersisted) {
                await gameLogRepository.addGamelogJoinLeaveToDatabase(entry);
            }
            break;
        }
        case 'portal-spawn':
            entry = createPortalSpawnEntry(gameLog.dt, location);
            if (!backendPersisted) {
                await gameLogRepository.addGamelogPortalSpawnToDatabase(entry);
            }
            break;
        case 'video-play': {
            if (backendSideEffectHandled) {
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
            if (backendSideEffectHandled) {
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
            if (!backendPersisted) {
                await gameLogRepository.addGamelogResourceLoadToDatabase(entry);
            }
            break;
        }
        case 'api-request': {
            if (backendSideEffectHandled) {
                break;
            }
            const requestUrl = normalizeString(gameLog.url);
            if (await configRepository.getBool('saveInstanceEmoji', false)) {
                void enqueueEmojiSave(
                    instanceMediaState.emojiInventoryIds,
                    requestUrl
                );
            }
            if (await configRepository.getBool('saveInstancePrints', false)) {
                void enqueuePrintSave(instanceMediaState.printIds, requestUrl);
            }
            break;
        }
        case 'event':
            entry = {
                created_at: gameLog.dt,
                type: 'Event',
                data: normalizeString(gameLog.event)
            };
            if (!backendPersisted) {
                await gameLogRepository.addGamelogEventToDatabase(entry);
            }
            break;
        case 'vrcx':
            if (backendSideEffectHandled) {
                break;
            }
            entry = await persistProviderVideo(gameLog, location);
            break;
        case 'vrc-quit': {
            if (backendSideEffectHandled) {
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
                    await backend.app.QuitGame().catch((error) => {
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
            if (backendSideEffectHandled) {
                break;
            }
            await configRepository.setBool('isGameNoVR', false);
            break;
        case 'desktop-mode':
            runtimeStore.setGameState({ isGameNoVR: true });
            if (backendSideEffectHandled) {
                break;
            }
            await configRepository.setBool('isGameNoVR', true);
            break;
        case 'screenshot': {
            if (backendSideEffectHandled) {
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
            if (backendSideEffectHandled) {
                break;
            }
            if (await configRepository.getBool('udonExceptionLogging', false)) {
                console.log('UdonException', gameLog.data);
            }
            break;
        case 'sticker-spawn':
            if (backendSideEffectHandled) {
                break;
            }
            if (await configRepository.getBool('saveInstanceStickers', false)) {
                void enqueueStickerSave(
                    instanceMediaState.stickerInventoryIds,
                    gameLog
                );
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
        if (isBackendGameLogSideEffectsActive()) {
            ingestState.tailCaughtUp = true;
            ingestState.initialized = true;
            ingestState.watcherInitialized = true;
            return;
        }
        const dateTill = await gameLogRepository.getLastDateGameLogDatabase();
        await backend.logWatcher.SetDateTill(dateTill);
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
        options.skipPersistence ?? isBackendGameLogSideEffectsActive();

    try {
        if (
            location &&
            Number.isFinite(stoppedAtTime) &&
            !skipPersistence
        ) {
            const leaveEntries = [];
            for (const playerValue of ingestState.playersByKey.values()) {
                const player = playerValue as Record<string, any>;
                leaveEntries.unshift(
                    createJoinLeaveEntry(
                        'OnPlayerLeft',
                        stoppedAt,
                        player.displayName,
                        location,
                        player.userId,
                        Number.isFinite(player.joinTime)
                            ? Math.max(0, stoppedAtTime - player.joinTime)
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

export async function ingestBackendGameLogEvent(payload: unknown) {
    if (!isHostCapabilityAvailable('gameLogWatcher')) {
        return null;
    }

    if (await configRepository.getBool('gameLogDisabled', false)) {
        return null;
    }

    await initializeGameLogIngest();
    return persistGameLog(parseRawRow(payload) as GameLogRow);
}

export async function persistBackendGameLogFallbackBatch(payload: unknown) {
    const record = isRecord(payload) ? payload : {};
    const batch = isRecord(record.batch) ? record.batch : {};

    for (const entry of listFromBatch(batch, 'locations')) {
        await gameLogRepository.addGamelogLocationToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            location: textField(entry, 'location'),
            worldId: textField(entry, 'world_id', 'worldId'),
            worldName: textField(entry, 'world_name', 'worldName'),
            time: numberField(entry, 'time'),
            groupName: textField(entry, 'group_name', 'groupName')
        });
    }

    for (const entry of listFromBatch(batch, 'location_time_updates')) {
        await gameLogRepository.updateGamelogLocationTimeToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            time: numberField(entry, 'time')
        });
    }

    const joinLeaveEntries = listFromBatch(batch, 'join_leave').map((entry) => ({
        created_at: textField(entry, 'created_at', 'createdAt'),
        type: textField(entry, 'event_type', 'eventType'),
        displayName: textField(entry, 'display_name', 'displayName'),
        location: textField(entry, 'location'),
        userId: textField(entry, 'user_id', 'userId'),
        time: numberField(entry, 'time')
    }));
    if (joinLeaveEntries.length > 0) {
        await gameLogRepository.addGamelogJoinLeaveBulk(joinLeaveEntries);
    }

    for (const entry of listFromBatch(batch, 'portal_spawns')) {
        await gameLogRepository.addGamelogPortalSpawnToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            displayName: textField(entry, 'display_name', 'displayName'),
            location: textField(entry, 'location'),
            userId: textField(entry, 'user_id', 'userId'),
            instanceId: textField(entry, 'instance_id', 'instanceId'),
            worldName: textField(entry, 'world_name', 'worldName')
        });
    }

    for (const entry of listFromBatch(batch, 'video_plays')) {
        await gameLogRepository.addGamelogVideoPlayToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            videoUrl: textField(entry, 'video_url', 'videoUrl'),
            videoName: textField(entry, 'video_name', 'videoName'),
            videoId: textField(entry, 'video_id', 'videoId'),
            location: textField(entry, 'location'),
            displayName: textField(entry, 'display_name', 'displayName'),
            userId: textField(entry, 'user_id', 'userId')
        });
    }

    for (const entry of listFromBatch(batch, 'resource_loads')) {
        await gameLogRepository.addGamelogResourceLoadToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            resourceUrl: textField(entry, 'resource_url', 'resourceUrl'),
            type: textField(entry, 'resource_type', 'resourceType'),
            location: textField(entry, 'location')
        });
    }

    for (const entry of listFromBatch(batch, 'events')) {
        await gameLogRepository.addGamelogEventToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            data: textField(entry, 'data')
        });
    }

    for (const entry of listFromBatch(batch, 'externals')) {
        await gameLogRepository.addGamelogExternalToDatabase({
            created_at: textField(entry, 'created_at', 'createdAt'),
            message: textField(entry, 'message'),
            displayName: textField(entry, 'display_name', 'displayName'),
            userId: textField(entry, 'user_id', 'userId'),
            location: textField(entry, 'location')
        });
    }
}

export async function syncGameLogTail() {
    if (ingestState.syncing || !useSessionStore.getState().isLoggedIn) {
        return { processed: 0, skipped: true };
    }

    if (!isHostCapabilityAvailable('gameLogWatcher')) {
        return { processed: 0, skipped: true, unavailable: true };
    }

    if (isBackendGameLogSideEffectsActive()) {
        useRuntimeStore.getState().setUpdateLoopState({
            lastGameLogSyncAt: new Date().toISOString(),
            lastGameLogSyncDetail: 'Backend GameLog side effects are active.'
        });
        ingestState.tailCaughtUp = true;
        return { processed: 0, backend: true };
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
            const rows = await backend.logWatcher.Get();
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
