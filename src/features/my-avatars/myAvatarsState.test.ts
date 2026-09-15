import { afterEach, describe, expect, it } from 'vitest';

import {
    MY_AVATARS_COLUMN_IDS,
    MY_AVATARS_DEFAULT_PAGE_SIZES,
    MY_AVATARS_DEFAULT_SORTING,
    normalizeMyAvatarsColumnId,
    readPersistedMyAvatarsState,
    resolveMyAvatarsColumnOrder,
    resolveMyAvatarsColumnVisibility,
    resolveMyAvatarsGridDensity,
    resolveMyAvatarsPageSize,
    sanitizeMyAvatarsColumnOrder,
    sanitizeMyAvatarsColumnSizing,
    sanitizeMyAvatarsColumnVisibility,
    sanitizeMyAvatarsGridDensity,
    sanitizeMyAvatarsPageSizes,
    sanitizeMyAvatarsSorting,
    writePersistedMyAvatarsState
} from './myAvatarsState';

const STORAGE_KEY = 'vrcx-0:table:my-avatars';

function installLocalStorage(initial: Record<string, unknown> = {}) {
    const store = new Map(
        Object.entries(initial).map(([key, value]) => [key, String(value)])
    );

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: {
                getItem(key: string) {
                    return store.has(key) ? store.get(key) : null;
                },
                setItem(key: string, value: string) {
                    store.set(key, String(value));
                }
            }
        }
    });

    return store;
}

afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
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
            columnVisibility: { version: true }
        });

        expect(readPersistedMyAvatarsState()).toMatchObject({
            sorting: [{ id: 'name', desc: false }],
            pageSize: 50,
            columnVisibility: { version: true }
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

        expect(sanitizeMyAvatarsGridDensity('compact')).toBe('compact');
        expect(sanitizeMyAvatarsGridDensity('invalid')).toBe('standard');
        expect(
            resolveMyAvatarsGridDensity({
                persistedDensity: 'dense',
                legacyGridDensity: 'compact',
                legacyCardScale: '0.4'
            })
        ).toBe('dense');
        expect(
            resolveMyAvatarsGridDensity({
                legacyGridDensity: 'micro'
            })
        ).toBe('dense');
        expect(
            resolveMyAvatarsGridDensity({
                legacyCardScale: '0.5'
            })
        ).toBe('compact');
    });

    it('sanitizes saved column visibility, order, and sizing with migrated ids', () => {
        expect(
            sanitizeMyAvatarsColumnVisibility({
                visibility: false,
                version: true,
                action: true,
                unknown: false,
                name: 'yes'
            })
        ).toEqual({
            visibility: false,
            version: true,
            actions: true
        });

        expect(resolveMyAvatarsColumnVisibility()).toMatchObject({
            version: false,
            pcPerf: false,
            androidPerf: false,
            iosPerf: false,
            created_at: false
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

        const resolvedColumnOrder = resolveMyAvatarsColumnOrder([
            'actions',
            'visibility',
            'name'
        ]);
        expect(resolvedColumnOrder[0]).toBe('name');
        expect(resolvedColumnOrder.at(-1)).toBe('actions');
        expect(new Set(resolvedColumnOrder)).toEqual(
            new Set(MY_AVATARS_COLUMN_IDS)
        );

        expect(
            sanitizeMyAvatarsColumnSizing({
                timeSpent: '120px',
                releaseStatus: 160,
                unknown: 200,
                name: 240
            })
        ).toEqual({
            timeSpent: 120,
            name: 240,
            visibility: 160
        });
    });
});
