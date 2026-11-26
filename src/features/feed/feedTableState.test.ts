import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    FEED_TABLE_DEFAULT_PAGE_SIZES,
    FEED_TABLE_DEFAULT_SORTING,
    readPersistedFeedTableState,
    resolveFeedPageSize,
    sanitizeFeedColumnOrder,
    sanitizeFeedColumnVisibility,
    sanitizeFeedPageSizes,
    sanitizeFeedSorting,
    writePersistedFeedTableState
} from './feedTableState';

function installLocalStorage(initial: Record<string, unknown> = {}) {
    const values = new Map(
        Object.entries(initial).map(([key, value]) => [key, String(value)])
    );
    const localStorage = {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            values.set(key, String(value));
        })
    };
    vi.stubGlobal('localStorage', localStorage);
    return { localStorage, values };
}

describe('feed table state helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-03T04:05:06Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('safely reads and writes persisted feed table state', () => {
        const { localStorage, values } = installLocalStorage({
            'vrcx-0:table:feed': JSON.stringify({ pageSize: 25 })
        });

        expect(readPersistedFeedTableState()).toEqual({ pageSize: 25 });

        writePersistedFeedTableState({
            sorting: [{ id: 'type', desc: false }]
        });

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'vrcx-0:table:feed',
            expect.any(String)
        );
        expect(JSON.parse(values.get('vrcx-0:table:feed') ?? '')).toEqual({
            pageSize: 25,
            sorting: [{ id: 'type', desc: false }],
            updatedAt: new Date('2026-02-03T04:05:06Z').getTime()
        });
    });

    it('sanitizes sorting, page sizes, and page size selection', () => {
        expect(
            sanitizeFeedSorting([
                { id: 'type', desc: false },
                { id: 'bad', desc: true }
            ])
        ).toEqual([{ id: 'type', desc: false }]);
        expect(sanitizeFeedSorting([{ id: 'bad', desc: true }])).toBe(
            FEED_TABLE_DEFAULT_SORTING
        );
        expect(sanitizeFeedPageSizes(['50', 10, 'bad', 10])).toEqual([10, 50]);
        expect(sanitizeFeedPageSizes(null)).toBe(FEED_TABLE_DEFAULT_PAGE_SIZES);
        expect(resolveFeedPageSize(50, [10, 25, 50], 25)).toBe(50);
        expect(resolveFeedPageSize(100, [10, 25, 50], 25)).toBe(50);
    });

    it('keeps the expander first and fills missing columns when restoring order', () => {
        expect(
            sanitizeFeedColumnOrder([
                'detail',
                'expander',
                'bad',
                'type',
                'type'
            ])
        ).toEqual(['expander', 'detail', 'type', 'created_at', 'displayName']);
        expect(sanitizeFeedColumnOrder(null)).toEqual([
            'expander',
            'created_at',
            'displayName',
            'type',
            'detail'
        ]);
    });

    it('restores visibility only for hideable feed columns', () => {
        expect(
            sanitizeFeedColumnVisibility({
                expander: false,
                type: false,
                detail: 'no',
                bad: false
            })
        ).toEqual({ type: false });
        expect(sanitizeFeedColumnVisibility(null)).toEqual({});
    });
});
