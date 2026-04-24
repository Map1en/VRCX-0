import { afterEach, describe, expect, it } from 'vitest';

import {
    MY_AVATARS_COLUMN_IDS,
    MY_AVATARS_DEFAULT_CARD_SCALE,
    MY_AVATARS_DEFAULT_CARD_SPACING,
    MY_AVATARS_DEFAULT_PAGE_SIZES,
    MY_AVATARS_DEFAULT_SORTING,
    normalizeMyAvatarsColumnId,
    readPersistedMyAvatarsState,
    resolveMyAvatarsPageSize,
    sanitizeMyAvatarsCardScale,
    sanitizeMyAvatarsCardSpacing,
    sanitizeMyAvatarsColumnOrder,
    sanitizeMyAvatarsColumnSizing,
    sanitizeMyAvatarsColumnVisibility,
    sanitizeMyAvatarsPageSizes,
    sanitizeMyAvatarsSorting,
    writePersistedMyAvatarsState
} from './myAvatarsState.js';

const STORAGE_KEY = 'vrcx:table:my-avatars';

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

describe('myAvatarsState', () => {
    it('restores a persisted table state and merges later updates', () => {
        installLocalStorage({
            [STORAGE_KEY]: JSON.stringify({
                sorting: [{ id: 'name', desc: false }],
                pageSize: 50
            })
        });

        expect(readPersistedMyAvatarsState()).toMatchObject({
            sorting: [{ id: 'name', desc: false }],
            pageSize: 50
        });

        writePersistedMyAvatarsState({
            columnVisibility: { thumbnail: false }
        });

        expect(readPersistedMyAvatarsState()).toMatchObject({
            sorting: [{ id: 'name', desc: false }],
            pageSize: 50,
            columnVisibility: { thumbnail: false }
        });
        expect(readPersistedMyAvatarsState().updatedAt).toEqual(
            expect.any(Number)
        );
    });

    it('falls back to an empty persisted state when storage is unavailable or invalid', () => {
        expect(readPersistedMyAvatarsState()).toEqual({});

        installLocalStorage({
            [STORAGE_KEY]: '{not-json'
        });

        expect(readPersistedMyAvatarsState()).toEqual({});

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
        expect(readPersistedMyAvatarsState()).toEqual({});
        expect(() =>
            writePersistedMyAvatarsState({ pageSize: 10 })
        ).not.toThrow();
    });

    it('keeps supported sorting columns and migrates old column ids', () => {
        expect(normalizeMyAvatarsColumnId(' releaseStatus ')).toBe(
            'visibility'
        );
        expect(normalizeMyAvatarsColumnId('action')).toBe('actions');

        expect(
            sanitizeMyAvatarsSorting([
                { id: 'releaseStatus', desc: false },
                { id: 'unknown', desc: true },
                { id: 'updated_at', desc: true }
            ])
        ).toEqual([
            { id: 'visibility', desc: false },
            { id: 'updated_at', desc: true }
        ]);

        expect(sanitizeMyAvatarsSorting([{ id: 'active', desc: true }])).toBe(
            MY_AVATARS_DEFAULT_SORTING
        );
    });

    it('normalizes page-size and grid-density preferences for the avatar inventory', () => {
        expect(
            sanitizeMyAvatarsPageSizes(['50', 10, 25, 10, 0, 'bad'])
        ).toEqual([10, 25, 50]);
        expect(sanitizeMyAvatarsPageSizes(['bad'])).toBe(
            MY_AVATARS_DEFAULT_PAGE_SIZES
        );

        expect(resolveMyAvatarsPageSize('50', [10, 25, 50], 25)).toBe(50);
        expect(resolveMyAvatarsPageSize('999', [10, 25, 50], 25)).toBe(50);
        expect(resolveMyAvatarsPageSize('999', [10, 50], 25)).toBe(50);
        expect(resolveMyAvatarsPageSize('bad', [], 25)).toBe(10);

        expect(sanitizeMyAvatarsCardScale('0.2')).toBe(0.4);
        expect(sanitizeMyAvatarsCardScale('2')).toBe(1.4);
        expect(sanitizeMyAvatarsCardScale('bad')).toBe(
            MY_AVATARS_DEFAULT_CARD_SCALE
        );
        expect(sanitizeMyAvatarsCardSpacing('0.2')).toBe(0.6);
        expect(sanitizeMyAvatarsCardSpacing('3')).toBe(2);
        expect(sanitizeMyAvatarsCardSpacing('bad')).toBe(
            MY_AVATARS_DEFAULT_CARD_SPACING
        );
    });

    it('sanitizes saved column visibility, order, and sizing with migrated ids', () => {
        expect(
            sanitizeMyAvatarsColumnVisibility({
                thumbnail: false,
                action: true,
                unknown: false,
                name: 'yes'
            })
        ).toEqual({
            thumbnail: false,
            actions: true
        });

        expect(
            sanitizeMyAvatarsColumnOrder(['action', 'name', 'name'])
        ).toEqual([
            'actions',
            'name',
            ...MY_AVATARS_COLUMN_IDS.filter(
                (columnId) => columnId !== 'actions' && columnId !== 'name'
            )
        ]);

        expect(
            sanitizeMyAvatarsColumnSizing({
                thumbnail: '120px',
                releaseStatus: 160,
                unknown: 200,
                name: 0
            })
        ).toEqual({
            thumbnail: 120,
            visibility: 160
        });
    });
});
