import { parseLocation } from '@/shared/utils/locationParser.js';

export const GAME_LOG_TYPE_LABELS = {
    Location: 'Location',
    OnPlayerJoined: 'Player Joined',
    OnPlayerLeft: 'Player Left',
    PortalSpawn: 'Portal Spawn',
    VideoPlay: 'Video Play',
    Event: 'Event',
    External: 'External',
    StringLoad: 'String Load',
    ImageLoad: 'Image Load'
};

export const GAME_LOG_DETAILLESS_TYPES = new Set([
    'OnPlayerJoined',
    'OnPlayerLeft',
    'Notification'
]);

const GAME_LOG_UNACTIONABLE_TYPES = new Set([
    'OnPlayerJoined',
    'OnPlayerLeft',
    'Location',
    'PortalSpawn'
]);

function normalizeGameLogId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function buildGameLogFavoriteIdSet(localFriendFavorites) {
    const ids = new Set();
    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(groupIds)) {
            continue;
        }
        for (const id of groupIds) {
            const normalized = normalizeGameLogId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

export function describeGameLogDetail(row) {
    switch (row?.type) {
        case 'Location':
            return {
                primary: row?.worldName || row?.location || '',
                secondary: ''
            };
        case 'PortalSpawn':
            return {
                primary: row?.worldName || row?.instanceId || '',
                secondary: ''
            };
        case 'OnPlayerJoined':
        case 'OnPlayerLeft':
        case 'Notification':
            return {
                primary: '',
                secondary: ''
            };
        case 'VideoPlay': {
            const videoLabel = row?.videoName || row?.videoUrl || '';
            const leading = row?.videoId
                ? `${row.videoId}: ${videoLabel}`
                : videoLabel;
            return {
                primary: leading,
                secondary: ''
            };
        }
        case 'Event':
            return {
                primary: row?.data || '',
                secondary: ''
            };
        case 'External':
            return {
                primary: row?.message || '',
                secondary: ''
            };
        case 'StringLoad':
        case 'ImageLoad':
            return {
                primary: row?.resourceUrl || '',
                secondary: ''
            };
        default:
            return {
                primary: row?.message || row?.data || row?.location || '',
                secondary: ''
            };
    }
}

export function resolveGameLogWorldTarget(row) {
    if (row?.type === 'PortalSpawn') {
        const portalLocation =
            normalizeGameLogId(row?.instanceId) || normalizeGameLogId(row?.location);
        if (parseLocation(portalLocation).worldId) {
            return portalLocation;
        }
    }

    const directLocation = normalizeGameLogId(row?.location);
    if (parseLocation(directLocation).worldId) {
        return directLocation;
    }

    const directWorldId = normalizeGameLogId(row?.worldId);
    if (directWorldId) {
        return directWorldId;
    }

    const directInstance = normalizeGameLogId(row?.instanceId);
    return parseLocation(directInstance).worldId ? directInstance : '';
}

export function resolveGameLogWorldId(row) {
    const target = resolveGameLogWorldTarget(row);
    return parseLocation(target).worldId || normalizeGameLogId(row?.worldId);
}

export function shouldLinkGameLogPrimaryDetailToWorld(row) {
    return row?.type === 'Location' || row?.type === 'PortalSpawn';
}

export function getGameLogLocationTarget(row) {
    if (row?.type === 'PortalSpawn') {
        return normalizeGameLogId(row?.instanceId) || normalizeGameLogId(row?.location);
    }
    return normalizeGameLogId(row?.location) || normalizeGameLogId(row?.instanceId);
}

export function getGameLogExternalTarget(row) {
    if (row?.type === 'VideoPlay') {
        if (row?.videoId === 'LSMedia' || row?.videoId === 'PopcornPalace') {
            return '';
        }
        return row?.videoUrl || '';
    }

    if (row?.type === 'StringLoad' || row?.type === 'ImageLoad') {
        return row?.resourceUrl || '';
    }

    return '';
}

export function getGameLogCopyTarget(row) {
    if (GAME_LOG_DETAILLESS_TYPES.has(row?.type)) {
        return '';
    }

    if (row?.type === 'Event') {
        return row?.data || '';
    }

    if (row?.type === 'VideoPlay') {
        return row?.videoUrl || row?.videoName || row?.data || '';
    }

    if (row?.type === 'StringLoad' || row?.type === 'ImageLoad') {
        return row?.resourceUrl || '';
    }

    return row?.data || row?.message || '';
}

export function canDeleteGameLogRow(row) {
    return Boolean(row?.type && !GAME_LOG_UNACTIONABLE_TYPES.has(row.type));
}

export function getGameLogRowKey(row) {
    return [
        row?.type,
        row?.created_at,
        row?.videoUrl,
        row?.data,
        row?.message,
        row?.resourceUrl,
        row?.location,
        row?.rowId,
        row?.id
    ]
        .map((value) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}

export function annotateGameLogSessionMember(member, favoriteIdSet, friendIdSet) {
    const userId = normalizeGameLogId(member?.userId);
    return {
        ...member,
        isFavorite: userId ? favoriteIdSet.has(userId) : false,
        isFriend: userId ? friendIdSet.has(userId) : false
    };
}

export function annotateGameLogSessionEvent(event, favoriteIdSet, friendIdSet) {
    const userId = normalizeGameLogId(event?.userId);
    return {
        ...event,
        isFavorite: userId ? favoriteIdSet.has(userId) : Boolean(event?.isFavorite),
        isFriend: userId ? friendIdSet.has(userId) : Boolean(event?.isFriend),
        members: Array.isArray(event?.members)
            ? event.members.map((member) =>
                annotateGameLogSessionMember(member, favoriteIdSet, friendIdSet)
            )
            : []
    };
}

export function countGameLogSessionEvent(events, type) {
    return events.reduce((count, event) => {
        if (type === 'OnPlayerJoined' && event.type === 'JoinGroup') {
            return count + (event.members?.length || event.count || 0);
        }
        if (type === 'OnPlayerLeft' && event.type === 'LeftGroup') {
            return count + (event.members?.length || event.count || 0);
        }
        return count + (event.type === type ? 1 : 0);
    }, 0);
}

export function resolveGameLogSessionDuration(session) {
    const duration = Number(session?.duration ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function getGameLogSessionKey(session) {
    return [
        session?.id,
        session?.created_at,
        session?.location
    ]
        .map((value) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}
