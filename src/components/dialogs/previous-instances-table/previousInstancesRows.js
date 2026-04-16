import { timeToText } from '@/lib/dateTime.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

export function createdTime(row) {
    return new Date(row?.created_at || row?.createdAt || 0).getTime() || 0;
}

export function rowLocation(row) {
    return (
        row?.$location?.tag || row?.location || row?.worldId || row?.id || ''
    );
}

export function rowWorldId(row) {
    const location = rowLocation(row);
    return parseLocation(location).worldId || '';
}

export function rowOwnerUserId(row) {
    return (
        row?.$location?.userId ||
        row?.$location?.user_id ||
        row?.$location?.ownerUserId ||
        row?.$location?.owner_user_id ||
        row?.ownerUserId ||
        row?.owner_user_id ||
        row?.ownerId ||
        row?.owner_id ||
        row?.userId ||
        row?.user_id ||
        ''
    );
}

export function rowLocationObject(row) {
    const location = rowLocation(row);
    const ownerUserId = rowOwnerUserId(row);
    const baseLocation = {
        ...parseLocation(location),
        tag: location,
        location,
        worldName: row?.worldName || row?.$location?.worldName || '',
        groupName: row?.groupName || row?.$location?.groupName || '',
        ownerUserId,
        userId: ownerUserId,
        ownerDisplayName:
            row?.ownerDisplayName ||
            row?.ownerName ||
            row?.$location?.ownerDisplayName ||
            ''
    };
    if (row?.$location && typeof row.$location === 'object') {
        return {
            ...baseLocation,
            ...row.$location,
            tag: row.$location.tag || location,
            location: row.$location.tag || location,
            ownerUserId:
                row.$location.ownerUserId ||
                row.$location.owner_user_id ||
                row.$location.userId ||
                ownerUserId,
            userId:
                row.$location.userId ||
                row.$location.user_id ||
                row.$location.ownerUserId ||
                ownerUserId
        };
    }
    return baseLocation;
}

export function rowDuration(row) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) && value > 0 ? timeToText(value) : '\u2014';
}

export function rowSearchText(row) {
    return [
        row?.created_at,
        row?.createdAt,
        row?.location,
        row?.$location?.tag,
        row?.worldId,
        row?.worldName,
        row?.groupName
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function normalizePlayerRows(players) {
    const rows =
        players instanceof Map
            ? Array.from(players.values())
            : Array.isArray(players)
              ? players
              : [];
    return [...rows].sort(
        (left, right) => Number(right?.time || 0) - Number(left?.time || 0)
    );
}

export function playerDisplayName(row) {
    return row?.displayName || row?.display_name || '\u2014';
}

export function playerUserId(row) {
    return row?.userId || row?.user_id || '';
}

export function normalizeInfoChartRows(
    rows,
    currentUserId,
    friendsById,
    favoriteIdSet
) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            const durationMs = Math.max(0, Number(row?.time || 0));
            const leaveMs = new Date(
                row?.created_at || row?.createdAt || 0
            ).getTime();
            const userId = playerUserId(row);
            if (!Number.isFinite(leaveMs) || !userId) {
                return null;
            }
            return {
                ...row,
                userId,
                displayName: playerDisplayName(row),
                joinMs: leaveMs - durationMs,
                leaveMs,
                durationMs,
                isFriend:
                    userId === currentUserId
                        ? null
                        : Boolean(friendsById?.[userId]),
                isFavorite:
                    userId === currentUserId ? null : favoriteIdSet.has(userId)
            };
        })
        .filter(Boolean);
}
