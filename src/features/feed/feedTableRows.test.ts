import { describe, expect, it } from 'vitest';

import type { FeedRow, FeedTableMeta } from '@/components/feed/feedTypes';

import { sortFeedTableRows } from './feedTableRows';

const meta: Pick<FeedTableMeta, 'knownUsersById' | 'friendLogNamesById'> = {
    knownUsersById: {
        usr_known: {
            id: 'usr_known',
            endpoint: 'default',
            updatedAt: '',
            displayName: 'Known'
        }
    },
    friendLogNamesById: { usr_logged: 'Logged' }
};

describe('sortFeedTableRows', () => {
    it('retains query order without copying rows when no sortable column is active', () => {
        const rows: FeedRow[] = [{ rowId: 2 }, { rowId: 1 }];

        expect(sortFeedTableRows(rows, [], meta)).toBe(rows);
        expect(
            sortFeedTableRows(rows, [{ id: 'detail', desc: true }], meta)
        ).toBe(rows);
    });

    it('preserves basic string ordering and uses known and logged name fallbacks', () => {
        const rows: FeedRow[] = [
            { rowId: 1, displayName: 'user2' },
            { rowId: 2, displayName: 'user10' },
            { rowId: 3, userId: 'usr_logged' },
            { rowId: 4, userId: 'usr_known' },
            { rowId: 5, displayName: 'User2' },
            { rowId: 6, userId: 'usr_known', displayName: 'Explicit' }
        ];
        const sorted = sortFeedTableRows(
            rows,
            [{ id: 'displayName', desc: false }],
            meta
        );

        expect(sorted.map((row) => row.rowId)).toEqual([6, 4, 3, 5, 2, 1]);
        expect(sorted[0]).toBe(rows[5]);
        expect(rows.map((row) => row.rowId)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('applies multiple sort keys and keeps equal rows in query order', () => {
        const rows: FeedRow[] = [
            { rowId: 1, type: 'Status', created_at: '2026-08-31T00:00:00Z' },
            { rowId: 2, type: 'GPS', created_at: '2026-08-30T00:00:00Z' },
            { rowId: 3, type: 'GPS', created_at: '2026-08-31T00:00:00Z' },
            { rowId: 4, type: 'GPS', created_at: '2026-08-31T00:00:00Z' },
            { rowId: 5, type: 'GPS', created_at: 'invalid' }
        ];

        expect(
            sortFeedTableRows(
                rows,
                [
                    { id: 'type', desc: false },
                    { id: 'created_at', desc: true }
                ],
                meta
            ).map((row) => row.rowId)
        ).toEqual([3, 4, 2, 5, 1]);
    });
});
