import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    FEED_TABLE_DEFAULT_PAGE_SIZES,
    FEED_TABLE_DEFAULT_SORTING,
    readPersistedFeedTableState,
    resolveFeedPageSize,
    safeJsonParse,
    sanitizeFeedColumnOrder,
    sanitizeFeedColumnSizing,
    sanitizeFeedColumnVisibility,
    sanitizeFeedPageSizes,
    sanitizeFeedSorting,
    writePersistedFeedTableState
} from './feedTableState.js';

function installLocalStorage(initial = {}) {
    const values = new Map(
        Object.entries(initial).map(([key, value]) => [key, String(value)])
    );
    const localStorage = {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => {
            values.set(key, String(value));
        })
    };
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage }
    });
    return { localStorage, values };
}

describe('feed table state helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-03T04:05:06Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.window;
    });

    it('safely reads and writes persisted feed table state', () => {
        const { localStorage, values } = installLocalStorage({
            'vrcx:table:feed': JSON.stringify({ pageSize: 25 })
        });

        expect(safeJsonParse('{"sorting":[]}')).toEqual({ sorting: [] });
        expect(safeJsonParse('bad')).toBeNull();
        expect(readPersistedFeedTableState()).toEqual({ pageSize: 25 });

        writePersistedFeedTableState({ columnOrder: ['type'] });

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'vrcx:table:feed',
            expect.any(String)
        );
        expect(JSON.parse(values.get('vrcx:table:feed'))).toEqual({
            pageSize: 25,
            columnOrder: ['type'],
            updatedAt: new Date('2026-02-03T04:05:06Z').getTime()
        });
    });

    it('treats browser storage failures as optional table state', () => {
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                localStorage: {
                    getItem() {
                        throw new Error('storage blocked');
                    },
                    setItem() {
                        throw new Error('storage blocked');
                    }
                }
            }
        });

        expect(readPersistedFeedTableState()).toEqual({});
        expect(() =>
            writePersistedFeedTableState({ pageSize: 10 })
        ).not.toThrow();
    });

    it('sanitizes sorting, page sizes, columns, and page size selection', () => {
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
        expect(
            sanitizeFeedColumnVisibility({
                type: false,
                displayName: true,
                bad: false,
                detail: 'yes'
            })
        ).toEqual({
            type: false,
            displayName: true
        });
        expect(
            sanitizeFeedColumnOrder(['expander', 'detail', 'bad', 'type'])
        ).toEqual(['expander', 'detail', 'type']);
        expect(
            sanitizeFeedColumnSizing({
                expander: 40,
                detail: '320',
                bad: 50,
                type: -1
            })
        ).toEqual({
            expander: 40,
            detail: 320
        });
        expect(resolveFeedPageSize(50, [10, 25, 50], 25)).toBe(50);
        expect(resolveFeedPageSize(100, [10, 25, 50], 25)).toBe(50);
    });
});
