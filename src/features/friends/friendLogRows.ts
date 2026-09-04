import type { FriendLogHistoryRow } from '@/repositories/friendLogHistoryRepository';
import { isUserId } from '@/shared/constants/vrchatIds';

export type FriendLogRow = FriendLogHistoryRow & {
    resolvedDisplayName?: string;
};

export function sortRows<TRow extends FriendLogRow>(rows: TRow[]): TRow[] {
    return rows.slice().sort((left, right) => {
        const leftTs = Date.parse(left.created_at);
        const rightTs = Date.parse(right.created_at);
        if (
            Number.isFinite(leftTs) &&
            Number.isFinite(rightTs) &&
            leftTs !== rightTs
        ) {
            return rightTs - leftTs;
        }

        return right.rowId - left.rowId;
    });
}

export function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export const UNKNOWN_FRIEND_LOG_DISPLAY_NAME = 'Unknown';

export function isUserIdLike(value: unknown) {
    return isUserId(normalizeUserId(value));
}

// A row's displayName is "dirty" when older builds wrote the raw user id (or an empty value the UI
// then backfilled with the id) instead of a real name. Treat those as missing so the caller can
// resolve the real name from another source.
export function resolveDisplayNameCandidate(value: unknown, userId: string) {
    const normalized = normalizeUserId(value);
    if (
        !normalized ||
        normalized === normalizeUserId(userId) ||
        normalized === UNKNOWN_FRIEND_LOG_DISPLAY_NAME ||
        isUserIdLike(normalized)
    ) {
        return '';
    }
    return normalized;
}

export function getFriendLogRowKey(row: FriendLogRow, ownerUserId = '') {
    const owner = normalizeUserId(ownerUserId);
    const rowId = row.rowId;
    if (rowId > 0) {
        return `${owner}:row:${rowId}`;
    }

    return `${owner}:composite:${row.created_at}:${row.type}:${row.userId}`;
}
