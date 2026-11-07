import { getFeedRowId } from '@/components/feed/feedRows';
import type { FeedRow } from '@/components/feed/feedTypes';
import { dateFromUnknown } from '@/shared/utils/dateTime';

export type FeedListEntry =
    | { kind: 'day'; key: string; createdAt: FeedRow['created_at'] }
    | { kind: 'row'; key: string; row: FeedRow };

export function feedLocalDayKey(value: unknown): string {
    const date = dateFromUnknown(value);
    if (!date) {
        return '';
    }
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

export function buildFeedListEntries(
    rows: readonly FeedRow[],
    todayKey: string
) {
    const entries: FeedListEntry[] = [];
    const seenDays = new Set<string>([todayKey]);
    for (const row of rows) {
        const dayKey = feedLocalDayKey(row.created_at);
        if (dayKey && !seenDays.has(dayKey)) {
            seenDays.add(dayKey);
            entries.push({
                kind: 'day',
                key: `day:${dayKey}`,
                createdAt: row.created_at
            });
        }
        entries.push({ kind: 'row', key: getFeedRowId(row), row });
    }
    return entries;
}
