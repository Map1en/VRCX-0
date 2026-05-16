import { backend } from '@/platform/index.js';

import sqliteRepository from './sqliteRepository.js';
import type { SQLiteParams, SQLiteValue } from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

const FRIEND_LOG_TYPES = Object.freeze([
    'Friend',
    'Unfriend',
    'FriendRequest',
    'CancelFriendRequest',
    'DisplayName',
    'TrustLevel'
] as const);

export type FriendLogType = (typeof FRIEND_LOG_TYPES)[number];

export interface FriendLogHistoryRow {
    rowId: number;
    created_at: string;
    type: FriendLogType | string;
    userId: string;
    displayName: string;
    friendNumber: number;
    previousDisplayName?: string;
    trustLevel?: string;
    previousTrustLevel?: string;
}

export interface FriendLogHistoryEntry {
    rowId?: number | string | null;
    created_at?: string | null;
    type?: FriendLogType | string | null;
    userId?: string | null;
    displayName?: string | null;
    friendNumber?: number | string | null;
    previousDisplayName?: string | null;
    trustLevel?: string | null;
    previousTrustLevel?: string | null;
}

export interface FriendLogHistoryOptions {
    targetUserId?: unknown;
    types?: unknown[];
}

type FriendLogHistorySourceRow = unknown[] | Record<string, unknown>;

function valueAsString(value: unknown): string {
    return value == null ? '' : String(value);
}

function valueAsInt(value: unknown): number {
    return Number.parseInt(String(value ?? 0), 10) || 0;
}

function normalizeFriendLogHistoryRow(
    row: FriendLogHistorySourceRow
): FriendLogHistoryRow {
    if (Array.isArray(row)) {
        const normalizedRow: FriendLogHistoryRow = {
            rowId: valueAsInt(row[0]),
            created_at: valueAsString(row[1]),
            type: valueAsString(row[2]),
            userId: valueAsString(row[3]),
            displayName: valueAsString(row[4]),
            friendNumber: valueAsInt(row[8])
        };

        if (normalizedRow.type === 'DisplayName') {
            normalizedRow.previousDisplayName = valueAsString(row[5]);
        } else if (normalizedRow.type === 'TrustLevel') {
            normalizedRow.trustLevel = valueAsString(row[6]);
            normalizedRow.previousTrustLevel = valueAsString(row[7]);
        }

        return normalizedRow;
    }

    const normalizedRow: FriendLogHistoryRow = {
        rowId: valueAsInt(row.id ?? row.rowId),
        created_at: valueAsString(row.created_at ?? row.createdAt),
        type: valueAsString(row.type),
        userId: valueAsString(row.user_id ?? row.userId),
        displayName: valueAsString(row.display_name ?? row.displayName),
        friendNumber: valueAsInt(row.friend_number ?? row.friendNumber)
    };

    if (normalizedRow.type === 'DisplayName') {
        normalizedRow.previousDisplayName =
            valueAsString(row.previous_display_name ?? row.previousDisplayName);
    } else if (normalizedRow.type === 'TrustLevel') {
        normalizedRow.trustLevel = valueAsString(row.trust_level ?? row.trustLevel);
        normalizedRow.previousTrustLevel =
            valueAsString(row.previous_trust_level ?? row.previousTrustLevel);
    }

    return normalizedRow;
}

function normalizeFriendLogHistoryEntryForBackend(
    entry: FriendLogHistoryEntry | null | undefined
) {
    return {
        rowId: valueAsInt(entry?.rowId),
        createdAt: entry?.created_at ?? '',
        type: entry?.type ?? '',
        userId: entry?.userId ?? '',
        displayName: entry?.displayName ?? '',
        previousDisplayName: entry?.previousDisplayName ?? '',
        trustLevel: entry?.trustLevel ?? '',
        previousTrustLevel: entry?.previousTrustLevel ?? '',
        friendNumber: valueAsInt(entry?.friendNumber)
    };
}

async function getFriendLogHistory(
    userId: unknown,
    options: FriendLogHistoryOptions = {}
): Promise<FriendLogHistoryRow[]> {
    const userPrefix = normalizeUserTablePrefix(userId);
    const whereClauses: string[] = [];
    const args: Record<string, SQLiteValue> = {};

    const normalizedTargetUserId =
        typeof options.targetUserId === 'string'
            ? options.targetUserId.trim()
            : String(options.targetUserId ?? '').trim();
    if (normalizedTargetUserId) {
        whereClauses.push('user_id = @user_id');
        args['@user_id'] = normalizedTargetUserId;
    }

    const normalizedTypes = Array.isArray(options.types)
        ? options.types
              .map((entry) =>
                  typeof entry === 'string'
                      ? entry.trim()
                      : String(entry ?? '').trim()
              )
              .filter(
                  (entry): entry is FriendLogType =>
                      Boolean(entry) &&
                      FRIEND_LOG_TYPES.includes(entry as FriendLogType)
              )
        : [];
    if (normalizedTypes.length) {
        const typePlaceholders = normalizedTypes.map((type, index) => {
            const key = `@type_${index}`;
            args[key] = type;
            return key;
        });
        whereClauses.push(`type IN (${typePlaceholders.join(', ')})`);
    }

    const whereSql = whereClauses.length
        ? ` WHERE ${whereClauses.join(' AND ')}`
        : '';
    const rows = await sqliteRepository.query<FriendLogHistorySourceRow>(
        `SELECT id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number FROM ${userPrefix}_friend_log_history${whereSql} ORDER BY created_at DESC, id DESC`,
        args as SQLiteParams
    );

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map(normalizeFriendLogHistoryRow)
        .filter((row) => typeof row.userId === 'string' && row.userId.trim());
}

async function addFriendLogHistory(
    userId: unknown,
    entry: FriendLogHistoryEntry | null | undefined
) {
    await backend.app.FriendLogHistoryAdd({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entries: [normalizeFriendLogHistoryEntryForBackend(entry)]
    });
}

async function addFriendLogHistoryArray(
    userId: unknown,
    entries: FriendLogHistoryEntry[] = []
) {
    await backend.app.FriendLogHistoryAdd({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entries: (Array.isArray(entries) ? entries : []).map(
            normalizeFriendLogHistoryEntryForBackend
        )
    });
}

async function deleteFriendLogHistory(
    userId: unknown,
    entry: FriendLogHistoryEntry | null | undefined
) {
    return backend.app.FriendLogHistoryDelete({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entry: normalizeFriendLogHistoryEntryForBackend(entry)
    });
}

const friendLogHistoryRepository = {
    addFriendLogHistory,
    addFriendLogHistoryArray,
    getFriendLogHistory,
    deleteFriendLogHistory
};

export {
    FRIEND_LOG_TYPES,
    addFriendLogHistory,
    addFriendLogHistoryArray,
    deleteFriendLogHistory,
    getFriendLogHistory
};
export default friendLogHistoryRepository;
