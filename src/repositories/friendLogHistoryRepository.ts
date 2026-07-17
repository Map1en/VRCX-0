import {
    commands,
    type FriendLogHistoryEntryInput,
    type FriendLogHistoryOutput
} from '@/platform/tauri/bindings';

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

type FriendLogHistorySourceRow = FriendLogHistoryOutput;

function valueAsString(value: unknown): string {
    return value == null ? '' : String(value);
}

function valueAsInt(value: unknown): number {
    return Number.parseInt(String(value ?? 0), 10) || 0;
}

function isFriendLogType(value: string): value is FriendLogType {
    return FRIEND_LOG_TYPES.some((type) => type === value);
}

function normalizeFriendLogHistoryRow(
    row: FriendLogHistorySourceRow
): FriendLogHistoryRow {
    const normalizedRow: FriendLogHistoryRow = {
        rowId: row.rowId,
        created_at: row.createdAt,
        type: valueAsString(row.type),
        userId: row.userId,
        displayName: row.displayName,
        friendNumber: row.friendNumber
    };

    if (normalizedRow.type === 'DisplayName') {
        normalizedRow.previousDisplayName = row.previousDisplayName;
    } else if (normalizedRow.type === 'TrustLevel') {
        normalizedRow.trustLevel = row.trustLevel;
        normalizedRow.previousTrustLevel = row.previousTrustLevel;
    }

    return normalizedRow;
}

function normalizeFriendLogHistoryEntryForRuntime(
    entry: FriendLogHistoryEntry | null | undefined
): FriendLogHistoryEntryInput {
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
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    const normalizedTargetUserId =
        typeof options.targetUserId === 'string'
            ? options.targetUserId.trim()
            : String(options.targetUserId ?? '').trim();

    const normalizedTypes = Array.isArray(options.types)
        ? options.types
              .map((entry) =>
                  typeof entry === 'string'
                      ? entry.trim()
                      : String(entry ?? '').trim()
              )
              .filter(
                  (entry): entry is FriendLogType =>
                      Boolean(entry) && isFriendLogType(entry)
              )
        : [];

    const rows = await commands.appFriendLogHistoryQuery({
        userId: normalizedUserId,
        targetUserId: normalizedTargetUserId,
        types: normalizedTypes
    });

    return rows
        .map(normalizeFriendLogHistoryRow)
        .filter((row) => typeof row.userId === 'string' && row.userId.trim());
}

async function deleteFriendLogHistory(
    userId: unknown,
    entry: FriendLogHistoryEntry | null | undefined
) {
    return commands.appFriendLogHistoryDelete(
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim(),
        normalizeFriendLogHistoryEntryForRuntime(entry)
    );
}

const friendLogHistoryRepository = {
    getFriendLogHistory,
    deleteFriendLogHistory
};

export { FRIEND_LOG_TYPES, deleteFriendLogHistory, getFriendLogHistory };
export default friendLogHistoryRepository;
