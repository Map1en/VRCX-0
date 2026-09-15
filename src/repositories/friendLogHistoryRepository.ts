import type { FriendLogType } from '@/domain/friends/friendLog';
import {
    commands,
    type FriendLogHistoryCursor,
    type FriendLogHistoryEntryInput,
    type FriendLogHistoryOutput
} from '@/platform/tauri/bindings';

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

interface FriendLogHistoryEntry {
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

interface FriendLogHistoryOptions {
    targetUserId?: string;
    types?: string[];
    excludedTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
    cursor?: FriendLogHistoryCursor | null;
    limit?: number;
}

type FriendLogHistorySourceRow = FriendLogHistoryOutput;

function valueAsInt(value: unknown): number {
    return Number.parseInt(String(value ?? 0), 10) || 0;
}

function normalizeFriendLogHistoryRow(
    row: FriendLogHistorySourceRow
): FriendLogHistoryRow {
    const normalizedRow: FriendLogHistoryRow = {
        rowId: row.rowId,
        created_at: row.createdAt,
        type: row.type,
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
    userId: string,
    options: FriendLogHistoryOptions = {}
): Promise<FriendLogHistoryRow[]> {
    const normalizedUserId = userId.trim();
    const normalizedTargetUserId = options.targetUserId?.trim() ?? '';
    const normalizedTypes = Array.from(new Set(options.types ?? []));

    const rows = await commands.appFriendLogHistoryQuery({
        userId: normalizedUserId,
        targetUserId: normalizedTargetUserId,
        types: normalizedTypes,
        excludedTypes: options.excludedTypes ?? [],
        dateFrom: options.dateFrom ?? '',
        dateTo: options.dateTo ?? '',
        cursor: options.cursor ?? null,
        limit: options.limit ?? null
    });

    return rows
        .map(normalizeFriendLogHistoryRow)
        .filter((row) => row.userId.trim());
}

async function deleteFriendLogHistory(
    userId: string,
    entry: FriendLogHistoryEntry | null | undefined
) {
    return commands.appFriendLogHistoryDelete(
        userId.trim(),
        normalizeFriendLogHistoryEntryForRuntime(entry)
    );
}

const friendLogHistoryRepository = {
    getFriendLogHistory,
    deleteFriendLogHistory
};

export { getFriendLogHistory };
export default friendLogHistoryRepository;
