import { timeToText } from '@/lib/dateTime';
import { parseLocation } from '@/shared/utils/location';

const PREVIOUS_INSTANCE_COUNT_CAP = 10000;

type PreviousInstanceLocation = Record<string, unknown> & {
    groupName?: unknown;
    location?: unknown;
    ownerDisplayName?: unknown;
    ownerUserId?: unknown;
    owner_user_id?: unknown;
    tag?: unknown;
    userId?: unknown;
    user_id?: unknown;
    worldName?: unknown;
};

type PreviousInstanceRow = Record<string, unknown> & {
    $location?: PreviousInstanceLocation | null;
    count?: unknown;
    created_at?: unknown;
    createdAt?: unknown;
    duration?: unknown;
    groupName?: unknown;
    id?: unknown;
    left_at?: unknown;
    leftAt?: unknown;
    location?: unknown;
    ownerDisplayName?: unknown;
    ownerId?: unknown;
    ownerName?: unknown;
    ownerUserId?: unknown;
    owner_id?: unknown;
    owner_user_id?: unknown;
    time?: unknown;
    userId?: unknown;
    user_id?: unknown;
    worldId?: unknown;
    worldName?: unknown;
};

type PreviousInstancePlayerRow = PreviousInstanceRow & {
    displayName?: unknown;
    display_name?: unknown;
};

type PreviousInstanceKnownUser = {
    [key: string]: unknown;
    displayName?: unknown;
    username?: unknown;
};

function textValue(value: unknown) {
    return typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
}

function dateInputValue(value: unknown): string | number {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    return value === null || value === undefined ? 0 : String(value);
}

function timestampMs(value: unknown) {
    const timestamp = new Date(dateInputValue(value)).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function formatPreviousInstanceCount(count: unknown) {
    const value = Number(count);
    if (!Number.isFinite(value) || value < 0) {
        return '0';
    }
    return value >= PREVIOUS_INSTANCE_COUNT_CAP
        ? '9999+'
        : String(Math.trunc(value));
}

export function createdTime(row: PreviousInstanceRow | null | undefined) {
    return (
        new Date(
            dateInputValue(row?.created_at || row?.createdAt || 0)
        ).getTime() || 0
    );
}

export function rowLocation(row: PreviousInstanceRow | null | undefined) {
    return textValue(
        row?.$location?.tag || row?.location || row?.worldId || row?.id || ''
    );
}

export function rowWorldId(row: PreviousInstanceRow | null | undefined) {
    const location = rowLocation(row);
    return parseLocation(location).worldId || '';
}

export function rowOwnerUserId(row: PreviousInstanceRow | null | undefined) {
    return textValue(
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

export function rowLocationObject(row: PreviousInstanceRow | null | undefined) {
    const location = rowLocation(row);
    const ownerUserId = rowOwnerUserId(row);
    const baseLocation: PreviousInstanceLocation = {
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

export function rowDuration(row: PreviousInstanceRow | null | undefined) {
    const value = rowDurationValue(row);
    return Number.isFinite(value) && value > 0 ? timeToText(value) : '\u2014';
}

export function rowDurationValue(row: PreviousInstanceRow | null | undefined) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) ? value : 0;
}

export function playerJoinMs(
    row: PreviousInstancePlayerRow | null | undefined
) {
    const joinedMs = timestampMs(row?.created_at || row?.createdAt || 0);
    const leftMs = timestampMs(row?.left_at || row?.leftAt || 0);
    const durationMs = Math.max(0, rowDurationValue(row));
    const joinCount = Number(row?.count || 0);

    if (joinCount <= 0 && leftMs && durationMs > 0) {
        return Math.max(0, leftMs - durationMs);
    }

    return joinedMs;
}

export function playerLeaveMs(
    row: PreviousInstancePlayerRow | null | undefined
) {
    const leftMs = timestampMs(row?.left_at || row?.leftAt || 0);
    if (leftMs) {
        return leftMs;
    }

    const joinedMs = playerJoinMs(row);
    const durationMs = Math.max(0, rowDurationValue(row));
    return joinedMs && durationMs > 0 ? joinedMs + durationMs : 0;
}

export function rowInstanceText(row: PreviousInstanceRow | null | undefined) {
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

export function rowCreatorText(row: PreviousInstanceRow | null | undefined) {
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

export function rowSearchText(row: PreviousInstanceRow | null | undefined) {
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
    rows: readonly PreviousInstanceRow[] | null | undefined,
    sortKey = 'date',
    sortDesc = true
) {
    if (!sortKey) {
        return [...(Array.isArray(rows) ? rows : [])];
    }
    const direction = sortDesc ? -1 : 1;
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
        let result = 0;
        if (sortKey === 'duration') {
            result = rowDurationValue(left) - rowDurationValue(right);
        } else if (sortKey === 'location') {
            result = rowInstanceText(left).localeCompare(
                rowInstanceText(right)
            );
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

export function normalizePlayerRows<T extends PreviousInstancePlayerRow>(
    players: Map<unknown, T> | readonly T[] | null | undefined
) {
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

export function playerDisplayName(
    row: PreviousInstancePlayerRow | null | undefined
) {
    return textValue(row?.displayName || row?.display_name || '\u2014');
}

export function playerUserId(
    row: PreviousInstancePlayerRow | null | undefined
) {
    return textValue(row?.userId || row?.user_id || '');
}

function knownDisplayName(
    knownUser: PreviousInstanceKnownUser | null | undefined,
    userId: string
) {
    return textValue(knownUser?.displayName || knownUser?.username || userId);
}

function needsKnownDisplayName(displayName: unknown, userId: string) {
    return !displayName || displayName === '\u2014' || displayName === userId;
}

export function normalizeInfoChartRows(
    rows: readonly PreviousInstancePlayerRow[] | null | undefined,
    currentUserId: string,
    friendsById: Record<string, unknown> | null | undefined,
    favoriteIdSet: ReadonlySet<string>,
    knownUsersById: Record<string, PreviousInstanceKnownUser> = {}
) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            const durationMs = Math.max(0, Number(row?.time || 0));
            const leaveMs = new Date(
                dateInputValue(row?.created_at || row?.createdAt || 0)
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
