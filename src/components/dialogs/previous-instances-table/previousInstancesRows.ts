import { timeToText } from '@/lib/dateTime';
import { parseLocation } from '@/shared/utils/locationParser';

const PREVIOUS_INSTANCE_COUNT_CAP = 10000;

export function formatPreviousInstanceCount(count: any) {
    const value = Number(count);
    if (!Number.isFinite(value) || value < 0) {
        return '0';
    }
    return value >= PREVIOUS_INSTANCE_COUNT_CAP
        ? '9999+'
        : String(Math.trunc(value));
}

export function createdTime(row: any) {
    return new Date(row?.created_at || row?.createdAt || 0).getTime() || 0;
}

export function rowLocation(row: any) {
    return (
        row?.$location?.tag || row?.location || row?.worldId || row?.id || ''
    );
}

export function rowWorldId(row: any) {
    const location = rowLocation(row);
    return parseLocation(location).worldId || '';
}

export function rowOwnerUserId(row: any) {
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

export function rowLocationObject(row: any) {
    const location = rowLocation(row);
    const ownerUserId = rowOwnerUserId(row);
    const baseLocation: any = {
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

export function rowDuration(row: any) {
    const value = rowDurationValue(row);
    return Number.isFinite(value) && value > 0 ? timeToText(value) : '\u2014';
}

export function rowDurationValue(row: any) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) ? value : 0;
}

export function rowInstanceText(row: any) {
    return [
        row?.worldName,
        row?.groupName,
        row?.location,
        row?.$location?.tag,
        row?.worldId
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function rowCreatorText(row: any) {
    return (
        row?.ownerDisplayName ||
        row?.ownerName ||
        row?.$location?.ownerDisplayName ||
        rowOwnerUserId(row) ||
        ''
    )
        .toString()
        .toLowerCase();
}

export function rowSearchText(row: any) {
    return [
        row?.created_at,
        row?.createdAt,
        row?.location,
        row?.$location?.tag,
        row?.worldId,
        row?.worldName,
        row?.groupName,
        row?.ownerDisplayName,
        row?.ownerName,
        row?.$location?.ownerDisplayName,
        rowOwnerUserId(row)
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function sortPreviousInstanceRows(
    rows: any,
    sortKey = 'date',
    sortDesc = true
) {
    if (!sortKey) {
        return [...(Array.isArray(rows) ? rows : [])];
    }
    const direction = sortDesc ? -1 : 1;
    return [...(Array.isArray(rows) ? rows : [])].sort((left: any, right: any) => {
        let result = 0;
        if (sortKey === 'duration') {
            result = rowDurationValue(left) - rowDurationValue(right);
        } else if (sortKey === 'location') {
            result = rowInstanceText(left).localeCompare(rowInstanceText(right));
        } else if (sortKey === 'creator') {
            result = rowCreatorText(left).localeCompare(rowCreatorText(right));
        } else {
            result = createdTime(left) - createdTime(right);
        }
        if (result === 0 && sortKey !== 'date') {
            result = createdTime(left) - createdTime(right);
        }
        return result * direction;
    });
}

export function normalizePlayerRows(players: any) {
    const rows =
        players instanceof Map
            ? Array.from(players.values())
            : Array.isArray(players)
              ? players
              : [];
    return [...rows].sort(
        (left: any, right: any) => Number(right?.time || 0) - Number(left?.time || 0)
    );
}

export function playerDisplayName(row: any) {
    return row?.displayName || row?.display_name || '\u2014';
}

export function playerUserId(row: any) {
    return row?.userId || row?.user_id || '';
}

function knownDisplayName(knownUser: any, userId: any) {
    return knownUser?.displayName || knownUser?.username || userId;
}

function needsKnownDisplayName(displayName: any, userId: any) {
    return !displayName || displayName === '\u2014' || displayName === userId;
}

export function normalizeInfoChartRows(
    rows: any,
    currentUserId: any,
    friendsById: any,
    favoriteIdSet: any,
    knownUsersById: any = {}
) {
    return (Array.isArray(rows) ? rows : [])
        .map((row: any) => {
            const durationMs = Math.max(0, Number(row?.time || 0));
            const leaveMs = new Date(
                row?.created_at || row?.createdAt || 0
            ).getTime();
            const userId = playerUserId(row);
            if (!Number.isFinite(leaveMs) || !userId) {
                return null;
            }
            const rowDisplayName = playerDisplayName(row);
            const knownUser = knownUsersById?.[userId];
            return {
                ...row,
                userId,
                displayName: needsKnownDisplayName(rowDisplayName, userId)
                    ? knownDisplayName(knownUser, userId)
                    : rowDisplayName,
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
