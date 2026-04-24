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

function getFileNameFromPath(path) {
    return (
        String(path || '')
            .split(/[/\\]/)
            .pop() || ''
    );
}

export {
    convertYouTubeDurationToSeconds,
    delay,
    getFileNameFromPath,
    getPlayerKey,
    normalizeString,
    parseRawRow,
    parseWebJson,
    parseYouTubeVideoId
};
