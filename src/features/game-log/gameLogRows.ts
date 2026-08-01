import { parseLocation } from '@/shared/utils/location';

import type {
    GameLogRow,
    GameLogSession,
    GameLogSessionEvent,
    GameLogSessionMember
} from './gameLogTypes';

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

export function normalizeGameLogId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function buildGameLogFavoriteIdSet(
    localFriendFavorites: Record<string, unknown> | null | undefined
) {
    const ids = new Set<string>();
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

export function describeGameLogDetail(row: GameLogRow | null | undefined) {
    switch (normalizeGameLogId(row?.type)) {
        case 'Location':
            return {
                primary: normalizeGameLogId(row?.worldName || row?.location),
                secondary: ''
            };
        case 'PortalSpawn':
            return {
                primary: normalizeGameLogId(row?.worldName || row?.instanceId),
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
            const videoLabel = normalizeGameLogId(
                row?.videoName || row?.videoUrl
            );
            const leading = row?.videoId
                ? `${normalizeGameLogId(row.videoId)}: ${videoLabel}`
                : videoLabel;
            return {
                primary: leading,
                secondary: ''
            };
        }
        case 'Event':
            return {
                primary: normalizeGameLogId(row?.data),
                secondary: ''
            };
        case 'External':
            return {
                primary: normalizeGameLogId(row?.message),
                secondary: ''
            };
        case 'StringLoad':
        case 'ImageLoad':
            return {
                primary: normalizeGameLogId(row?.resourceUrl),
                secondary: ''
            };
        default:
            return {
                primary: normalizeGameLogId(
                    row?.message || row?.data || row?.location
                ),
                secondary: ''
            };
    }
}

export function resolveGameLogWorldTarget(row: GameLogRow | null | undefined) {
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

export function resolveGameLogWorldId(row: GameLogRow | null | undefined) {
    const target = resolveGameLogWorldTarget(row);
    return parseLocation(target).worldId || normalizeGameLogId(row?.worldId);
}

export function shouldLinkGameLogPrimaryDetailToWorld(
    row: GameLogRow | null | undefined
) {
    const type = normalizeGameLogId(row?.type);
    return type === 'Location' || type === 'PortalSpawn';
}

export function getGameLogLocationTarget(row: GameLogRow | null | undefined) {
    if (normalizeGameLogId(row?.type) === 'PortalSpawn') {
        return (
            normalizeGameLogId(row?.instanceId) ||
            normalizeGameLogId(row?.location)
        );
    }
    return (
        normalizeGameLogId(row?.location) || normalizeGameLogId(row?.instanceId)
    );
}

export function getGameLogExternalTarget(row: GameLogRow | null | undefined) {
    const type = normalizeGameLogId(row?.type);
    if (type === 'VideoPlay') {
        if (row?.videoId === 'LSMedia' || row?.videoId === 'PopcornPalace') {
            return '';
        }
        return normalizeGameLogId(row?.videoUrl);
    }

    if (type === 'StringLoad' || type === 'ImageLoad') {
        return normalizeGameLogId(row?.resourceUrl);
    }

    return '';
}

export function getGameLogCopyTarget(row: GameLogRow | null | undefined) {
    const type = normalizeGameLogId(row?.type);
    if (GAME_LOG_DETAILLESS_TYPES.has(type)) {
        return '';
    }

    if (type === 'Event') {
        return normalizeGameLogId(row?.data);
    }

    if (type === 'VideoPlay') {
        return normalizeGameLogId(row?.videoUrl || row?.videoName || row?.data);
    }

    if (type === 'StringLoad' || type === 'ImageLoad') {
        return normalizeGameLogId(row?.resourceUrl);
    }

    return normalizeGameLogId(row?.data || row?.message);
}

export function canDeleteGameLogRow(row: GameLogRow | null | undefined) {
    const type = normalizeGameLogId(row?.type);
    return Boolean(type && !GAME_LOG_UNACTIONABLE_TYPES.has(type));
}

export function getGameLogRowKey(row: GameLogRow | null | undefined) {
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

export function annotateGameLogSessionMember(
    member: GameLogSessionMember,
    favoriteIdSet: ReadonlySet<string>,
    friendIdSet: ReadonlySet<string>
) {
    const userId = normalizeGameLogId(member?.userId);
    return {
        ...member,
        isFavorite: userId ? favoriteIdSet.has(userId) : false,
        isFriend: userId ? friendIdSet.has(userId) : false
    };
}

export function annotateGameLogSessionEvent(
    event: GameLogSessionEvent,
    favoriteIdSet: ReadonlySet<string>,
    friendIdSet: ReadonlySet<string>
) {
    const userId = normalizeGameLogId(event?.userId);
    return {
        ...event,
        isFavorite: userId
            ? favoriteIdSet.has(userId)
            : Boolean(event?.isFavorite),
        isFriend: userId ? friendIdSet.has(userId) : Boolean(event?.isFriend),
        members: Array.isArray(event?.members)
            ? event.members.map((member) =>
                  annotateGameLogSessionMember(
                      member,
                      favoriteIdSet,
                      friendIdSet
                  )
              )
            : []
    };
}

export function collectGameLogSessionFriends(
    events: readonly GameLogSessionEvent[] = []
) {
    const seen = new Map<
        string,
        {
            key: string;
            id: string;
            userId: string;
            displayName: string;
            isFavorite: boolean;
        }
    >();
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

export function resolveGameLogSessionDuration(
    session: GameLogSession | null | undefined
) {
    const duration = Number(session?.duration ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function getGameLogSessionKey(
    session: GameLogSession | null | undefined
) {
    return [session?.id, session?.created_at, session?.location]
        .map((value) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}
