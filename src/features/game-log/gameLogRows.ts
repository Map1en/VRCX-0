import type { FavoriteGroupMap } from '@/domain/favorites/types';
import { parseLocation } from '@/shared/utils/location';

import type {
    GameLogRowView,
    GameLogSession,
    GameLogSessionEvent
} from './gameLogTypes';

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

export function normalizeGameLogId(value: string | number | null | undefined) {
    return typeof value === 'number' ? String(value) : (value ?? '').trim();
}

export function buildGameLogFavoriteIdSet(
    remoteFavoriteIds: readonly string[] | null | undefined,
    localFriendFavorites: FavoriteGroupMap | null | undefined
) {
    const ids = new Set<string>();

    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeGameLogId(id);
        if (normalized) {
            ids.add(normalized);
        }
    }

    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        for (const id of groupIds) {
            const normalized = normalizeGameLogId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

export function describeGameLogDetail(row: GameLogRowView | null | undefined) {
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

export function resolveGameLogWorldTarget(
    row: GameLogRowView | null | undefined
) {
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

export function resolveGameLogWorldId(row: GameLogRowView | null | undefined) {
    const target = resolveGameLogWorldTarget(row);
    return parseLocation(target).worldId || normalizeGameLogId(row?.worldId);
}

export function shouldLinkGameLogPrimaryDetailToWorld(
    row: GameLogRowView | null | undefined
) {
    const type = normalizeGameLogId(row?.type);
    return type === 'Location' || type === 'PortalSpawn';
}

export function getGameLogLocationTarget(
    row: GameLogRowView | null | undefined
) {
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

export function getGameLogExternalTarget(
    row: GameLogRowView | null | undefined
) {
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

export function getGameLogCopyTarget(row: GameLogRowView | null | undefined) {
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

export function canDeleteGameLogRow(row: GameLogRowView | null | undefined) {
    const type = normalizeGameLogId(row?.type);
    return Boolean(type && !GAME_LOG_UNACTIONABLE_TYPES.has(type));
}

export function getGameLogRowKey(row: GameLogRowView | null | undefined) {
    return [
        row?.type,
        row?.created_at,
        row?.videoUrl,
        row?.data,
        row?.message,
        row?.resourceUrl,
        row?.location,
        row?.rowId
    ]
        .map((value) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}

export function getGameLogSessionPlayerAffinity(
    player: { userId?: string | null },
    favoriteIdSet: ReadonlySet<string>,
    friendIdSet: ReadonlySet<string>
): { isFavorite: boolean; isFriend: boolean } {
    const userId = normalizeGameLogId(player?.userId);
    return {
        isFavorite: Boolean(userId) && favoriteIdSet.has(userId),
        isFriend: Boolean(userId) && friendIdSet.has(userId)
    };
}

export function collectGameLogSessionFriends(
    events: readonly GameLogSessionEvent[],
    favoriteIdSet: ReadonlySet<string>,
    friendIdSet: ReadonlySet<string>
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
            const { isFavorite, isFriend } = getGameLogSessionPlayerAffinity(
                candidate,
                favoriteIdSet,
                friendIdSet
            );
            if (!isFriend) {
                continue;
            }
            const userId = normalizeGameLogId(candidate.userId);
            const displayName = String(candidate.displayName || '');
            if (seen.has(userId)) {
                continue;
            }
            seen.set(userId, {
                key: userId,
                id: userId,
                userId,
                displayName,
                isFavorite
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
    session: Pick<GameLogSession, 'duration'> | null | undefined
) {
    const duration = session?.duration ?? 0;
    return duration > 0 ? duration : 0;
}

export function getGameLogSessionKey(
    session:
        | Pick<GameLogSession, 'created_at' | 'id' | 'location'>
        | null
        | undefined
) {
    return [session?.id, session?.created_at, session?.location]
        .map((value) => normalizeGameLogId(value))
        .filter(Boolean)
        .join(':');
}
