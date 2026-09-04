import { describe, expect, it } from 'vitest';

import { sortTableRowsByDateAndType } from './sortRowsByDateAndType';

type TestRow = {
    rowId: number;
    created_at: string;
    type: string;
    displayName?: string;
};

describe('sortTableRowsByDateAndType', () => {
    it('keeps query order and row references when sorting is cleared or disabled', () => {
        const rows: TestRow[] = [
            { rowId: 2, created_at: '', type: 'VideoPlay' },
            { rowId: 1, created_at: '', type: 'Location' }
        ];

        expect(sortTableRowsByDateAndType(rows, [])).toBe(rows);
        expect(
            sortTableRowsByDateAndType(rows, [
                { id: 'displayName', desc: false },
                { id: 'detail', desc: true },
                { id: 'spacer', desc: false },
                { id: 'action', desc: false },
                { id: 'trailing', desc: false }
            ])
        ).toBe(rows);
        const sorted = sortTableRowsByDateAndType(rows, [
            { id: 'type', desc: false }
        ]);
        expect(sorted).toEqual([rows[1], rows[0]]);
        expect(sorted[0]).toBe(rows[1]);
        expect(rows.map((row) => row.rowId)).toEqual([2, 1]);
    });

    it('sorts dates chronologically across time zones and breaks equal timestamps by row ID', () => {
        const rows: TestRow[] = [
            {
                rowId: 2,
                created_at: '2026-08-31T09:00:00+09:00',
                type: 'Location'
            },
            { rowId: 1, created_at: '2026-08-31T01:00:00Z', type: 'Location' },
            { rowId: 10, created_at: '2026-08-31T00:00:00Z', type: 'Location' }
        ];

        expect(
            sortTableRowsByDateAndType(rows, [
                { id: 'created_at', desc: true }
            ]).map((row) => row.rowId)
        ).toEqual([1, 10, 2]);
    });

    it('retains the row ID fallback when either timestamp is invalid', () => {
        const invalid: TestRow = {
            rowId: 10,
            created_at: '',
            type: 'Location'
        };
        const valid: TestRow = {
            rowId: 2,
            created_at: '2026-08-31T00:00:00Z',
            type: 'Location'
        };

        const sorting = [{ id: 'created_at', desc: false }];
        expect(sortTableRowsByDateAndType([invalid, valid], sorting)).toEqual([
            valid,
            invalid
        ]);
        expect(sortTableRowsByDateAndType([valid, invalid], sorting)).toEqual([
            valid,
            invalid
        ]);
        const bothInvalid = sortTableRowsByDateAndType(
            [invalid, { ...valid, created_at: 'invalid' }],
            sorting
        );
        expect(bothInvalid.map((row) => row.rowId)).toEqual([2, 10]);
    });

    it('keeps basic string ordering, multiple sort keys, and stable ties', () => {
        const rows: TestRow[] = [
            { rowId: 1, created_at: '2026-08-30T00:00:00Z', type: 'Location' },
            { rowId: 2, created_at: '2026-08-31T00:00:00Z', type: 'Location' },
            {
                rowId: 2,
                created_at: '2026-08-31T00:00:00Z',
                type: 'Location',
                displayName: 'tie'
            },
            { rowId: 3, created_at: '', type: 'location' },
            { rowId: 4, created_at: '', type: 'VideoPlay' }
        ];

        const sorted = sortTableRowsByDateAndType(rows, [
            { id: 'type', desc: false },
            { id: 'created_at', desc: true }
        ]);

        expect(sorted).toEqual([rows[1], rows[2], rows[0], rows[4], rows[3]]);
        expect(sorted[0]).toBe(rows[1]);
        expect(sorted[1]).toBe(rows[2]);
    });
});
