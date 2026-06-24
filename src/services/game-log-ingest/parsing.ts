import { delay } from '@/shared/utils/delays';

type RawGameLogRow = unknown[];
type ParsedGameLog = Record<string, unknown> & {
    dt: string;
    type: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function parseRawGameLog(
    dt: string,
    type: string,
    args: unknown[]
): ParsedGameLog {
    const gameLog: ParsedGameLog = { dt, type };

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
        case 'external':
            gameLog.message = args[0];
            gameLog.displayName = args[1];
            gameLog.userId = args[2];
            gameLog.location = args[3];
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

function toRawRow(payload: unknown): RawGameLogRow {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (typeof payload === 'string') {
        return JSON.parse(payload);
    }

    if (isRecord(payload) && Array.isArray(payload.raw)) {
        return payload.raw;
    }

    throw new Error('Unsupported game log payload shape.');
}

function parseRawRow(payload: unknown): ParsedGameLog {
    const row = toRawRow(payload);
    const [, rawDt, rawType, ...args] = row;
    const dt = normalizeString(rawDt);
    const type = normalizeString(rawType);
    if (!dt || !type) {
        throw new Error('Game log payload is missing dt or type.');
    }
    const gameLog = parseRawGameLog(dt, type, args);
    if (isRecord(payload) && payload.runtimePersisted === true) {
        gameLog.runtimePersisted = true;
    }
    return gameLog;
}

function getPlayerKey(userId: unknown, displayName: unknown): string {
    const normalizedUserId = normalizeString(userId);
    return normalizedUserId || `display:${normalizeString(displayName)}`;
}

function parseYouTubeVideoId(videoUrl: string): string {
    try {
        let url = new URL(videoUrl);
        if (
            url.origin === 'https://t-ne.x0.to' ||
            url.origin === 'https://nextnex.com' ||
            url.origin === 'https://r.0cm.org'
        ) {
            url = new URL(url.searchParams.get('url') as string);
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

function parseWebJson(response: unknown): Record<string, unknown> {
    const responseRecord = isRecord(response) ? response : {};
    const data = responseRecord.data;
    if (data && typeof data === 'object') {
        return data as Record<string, unknown>;
    }
    if (typeof data === 'string' && data.trim()) {
        const parsed = JSON.parse(data);
        return isRecord(parsed) ? parsed : {};
    }
    return {};
}

function convertYouTubeDurationToSeconds(duration: unknown): number {
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

function getFileNameFromPath(path: unknown): string {
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
export type { ParsedGameLog };
