import { afterEach, describe, expect, it } from 'vitest';

import {
    GAME_LOG_COLUMN_IDS,
    GAME_LOG_DEFAULT_PAGE_SIZES,
    GAME_LOG_DEFAULT_SORTING,
    readPersistedGameLogState,
    resolveGameLogPageSize,
    sanitizeGameLogColumnOrder,
    sanitizeGameLogColumnSizing,
    sanitizeGameLogColumnVisibility,
    sanitizeGameLogPageSizes,
    sanitizeGameLogSorting,
    writePersistedGameLogState
} from './gameLogState.js';

const STORAGE_KEY = 'vrcx:table:gameLog';

function installLocalStorage(initial = {}) {
    const store = new Map(
        Object.entries(initial).map(([key, value]) => [key, String(value)])
    );

    globalThis.window = {
        localStorage: {
            getItem(key) {
                return store.has(key) ? store.get(key) : null;
            },
            setItem(key, value) {
                store.set(key, String(value));
            }
        }
    };

    return store;
}

afterEach(() => {
    delete globalThis.window;
});

describe('gameLogState', () => {
    it('restores and merges the saved game-log table layout', () => {
        installLocalStorage({
            [STORAGE_KEY]: JSON.stringify({
                sorting: [{ id: 'type', desc: false }],
                pageSize: 50
            })
        });

        expect(readPersistedGameLogState()).toMatchObject({
            sorting: [{ id: 'type', desc: false }],
            pageSize: 50
        });

        writePersistedGameLogState({
            columnVisibility: { detail: false }
        });

        expect(readPersistedGameLogState()).toMatchObject({
            sorting: [{ id: 'type', desc: false }],
            pageSize: 50,
            columnVisibility: { detail: false }
        });
        expect(readPersistedGameLogState().updatedAt).toEqual(
            expect.any(Number)
        );
    });

    it('falls back to defaults when saved sorting or page sizes are unusable', () => {
        expect(readPersistedGameLogState()).toEqual({});

        installLocalStorage({
            [STORAGE_KEY]: '{not-json'
        });
        expect(readPersistedGameLogState()).toEqual({});

        globalThis.window = {
            localStorage: {
                getItem() {
                    throw new Error('storage blocked');
                },
                setItem() {
                    throw new Error('storage blocked');
                }
            }
        };
        expect(readPersistedGameLogState()).toEqual({});
        expect(() =>
            writePersistedGameLogState({ pageSize: 10 })
        ).not.toThrow();

        expect(sanitizeGameLogSorting([{ id: 'unknown', desc: true }])).toBe(
            GAME_LOG_DEFAULT_SORTING
        );
        expect(sanitizeGameLogPageSizes(['bad', 0])).toBe(
            GAME_LOG_DEFAULT_PAGE_SIZES
        );
    });

    it('keeps supported sorting and page-size choices users can select', () => {
        expect(
            sanitizeGameLogSorting([
                { id: 'created_at', desc: true },
                { id: 'unknown', desc: false },
                { id: 'detail', desc: false }
            ])
        ).toEqual([
            { id: 'created_at', desc: true },
            { id: 'detail', desc: false }
        ]);

        expect(sanitizeGameLogPageSizes(['50', 10, 25, 10])).toEqual([
            10, 25, 50
        ]);
        expect(resolveGameLogPageSize('50', [10, 25, 50], 25)).toBe(50);
        expect(resolveGameLogPageSize('999', [10, 25, 50], 25)).toBe(50);
        expect(resolveGameLogPageSize('bad', [], 25)).toBe(10);
    });

    it('sanitizes saved columns while keeping the spacer column first', () => {
        expect(
            sanitizeGameLogColumnVisibility({
                created_at: false,
                detail: true,
                unknown: false
            })
        ).toEqual({
            created_at: false,
            detail: true
        });

        expect(sanitizeGameLogColumnOrder(['detail', 'type'])).toEqual([
            'spacer',
            'detail',
            'type',
            ...GAME_LOG_COLUMN_IDS.filter(
                (columnId) =>
                    columnId !== 'spacer' &&
                    columnId !== 'detail' &&
                    columnId !== 'type'
            )
        ]);

        expect(
            sanitizeGameLogColumnSizing({
                created_at: '160px',
                detail: 320,
                unknown: 100,
                action: 0
            })
        ).toEqual({
            created_at: 160,
            detail: 320
        });
    });
});
