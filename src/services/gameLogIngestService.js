import { backend } from '@/platform/index.js';
import {
    configRepository,
    databaseMaintenanceRepository,
    gameLogRepository,
    mediaRepository,
    vrchatFriendRepository,
    webRepository
} from '@/repositories/index.js';
import {
    getEmojiFileName,
    getPrintFileName,
    getPrintLocalDate
} from '@/shared/utils/gallery.js';
import {
    createJoinLeaveEntry,
    createLocationEntry,
    createPortalSpawnEntry,
    createResourceLoadEntry,
    parseInventoryFromUrl,
    parsePrintFromUrl
} from '@/shared/utils/gameLog.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { pushSharedFeedNotification } from './sharedFeedFilterService.js';

const GAME_LOG_BATCH_LIMIT = 50;
const SCREENSHOT_METADATA_FALLBACK_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;
const INSTANCE_MEDIA_SAVE_INTERVAL_MS = 2500;

const ingestState = {
    initialized: false,
    initializing: null,
    syncing: false,
    tailCaughtUp: false,
    currentLocation: '',
    currentWorldName: '',
    currentLocationStartedAt: '',
    playersByKey: new Map(),
    lastVideoUrl: '',
    lastResourceUrl: ''
};

const nowPlayingState = {
    url: ''
};

const instanceMediaState = {
    printIds: [],
    stickerInventoryIds: [],
    emojiInventoryIds: []
};
let instanceMediaSaveQueue = Promise.resolve();

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function parseRawGameLog(dt, type, args) {
    const gameLog = { dt, type };

    switch (type) {
        case 'location':
            gameLog.location = args[0];
            gameLog.worldName = args[1];
            break;
        case 'location-destination':
            gameLog.location = args[0];
            break;
        case 'player-joined':
        case 'player-left':
            gameLog.displayName = args[0];
            gameLog.userId = args[1];
            break;
        case 'notification':
            gameLog.json = args[0];
            break;
        case 'event':
            gameLog.event = args[0];
            break;
        case 'video-play':
            gameLog.videoUrl = args[0];
            gameLog.displayName = args[1];
            break;
        case 'resource-load-string':
        case 'resource-load-image':
            gameLog.resourceUrl = args[0];
            break;
        case 'video-sync':
            gameLog.timestamp = args[0];
            break;
        case 'vrcx':
        case 'udon-exception':
            gameLog.data = args[0];
            break;
        case 'api-request':
            gameLog.url = args[0];
            break;
        case 'avatar-change':
            gameLog.displayName = args[0];
            gameLog.avatarName = args[1];
            break;
        case 'screenshot':
            gameLog.screenshotPath = args[0];
            break;
        case 'sticker-spawn':
            gameLog.userId = args[0];
            gameLog.displayName = args[1];
            gameLog.inventoryId = args[2];
            break;
        default:
            break;
    }

    return gameLog;
}

function toRawRow(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (typeof payload === 'string') {
        return JSON.parse(payload);
    }

    if (payload && typeof payload === 'object' && Array.isArray(payload.raw)) {
        return payload.raw;
    }

    throw new Error('Unsupported game log payload shape.');
}

function parseRawRow(payload) {
    const row = toRawRow(payload);
    const [, dt, type, ...args] = row;
    if (!dt || !type) {
        throw new Error('Game log payload is missing dt or type.');
    }
    return parseRawGameLog(dt, type, args);
}

function getPlayerKey(userId, displayName) {
    const normalizedUserId = normalizeString(userId);
    return normalizedUserId || `display:${normalizeString(displayName)}`;
}

function getCurrentLocationPlayerIds() {
    return Array.from(
        new Set(
            Array.from(ingestState.playersByKey.values())
                .map((player) => normalizeString(player.userId))
                .filter(Boolean)
        )
    );
}

function getCurrentLocation() {
    return (
        ingestState.currentLocation ||
        normalizeString(useRuntimeStore.getState().gameState.currentLocation) ||
        normalizeString(
            useRuntimeStore.getState().auth.currentUserSnapshot?.location
        )
    );
}

function parseYouTubeVideoId(videoUrl) {
    try {
        let url = new URL(videoUrl);
        if (
            url.origin === 'https://t-ne.x0.to' ||
            url.origin === 'https://nextnex.com' ||
            url.origin === 'https://r.0cm.org'
        ) {
            url = new URL(url.searchParams.get('url'));
        }
        if (videoUrl.startsWith('https://u2b.cx/')) {
            url = new URL(videoUrl.substring(15));
        }

        const path = url.pathname;
        const queryId = url.searchParams.get('v');
        if (path && path.length === 12) {
            return path.substring(1, 12);
        }
        if (path && path.length === 19) {
            return path.substring(8, 19);
        }
        if (queryId && queryId.length === 11) {
            return queryId;
        }
    } catch {
        return '';
    }

    return '';
}

function parseWebJson(response) {
    if (response?.data && typeof response.data === 'object') {
        return response.data;
    }
    if (typeof response?.data === 'string' && response.data.trim()) {
        return JSON.parse(response.data);
    }
    return {};
}

function convertYouTubeDurationToSeconds(duration) {
    const match =
        /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
            normalizeString(duration)
        );
    if (!match) {
        return 0;
    }
    const [, hours, minutes, seconds] = match;
    return (
        Number.parseInt(hours || '0', 10) * 60 * 60 +
        Number.parseInt(minutes || '0', 10) * 60 +
        Number.parseInt(seconds || '0', 10)
    );
}

async function lookupYouTubeVideo(videoId) {
    const normalizedVideoId = normalizeString(videoId);
    if (!normalizedVideoId) {
        return null;
    }
    const [enabled, apiKey] = await Promise.all([
        configRepository.getBool('youtubeAPI', false).catch(() => false),
        configRepository.getString('youtubeAPIKey', '').catch(() => '')
    ]);
    if (!enabled || !apiKey) {
        return null;
    }
    try {
        const response = await webRepository.execute({
            url: `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(normalizedVideoId)}&part=snippet,contentDetails&key=${encodeURIComponent(apiKey)}`,
            method: 'GET'
        });
        const payload = parseWebJson(response);
        if (
            response.status !== 200 ||
            !Array.isArray(payload.items) ||
            !payload.items.length
        ) {
            return null;
        }
        const item = payload.items[0];
        const thumbnails = item?.snippet?.thumbnails || {};
        const thumbnail =
            thumbnails.maxres ||
            thumbnails.standard ||
            thumbnails.high ||
            thumbnails.medium ||
            thumbnails.default ||
            {};
        return {
            videoName: normalizeString(item?.snippet?.title),
            videoLength: convertYouTubeDurationToSeconds(
                item?.contentDetails?.duration
            ),
            thumbnailUrl: normalizeString(thumbnail.url)
        };
    } catch (error) {
        console.warn('Failed to lookup YouTube video metadata:', error);
        return null;
    }
}

function getFileNameFromPath(path) {
    return (
        String(path || '')
            .split(/[/\\]/)
            .pop() || ''
    );
}

function resetRuntimeNowPlayingState() {
    useRuntimeStore.getState().setNowPlayingState({
        url: '',
        name: '',
        source: '',
        displayName: '',
        thumbnailUrl: '',
        length: 0,
        position: 0,
        startedAt: null,
        updatedAt: new Date().toISOString()
    });
}

function buildScreenshotMetadataContext() {
    const location = getCurrentLocation();
    if (!location) {
        return null;
    }

    return {
        location,
        worldName:
            ingestState.currentWorldName ||
            normalizeString(
                useRuntimeStore.getState().gameState.currentWorldName
            ),
        players: Array.from(ingestState.playersByKey.values()).map(
            (player) => ({
                userId: player.userId || '',
                displayName: player.displayName || ''
            })
        )
    };
}

function resolveScreenshotTimestampFromInput(path, screenshotDateTime) {
    if (typeof screenshotDateTime === 'string' && screenshotDateTime) {
        const timestamp = Date.parse(screenshotDateTime);
        if (!Number.isNaN(timestamp)) {
            return timestamp;
        }
    }
    return parseVrchatScreenshotDateFromFileName(getFileNameFromPath(path));
}

async function resolveScreenshotTimestampFromFile(path) {
    try {
        const extra = await mediaRepository.getExtraScreenshotData(path, false);
        if (extra?.creationDate) {
            const timestamp = Date.parse(extra.creationDate);
            if (!Number.isNaN(timestamp)) {
                return timestamp;
            }
        }
    } catch (error) {
        console.warn('Failed to resolve screenshot timestamp:', error);
    }
    return null;
}

async function resolveScreenshotMetadataContext(path, screenshotDateTime) {
    const screenshotTimestamp =
        resolveScreenshotTimestampFromInput(path, screenshotDateTime) ??
        (await resolveScreenshotTimestampFromFile(path));
    if (screenshotTimestamp === null) {
        return null;
    }

    const screenshotDateIso = new Date(screenshotTimestamp).toJSON();
    const locationEntry =
        await gameLogRepository.getLocationBeforeOrAt(screenshotDateIso);
    if (!locationEntry?.location) {
        return null;
    }
    if (
        screenshotTimestamp - Date.parse(locationEntry.created_at) >
        SCREENSHOT_METADATA_FALLBACK_LOCATION_MAX_AGE_MS
    ) {
        return null;
    }

    const joinLeaveEntries =
        await gameLogRepository.getJoinLeaveEntriesForLocationRange(
            locationEntry.location,
            locationEntry.created_at,
            screenshotDateIso
        );

    const playerMap = new Map();
    for (const entry of joinLeaveEntries) {
        const playerKey = entry.userId || `display:${entry.displayName}`;
        if (entry.type === 'OnPlayerJoined') {
            playerMap.set(playerKey, {
                userId: entry.userId,
                displayName: entry.displayName
            });
        } else if (entry.type === 'OnPlayerLeft') {
            playerMap.delete(playerKey);
        }
    }

    return {
        location: locationEntry.location,
        worldName: locationEntry.worldName,
        players: Array.from(playerMap.values())
    };
}

async function processScreenshot(
    path,
    { screenshotDateTime, copyToClipboard: shouldCopyToClipboard = true } = {}
) {
    const screenshotPath = normalizeString(path);
    if (!screenshotPath) {
        return '';
    }

    const [screenshotHelper, modifyFilename, copyToClipboard] =
        await Promise.all([
            configRepository.getBool('screenshotHelper', true),
            configRepository.getBool('screenshotHelperModifyFilename', false),
            configRepository.getBool('screenshotHelperCopyToClipboard', false)
        ]);

    let nextPath = screenshotPath;
    if (screenshotHelper) {
        const screenshotContext =
            buildScreenshotMetadataContext() ??
            (await resolveScreenshotMetadataContext(
                screenshotPath,
                screenshotDateTime
            ));
        if (screenshotContext?.location) {
            const location = parseLocation(screenshotContext.location);
            const currentUser =
                useRuntimeStore.getState().auth.currentUserSnapshot || {};
            const metadata = {
                application: 'VRCX',
                version: 1,
                author: {
                    id:
                        currentUser.id ||
                        useRuntimeStore.getState().auth.currentUserId ||
                        '',
                    displayName:
                        currentUser.displayName ||
                        useRuntimeStore.getState().auth
                            .currentUserDisplayName ||
                        ''
                },
                world: {
                    name: screenshotContext.worldName || '',
                    id: location.worldId,
                    instanceId: screenshotContext.location
                },
                players: screenshotContext.players.map((player) => ({
                    id: player.userId || '',
                    displayName: player.displayName || ''
                }))
            };

            try {
                const metadataPath =
                    await mediaRepository.addScreenshotMetadata(
                        screenshotPath,
                        JSON.stringify(metadata),
                        location.worldId,
                        modifyFilename
                    );
                if (metadataPath) {
                    nextPath = metadataPath;
                }
            } catch (error) {
                console.error('Failed to add screenshot metadata:', error);
                return screenshotPath;
            }
        }
    }

    if (copyToClipboard && shouldCopyToClipboard) {
        await mediaRepository.copyImageToClipboard(nextPath).catch((error) => {
            console.error('Failed to copy screenshot to clipboard:', error);
        });
    }

    return nextPath;
}

function hasCachedMediaId(cache, id) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
        return true;
    }
    if (cache.includes(normalizedId)) {
        return true;
    }
    cache.push(normalizedId);
    if (cache.length > 100) {
        cache.shift();
    }
    return false;
}

async function getUgcFolderPath() {
    const configuredPath = normalizeString(
        await configRepository.getString('userGeneratedContentPath', '')
    );
    return normalizeString(
        await mediaRepository.getUgcPhotoLocation(configuredPath)
    );
}

function enqueueInstanceMediaSave(cache, id, task) {
    if (hasCachedMediaId(cache, id)) {
        return instanceMediaSaveQueue;
    }

    instanceMediaSaveQueue = instanceMediaSaveQueue
        .then(() => delay(INSTANCE_MEDIA_SAVE_INTERVAL_MS))
        .then(task)
        .catch((error) => {
            console.error('Failed to save instance media:', error);
        });
    return instanceMediaSaveQueue;
}

async function saveInstancePrintToFile(printId) {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = await mediaRepository.getPrint(printId, {
            endpoint: useRuntimeStore.getState().auth.currentUserEndpoint
        });
        const print = response.json;
        const imageUrl = print?.files?.image;
        if (!imageUrl) {
            console.warn('Print image URL is missing:', printId);
            return;
        }

        const createdAt = getPrintLocalDate(print);
        const monthFolder = createdAt.toISOString().slice(0, 7);
        const fileName = getPrintFileName(print);
        const filePath = await mediaRepository.savePrintToFile(
            imageUrl,
            ugcFolderPath,
            monthFolder,
            fileName
        );
        if (
            filePath &&
            (await configRepository.getBool('cropInstancePrints', false))
        ) {
            const cropped = await mediaRepository.cropPrintImage(filePath);
            if (!cropped) {
                console.warn('Failed to crop print image:', filePath);
            }
        }
    } catch (error) {
        console.error('Failed to save print to file:', error);
    }
}

async function saveInstanceStickerToFile({ displayName, userId, inventoryId }) {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = await mediaRepository.getUserInventoryItem(
            { inventoryId, userId },
            { endpoint: useRuntimeStore.getState().auth.currentUserEndpoint }
        );
        const item = response.json;
        if (
            item?.itemType !== 'sticker' ||
            !Array.isArray(item.flags) ||
            !item.flags.includes('ugc')
        ) {
            return;
        }

        const imageUrl = item.metadata?.imageUrl ?? item.imageUrl;
        const createdAt =
            normalizeString(item.created_at) || new Date().toISOString();
        const monthFolder = createdAt.slice(0, 7);
        const fileNameDate = createdAt
            .replace(/:/g, '-')
            .replace(/T/g, '_')
            .replace(/Z/g, '');
        const fileName = `${normalizeString(displayName)}_${fileNameDate}_${inventoryId}.png`;
        await mediaRepository.saveStickerToFile(
            imageUrl,
            ugcFolderPath,
            monthFolder,
            fileName
        );
    } catch (error) {
        console.error('Failed to save sticker to file:', error);
    }
}

async function saveInstanceEmojiToFile({ inventoryId, userId }) {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = await mediaRepository.getUserInventoryItem(
            { inventoryId, userId },
            { endpoint: useRuntimeStore.getState().auth.currentUserEndpoint }
        );
        const item = response.json;
        if (
            item?.itemType !== 'emoji' ||
            !Array.isArray(item.flags) ||
            !item.flags.includes('ugc')
        ) {
            return;
        }

        const endpoint = useRuntimeStore.getState().auth.currentUserEndpoint;
        let holderDisplayName = normalizeString(
            item.holderDisplayName || item.ownerDisplayName
        );
        const holderUserId = normalizeString(
            item.holderId || item.holder?.id || item.userId || userId
        );
        if (!holderDisplayName) {
            try {
                const userResponse = await vrchatFriendRepository.getUser({
                    userId: holderUserId || userId,
                    endpoint
                });
                holderDisplayName = normalizeString(
                    userResponse.json?.displayName
                );
            } catch (error) {
                console.warn(
                    'Failed to resolve emoji holder display name:',
                    error
                );
            }
        }

        const emoji = {
            ...(item.metadata || {}),
            name: `${holderDisplayName || holderUserId || userId}_${inventoryId}`
        };
        const imageUrl = item.metadata?.imageUrl ?? item.imageUrl;
        const createdAt =
            normalizeString(item.created_at) || new Date().toISOString();
        const monthFolder = createdAt.slice(0, 7);
        await mediaRepository.saveEmojiToFile(
            imageUrl,
            ugcFolderPath,
            monthFolder,
            getEmojiFileName(emoji)
        );
    } catch (error) {
        console.error('Failed to save emoji to file:', error);
    }
}

async function persistVideoEntry(entry) {
    if (!entry?.videoUrl) {
        return null;
    }

    entry.videoUrl = normalizeString(entry.videoUrl);
    if (!entry.videoUrl || nowPlayingState.url === entry.videoUrl) {
        return null;
    }

    if (!entry.userId && entry.displayName) {
        entry.userId = await resolveUserIdFromDisplayName(entry.displayName);
    }

    nowPlayingState.url = entry.videoUrl;
    useRuntimeStore.getState().setNowPlayingState({
        url: entry.videoUrl,
        name: entry.videoName || entry.videoUrl,
        source: entry.videoId || '',
        displayName: entry.displayName || '',
        thumbnailUrl: entry.thumbnailUrl || '',
        length: Number(entry.videoLength) || 0,
        position: Number(entry.videoPos) || 0,
        startedAt: entry.created_at || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    await gameLogRepository.addGamelogVideoPlayToDatabase(entry);
    void pushSharedFeedNotification({
        ...entry,
        message: [
            entry.videoName || entry.videoUrl,
            entry.displayName ? `(${entry.displayName})` : ''
        ]
            .filter(Boolean)
            .join(' '),
        notyName: [
            entry.videoName || entry.videoUrl,
            entry.displayName ? `(${entry.displayName})` : ''
        ]
            .filter(Boolean)
            .join(' ')
    }).catch((error) => {
        console.warn(
            'Failed to publish video shared feed notification:',
            error
        );
    });
    return entry;
}

async function resolveUserIdFromDisplayName(displayName) {
    const normalizedDisplayName = normalizeString(displayName);
    if (!normalizedDisplayName) {
        return '';
    }

    try {
        return normalizeString(
            await gameLogRepository.getUserIdFromDisplayName(
                normalizedDisplayName
            )
        );
    } catch (error) {
        console.warn('Failed to resolve video uploader display name:', error);
        return '';
    }
}

function createVideoEntry({
    dt,
    location,
    videoUrl,
    videoId = '',
    videoName = '',
    videoLength = 0,
    displayName = '',
    userId = '',
    videoPos = 8,
    thumbnailUrl = ''
}) {
    const youtubeId = videoId ? '' : parseYouTubeVideoId(videoUrl);
    return {
        created_at: dt,
        type: 'VideoPlay',
        videoUrl,
        videoId: videoId || (youtubeId ? 'YouTube' : ''),
        videoName: videoName || youtubeId || videoUrl,
        videoLength: Number(videoLength) || 0,
        location,
        displayName,
        userId,
        videoPos: Number(videoPos) || 0,
        thumbnailUrl
    };
}

async function createVideoEntryWithMetadata(args) {
    const entry = createVideoEntry(args);
    const youtubeId =
        entry.videoId === 'YouTube' ? parseYouTubeVideoId(entry.videoUrl) : '';
    if (!youtubeId) {
        return entry;
    }
    const metadata = await lookupYouTubeVideo(youtubeId);
    if (!metadata) {
        return entry;
    }
    return {
        ...entry,
        videoName: metadata.videoName || entry.videoName,
        videoLength: metadata.videoLength || entry.videoLength,
        thumbnailUrl: metadata.thumbnailUrl || entry.thumbnailUrl
    };
}

async function persistProviderVideo(gameLog, location) {
    const data = normalizeString(gameLog.data);
    const type = data.slice(0, data.indexOf(' '));

    if (type === 'VideoPlay(PyPyDance)') {
        const match =
            /VideoPlay\(PyPyDance\) "(.+?)",([\d.]+),([\d.]+),"(.*)"/g.exec(
                data
            );
        if (!match) return null;
        const title = match[4];
        const parts = title.split('(');
        let displayName = parts.pop()?.slice(0, -1) || '';
        let source = parts.join('(');
        let videoId = '';
        if (source === 'Custom URL') {
            videoId = 'YouTube';
        } else {
            videoId = source.substr(0, source.indexOf(':') - 1);
            source = source.substr(source.indexOf(':') + 2);
        }
        if (displayName === 'Random') displayName = '';
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: match[1],
                videoPos: match[2],
                videoLength: match[3],
                videoId,
                videoName: source.slice(0, -1),
                displayName
            })
        );
    }

    if (
        type === 'VideoPlay(VRDancing)' ||
        type === 'VideoPlay(ZuwaZuwaDance)'
    ) {
        const match =
            /VideoPlay\((?:VRDancing|ZuwaZuwaDance)\) "(.+?)",([\d.]+),([\d.]+),(-?[\d.]+),"(.+?)","(.+?)"/g.exec(
                data
            );
        if (!match) return null;
        let videoId = match[4];
        let displayName = match[5];
        let videoName = match[6];
        if (videoId === '-1' || videoId === '9999') {
            videoId = 'YouTube';
        }
        const markerIndex = videoName.indexOf(']</b> ');
        if (markerIndex !== -1) {
            videoName = videoName.substring(markerIndex + 6);
        }
        if (displayName === 'Random') displayName = '';
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: match[1],
                videoPos: match[2] === match[3] ? 0 : match[2],
                videoLength: match[3],
                videoId,
                videoName,
                displayName
            })
        );
    }

    if (type === 'LSMedia') {
        const match = /LSMedia ([\d.]+),([\d.]+),(.+?),(.+?),(?=[^,]*$)/g.exec(
            data
        );
        if (!match) return null;
        const videoName = match[4];
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: videoName,
                videoPos: match[1],
                videoLength: match[2],
                videoId: 'LSMedia',
                videoName,
                displayName: match[3]
            })
        );
    }

    if (type === 'VideoPlay(PopcornPalace)') {
        const jsonStart = data.indexOf('{');
        if (jsonStart < 0) return null;
        let parsed;
        try {
            parsed = JSON.parse(data.substring(jsonStart));
        } catch (error) {
            console.warn('Failed to parse PopcornPalace video payload:', error);
            return null;
        }
        if (!parsed.videoName) {
            nowPlayingState.url = '';
            resetRuntimeNowPlayingState();
            return null;
        }
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: parsed.videoName,
                videoPos: parsed.videoPos,
                videoLength: parsed.videoLength,
                videoId: 'PopcornPalace',
                videoName: parsed.videoName,
                displayName: parsed.displayName || '',
                thumbnailUrl: parsed.thumbnailUrl || ''
            })
        );
    }

    return null;
}

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
    const currentSnapshot = runtimeStore.auth.currentUserSnapshot;

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

    if (currentSnapshot && typeof currentSnapshot === 'object') {
        runtimeStore.setAuthBootstrap({
            currentUserSnapshot: {
                ...currentSnapshot,
                location,
                worldId: parsed.worldId || currentSnapshot.worldId || ''
            }
        });
    }
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
        case 'location-destination':
            runtimeStore.setGameState({
                currentDestination: normalizeString(gameLog.location),
                lastGameLogType: gameLog.type
            });
            break;
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
                const inventory = parseInventoryFromUrl(requestUrl);
                if (inventory) {
                    void enqueueInstanceMediaSave(
                        instanceMediaState.emojiInventoryIds,
                        inventory.inventoryId,
                        () => saveInstanceEmojiToFile(inventory)
                    );
                }
            }
            if (await configRepository.getBool('saveInstancePrints', false)) {
                const printId = parsePrintFromUrl(requestUrl);
                if (printId) {
                    void enqueueInstanceMediaSave(
                        instanceMediaState.printIds,
                        printId,
                        () => saveInstancePrintToFile(printId)
                    );
                }
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
                const inventoryId = normalizeString(gameLog.inventoryId);
                void enqueueInstanceMediaSave(
                    instanceMediaState.stickerInventoryIds,
                    inventoryId,
                    () =>
                        saveInstanceStickerToFile({
                            displayName: gameLog.displayName,
                            userId: gameLog.userId,
                            inventoryId
                        })
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

function resetCurrentGameLogSessionState() {
    ingestState.currentLocation = '';
    ingestState.currentWorldName = '';
    ingestState.currentLocationStartedAt = '';
    ingestState.playersByKey.clear();
    ingestState.lastVideoUrl = '';
    ingestState.lastResourceUrl = '';
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
