import { describe, expect, it } from 'vitest';

import type { FeedRow } from '@/components/feed/feedTypes';

import { buildFeedListEntries, feedLocalDayKey } from './feedListEntries';

function row(rowId: number, createdAt: string): FeedRow {
    return { created_at: createdAt, rowId, sourceRank: 40, type: 'GPS' };
}

describe('buildFeedListEntries', () => {
    it('heads each earlier local day but leaves today unlabeled', () => {
        const entries = buildFeedListEntries(
            [
                row(4, new Date(2026, 10, 8, 0, 37).toISOString()),
                row(3, new Date(2026, 10, 8, 0, 1).toISOString()),
                row(2, new Date(2026, 10, 7, 23, 59).toISOString()),
                row(1, new Date(2026, 10, 6, 12, 0).toISOString())
            ],
            '2026-11-08'
        );

        expect(
            entries.map((entry) =>
                entry.kind === 'day' ? entry.key : entry.row.rowId
            )
        ).toEqual([4, 3, 'day:2026-11-07', 2, 'day:2026-11-06', 1]);
    });

    it('keeps rows without a usable timestamp under the current day', () => {
        const entries = buildFeedListEntries(
            [
                row(3, new Date(2026, 10, 8, 1, 0).toISOString()),
                row(2, ''),
                row(1, new Date(2026, 10, 8, 0, 0).toISOString())
            ],
            '2026-11-09'
        );

        expect(entries.filter((entry) => entry.kind === 'day')).toHaveLength(1);
        expect(entries).toHaveLength(4);
    });

    it('never repeats a day heading key for out-of-order rows', () => {
        const entries = buildFeedListEntries(
            [
                row(3, new Date(2026, 10, 8, 1, 0).toISOString()),
                row(2, new Date(2026, 10, 7, 1, 0).toISOString()),
                row(1, new Date(2026, 10, 8, 0, 0).toISOString())
            ],
            '2026-11-09'
        );
        const keys = entries.map((entry) => entry.key);

        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('feedLocalDayKey', () => {
    it('uses the local calendar day', () => {
        expect(feedLocalDayKey(new Date(2026, 0, 2, 23, 30))).toBe(
            '2026-01-02'
        );
        expect(feedLocalDayKey('not a date')).toBe('');
    });
});
