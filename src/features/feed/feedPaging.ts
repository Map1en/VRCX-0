import { getFeedRowId, normalizeFeedId } from '@/components/feed/feedRows';
import type { FeedRow } from '@/components/feed/feedTypes';
import type { FeedCursor } from '@/repositories/feedPersistenceRepository';

export const FEED_PAGE_SIZE = 80;

export function retainFeedRowWindow(
    rows: FeedRow[],
    maxRows: number,
    edge: 'latest' | 'oldest'
): FeedRow[] {
    const limit =
        Number.isFinite(maxRows) && maxRows > 0
            ? Math.floor(maxRows)
            : FEED_PAGE_SIZE;
    if (rows.length <= limit) {
        return rows;
    }
    return edge === 'latest' ? rows.slice(0, limit) : rows.slice(-limit);
}

export function resolveFeedCursor(row: FeedRow): FeedCursor | null {
    const createdAt = normalizeFeedId(row.created_at);
    if (
        !createdAt ||
        typeof row.sourceRank !== 'number' ||
        typeof row.rowId !== 'number'
    ) {
        return null;
    }
    return {
        createdAt,
        sourceRank: row.sourceRank,
        rowId: row.rowId
    };
}

export function resolveLastFeedCursor(rows: FeedRow[]): FeedCursor | null {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const cursor = resolveFeedCursor(rows[index]);
        if (cursor) {
            return cursor;
        }
    }
    return null;
}

export function appendUniqueFeedRows(
    currentRows: FeedRow[],
    nextRows: FeedRow[]
): FeedRow[] {
    const seen = new Set(currentRows.map(getFeedRowId));
    const output = [...currentRows];
    for (const row of nextRows) {
        const key = getFeedRowId(row);
        if (!seen.has(key)) {
            seen.add(key);
            output.push(row);
        }
    }
    return output;
}
