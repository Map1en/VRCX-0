import { describe, expect, it } from 'vitest';

import {
    COLUMN_IDS,
    DEFAULT_PAGE_SIZES,
    sanitizeColumnOrder,
    sanitizeColumnVisibility,
    sanitizePageSizes,
    sanitizeSorting
} from './friendLogState';

describe('friendLogState', () => {
    it('drops invalid sorting entries and keeps supported sort columns', () => {
        expect(sanitizeSorting(null)).toEqual([]);
        expect(
            sanitizeSorting([
                { id: 'created_at', desc: true },
                { id: 'displayName', desc: false },
                { id: 'type', desc: false },
                { id: 'unknown', desc: true },
                null,
                { id: 123, desc: true }
            ])
        ).toEqual([
            { id: 'created_at', desc: true },
            { id: 'type', desc: false }
        ]);
    });

    it('normalizes page sizes from dirty storage values', () => {
        expect(sanitizePageSizes(undefined)).toBe(DEFAULT_PAGE_SIZES);
        expect(sanitizePageSizes(['bad', 0, -1, 1001])).toBe(
            DEFAULT_PAGE_SIZES
        );
        expect(sanitizePageSizes(['50', 10, 25, 10, '15px', 1000])).toEqual([
            10, 15, 25, 50, 1000
        ]);
    });

    it('keeps only boolean visibility for known columns', () => {
        expect(sanitizeColumnVisibility('bad')).toEqual({});
        expect(
            sanitizeColumnVisibility({
                created_at: false,
                type: true,
                displayName: 'false',
                action: false,
                unknown: true
            })
        ).toEqual({
            created_at: false,
            type: true,
            action: false
        });
    });

    it('filters column order and appends missing columns', () => {
        expect(sanitizeColumnOrder(null)).toBe(COLUMN_IDS);
        expect(
            sanitizeColumnOrder(['action', 'unknown', 'created_at', 'action'])
        ).toEqual([
            'action',
            'created_at',
            'action',
            ...COLUMN_IDS.filter(
                (columnId) => columnId !== 'action' && columnId !== 'created_at'
            )
        ]);
    });
});
