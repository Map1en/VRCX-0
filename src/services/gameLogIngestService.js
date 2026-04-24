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
    getPlayerKey,
    normalizeString,
    parseRawRow
} from './game-log-ingest/parsing.js';
import { processScreenshot } from './game-log-ingest/screenshotMetadata.js';
import {
    getCurrentLocation,
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

const GAME_LOG_BATCH_LIMIT = 50;

function updateCurrentLocation({ location, worldName = '', createdAt = '' }) {
    const parsed = parseLocation(location);
    ingestState.currentLocation = location;
    ingestState.currentWorldName = worldName;
    ingestState.currentLocationStartedAt =
        createdAt || new Date().toISOString();
    ingestState.playersByKey.clear();
    ingestState.lastVideoUrl = '';
    ingestState.lastResourceUrl = '';

    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGameState({
        currentLocation: location,
        currentWorldId: parsed.worldId || '',
        currentWorldName: worldName,
        currentDestination: '',
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayerIds: [],
        lastGameLogAt: new Date().toISOString(),
        lastGameLogType: 'location'
    });

    patchCurrentUserLocationFromGameState(runtimeStore, {
        currentLocation: location,
        currentWorldId: parsed.worldId || '',
        currentWorldName: worldName,
        currentDestination: '',
        currentLocationStartedAt: ingestState.currentLocationStartedAt,
        currentLocationPlayerIds: []
    });
}

function patchCurrentUserLocationFromGameState(runtimeStore, gameStatePatch) {
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

async function persistGameLog(gameLog, options = {}) {
    const runtimeStore = useRuntimeStore.getState();
    const location = getCurrentLocation();
    const copyScreenshotToClipboard =
        options.copyScreenshotToClipboard !== false;
    let entry = null;

    runtimeStore.setGameState({
        lastGameLogAt: gameLog.dt || new Date().toISOString(),
        lastGameLogType: gameLog.type
    });

    switch (gameLog.type) {
        case 'location-destination': {
            const destination = normalizeString(gameLog.location);
            if (!runtimeStore.gameState.isGameRunning || !destination) {
                break;
            }
            const changedAt = gameLog.dt || new Date().toISOString();
            await finalizeCurrentGameLogSession(changedAt);
            runtimeStore.setGameState({
                currentLocation: 'traveling',
                currentWorldId: '',
                currentWorldName: '',
                currentDestination: destination,
                currentLocationStartedAt: changedAt,
                currentLocationPlayerIds: [],
                lastGameLogAt: changedAt,
                lastGameLogType: gameLog.type
            });
            patchCurrentUserLocationFromGameState(runtimeStore, {
                currentLocation: 'traveling',
                currentWorldId: '',
                currentWorldName: '',
                currentDestination: destination,
                currentLocationStartedAt: changedAt,
                currentLocationPlayerIds: []
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
            await gameLogRepository.addGamelogLocationToDatabase(entry);
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
                currentLocationPlayerIds: getCurrentLocationPlayerIds()
            });
            entry = createJoinLeaveEntry(
                'OnPlayerJoined',
                gameLog.dt,
                displayName,
                location,
                userId
            );
            await gameLogRepository.addGamelogJoinLeaveToDatabase(entry);
            break;
        }
        case 'player-left': {
            const userId = normalizeString(gameLog.userId);
            const displayName = normalizeString(gameLog.displayName);
            const playerKey = getPlayerKey(userId, displayName);
            const joined = ingestState.playersByKey.get(playerKey);
            const leftAt = Date.parse(gameLog.dt);
            const duration =
                joined?.joinTime && Number.isFinite(leftAt)
                    ? Math.max(0, leftAt - joined.joinTime)
                    : 0;
            ingestState.playersByKey.delete(playerKey);
            runtimeStore.setGameState({
                currentLocationPlayerIds: getCurrentLocationPlayerIds()
            });
            entry = createJoinLeaveEntry(
                'OnPlayerLeft',
                gameLog.dt,
                displayName,
                location,
                userId,
                duration
            );
            await gameLogRepository.addGamelogJoinLeaveToDatabase(entry);
            break;
        }
        case 'portal-spawn':
            entry = createPortalSpawnEntry(gameLog.dt, location);
            await gameLogRepository.addGamelogPortalSpawnToDatabase(entry);
            break;
        case 'video-play': {
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
            await gameLogRepository.addGamelogResourceLoadToDatabase(entry);
            break;
        }
        case 'api-request': {
            const requestUrl = normalizeString(gameLog.url);
            if (await configRepository.getBool('saveInstanceEmoji', false)) {
                void enqueueEmojiSave(
                    instanceMediaState.emojiInventoryIds,
                    requestUrl
                );
            }
            if (await configRepository.getBool('saveInstancePrints', false)) {
                void enqueuePrintSave(
                    instanceMediaState.printIds,
                    requestUrl
                );
            }
            break;
        }
        case 'event':
            entry = {
                created_at: gameLog.dt,
                type: 'Event',
                data: normalizeString(gameLog.event)
            };
            await gameLogRepository.addGamelogEventToDatabase(entry);
            break;
        case 'vrcx':
            entry = await persistProviderVideo(gameLog, location);
            break;
        case 'vrc-quit': {
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
            await configRepository.setBool('isGameNoVR', false);
            break;
        case 'desktop-mode':
            runtimeStore.setGameState({ isGameNoVR: true });
            await configRepository.setBool('isGameNoVR', true);
            break;
        case 'screenshot': {
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
            if (await configRepository.getBool('udonExceptionLogging', false)) {
                console.log('UdonException', gameLog.data);
            }
            break;
        case 'sticker-spawn':
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
    if (ingestState.initialized) {
        return;
    }

    if (ingestState.initializing) {
        return ingestState.initializing;
    }

    ingestState.initializing = (async () => {
        await databaseMaintenanceRepository.initGlobalTables();
        const dateTill = await gameLogRepository.getLastDateGameLogDatabase();
        await backend.logWatcher.SetDateTill(dateTill);
        ingestState.tailCaughtUp = false;
        ingestState.initialized = true;
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
    stoppedAt = new Date().toISOString()
) {
    const runtimeStore = useRuntimeStore.getState();
    const runtimeGameState = runtimeStore.gameState;
    const location =
        ingestState.currentLocation ||
        normalizeString(runtimeGameState.currentLocation);
    const startedAt =
        ingestState.currentLocationStartedAt ||
        runtimeGameState.currentLocationStartedAt ||
        '';
    const stoppedAtTime = Date.parse(stoppedAt);
    let persistenceError = null;

    try {
        if (location && Number.isFinite(stoppedAtTime)) {
            const leaveEntries = [];
            for (const player of ingestState.playersByKey.values()) {
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
            lastGameLogAt: stoppedAt,
            lastGameLogType: 'game-stopped'
        });
    }

    if (persistenceError) {
        throw persistenceError;
    }
}

export async function ingestBackendGameLogEvent(payload) {
    if (await configRepository.getBool('gameLogDisabled', false)) {
        return null;
    }

    await initializeGameLogIngest();
    return persistGameLog(parseRawRow(payload));
}

export async function syncGameLogTail() {
    if (ingestState.syncing || !useSessionStore.getState().isLoggedIn) {
        return { processed: 0, skipped: true };
    }

    if (
        ingestState.tailCaughtUp &&
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
