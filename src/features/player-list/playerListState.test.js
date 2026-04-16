import { afterEach, describe, expect, it } from 'vitest';

import {
    PLAYER_LIST_COLUMN_IDS,
    DEFAULT_PLAYER_LIST_SORTING,
    PLAYER_LIST_STORAGE_KEY,
    readPersistedPlayerListState,
    safeJsonParse,
    sanitizePlayerListColumnOrder,
    sanitizePlayerListColumnSizing,
    sanitizePlayerListColumnVisibility,
    sanitizePlayerListSorting,
    writePersistedPlayerListState
} from './playerListState.js';

function installLocalStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    globalThis.window = {
        localStorage: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => {
                store.set(key, String(value));
            }
        }
    };
    return store;
}

describe('playerListState', () => {
    afterEach(() => {
        delete globalThis.window;
    });

    it('uses the default player-list table shape when saved state is missing or invalid', () => {
        expect(safeJsonParse('{bad json')).toBeNull();
        expect(readPersistedPlayerListState()).toEqual({});
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
        expect(readPersistedPlayerListState()).toEqual({});
        expect(() => writePersistedPlayerListState({ columnOrder: ['avatar'] })).not.toThrow();
        expect(sanitizePlayerListSorting(null)).toEqual(
            DEFAULT_PLAYER_LIST_SORTING
        );
        expect(sanitizePlayerListColumnOrder(null)).toEqual(
            PLAYER_LIST_COLUMN_IDS
        );
        expect(sanitizePlayerListColumnVisibility(null)).toEqual({});
        expect(sanitizePlayerListColumnSizing(null)).toEqual({});
    });

    it('keeps valid saved table choices and drops unknown columns', () => {
        expect(
            sanitizePlayerListSorting([
                { id: 'displayName', desc: false },
                { id: 'unknown', desc: true },
                null
            ])
        ).toEqual([{ id: 'displayName', desc: false }]);

        expect(
            sanitizePlayerListColumnVisibility({
                avatar: false,
                timer: true,
                unknown: false,
                displayName: 'yes'
            })
        ).toEqual({ avatar: false, timer: true });

        expect(
            sanitizePlayerListColumnOrder(['note', 'unknown', 'avatar', 'note'])
        ).toEqual([
            'note',
            'avatar',
            ...PLAYER_LIST_COLUMN_IDS.filter(
                (columnId) => !['note', 'avatar'].includes(columnId)
            )
        ]);

        expect(
            sanitizePlayerListColumnSizing({
                avatar: '64',
                timer: 120,
                displayName: '-1',
                unknown: 200
            })
        ).toEqual({ avatar: 64, timer: 120 });
    });

    it('restores and updates persisted player-list table state without losing existing fields', () => {
        const store = installLocalStorage({
            [PLAYER_LIST_STORAGE_KEY]: JSON.stringify({
                sorting: [{ id: 'timer', desc: true }],
                columnVisibility: { avatar: false }
            })
        });

        expect(readPersistedPlayerListState()).toEqual({
            sorting: [{ id: 'timer', desc: true }],
            columnVisibility: { avatar: false }
        });

        writePersistedPlayerListState({
            columnOrder: ['avatar', 'timer']
        });

        const saved = JSON.parse(store.get(PLAYER_LIST_STORAGE_KEY));
        expect(saved.sorting).toEqual([{ id: 'timer', desc: true }]);
        expect(saved.columnVisibility).toEqual({ avatar: false });
        expect(saved.columnOrder).toEqual(['avatar', 'timer']);
        expect(Number.isFinite(saved.updatedAt)).toBe(true);
    });
});
