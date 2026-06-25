import { parseLocation } from '@/shared/utils/location';

export const GAME_LOG_TYPE_LABELS: Record<string, string> = {
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

export function normalizeGameLogId(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function buildGameLogFavoriteIdSet(localFriendFavorites: any) {
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

export function describeGameLogDetail(row: any) {
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

export function resolveGameLogWorldTarget(row: any) {
    if (row?.type === 'PortalSpawn') {
        const portalLocation =
            normalizeGameLogId(row?.instanceId) ||
            normalizeGameLogId(row?.location);
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

export function resolveGameLogWorldId(row: any) {
    const target = resolveGameLogWorldTarget(row);
    return parseLocation(target).worldId || normalizeGameLogId(row?.worldId);
}

export function shouldLinkGameLogPrimaryDetailToWorld(row: any) {
    return row?.type === 'Location' || row?.type === 'PortalSpawn';
}

export function getGameLogLocationTarget(row: any) {
    if (row?.type === 'PortalSpawn') {
        return (
            normalizeGameLogId(row?.instanceId) ||
            normalizeGameLogId(row?.location)
        );
    }
    return (
        normalizeGameLogId(row?.location) || normalizeGameLogId(row?.instanceId)
    );
}

export function getGameLogExternalTarget(row: any) {
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

export function getGameLogCopyTarget(row: any) {
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

export function canDeleteGameLogRow(row: any) {
    return Boolean(row?.type && !GAME_LOG_UNACTIONABLE_TYPES.has(row.type));
}

export function getGameLogRowKey(row: any) {
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
        .map((value: any) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}

export function annotateGameLogSessionMember(
    member: any,
    favoriteIdSet: any,
    friendIdSet: any
) {
    const userId = normalizeGameLogId(member?.userId);
    return {
        ...member,
        isFavorite: userId ? favoriteIdSet.has(userId) : false,
        isFriend: userId ? friendIdSet.has(userId) : false
    };
}

export function annotateGameLogSessionEvent(
    event: any,
    favoriteIdSet: any,
    friendIdSet: any
) {
    const userId = normalizeGameLogId(event?.userId);
    return {
        ...event,
        isFavorite: userId
            ? favoriteIdSet.has(userId)
            : Boolean(event?.isFavorite),
        isFriend: userId ? friendIdSet.has(userId) : Boolean(event?.isFriend),
        members: Array.isArray(event?.members)
            ? event.members.map((member: any) =>
                  annotateGameLogSessionMember(
                      member,
                      favoriteIdSet,
                      friendIdSet
                  )
              )
            : []
    };
}

export function collectGameLogSessionFriends(events: any[] = []) {
    const seen = new Map<string, any>();
    for (const event of events) {
        const candidates =
            Array.isArray(event?.members) && event.members.length > 0
                ? event.members
                : [event];
        for (const candidate of candidates) {
            if (!candidate?.isFriend) {
                continue;
            }
            const userId = normalizeGameLogId(candidate.userId);
            const displayName = String(candidate.displayName || '');
            const key = userId || displayName;
            if (!key || seen.has(key)) {
                continue;
            }
            seen.set(key, {
                key,
                id: userId,
                userId,
                displayName,
                isFavorite: Boolean(candidate.isFavorite)
            });
        }
    }
    const friends = Array.from(seen.values());
    friends.sort(
        (left, right) => Number(right.isFavorite) - Number(left.isFavorite)
    );
    return friends;
}

export function countGameLogSessionEvent(events: any, type: any) {
    return events.reduce((count: any, event: any) => {
        if (type === 'OnPlayerJoined' && event.type === 'JoinGroup') {
            return count + (event.members?.length || event.count || 0);
        }
        if (type === 'OnPlayerLeft' && event.type === 'LeftGroup') {
            return count + (event.members?.length || event.count || 0);
        }
        return count + (event.type === type ? 1 : 0);
    }, 0);
}

export function resolveGameLogSessionDuration(session: any) {
    const duration = Number(session?.duration ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function getGameLogSessionKey(session: any) {
    return [session?.id, session?.created_at, session?.location]
        .map((value: any) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}
