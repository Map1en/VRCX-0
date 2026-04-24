import { afterEach, describe, expect, it } from 'vitest';

import {
    FRIEND_LIST_COLUMN_IDS,
    FRIEND_LIST_DEFAULT_PAGE_SIZES,
    FRIEND_LIST_DEFAULT_SORTING,
    readPersistedFriendListState,
    resolveFriendListPageSize,
    sanitizeFriendListColumnOrder,
    sanitizeFriendListColumnSizing,
    sanitizeFriendListColumnVisibility,
    sanitizeFriendListPageSizes,
    sanitizeFriendListSorting,
    writePersistedFriendListState
} from './friendListState.js';

const STORAGE_KEY = 'vrcx:table:friendList';

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

describe('friendListState', () => {
    it('restores and merges the saved friend-list table layout', () => {
        installLocalStorage({
            [STORAGE_KEY]: JSON.stringify({
                sorting: [{ id: 'displayName', desc: false }],
                pageSize: 50
            })
        });

        expect(readPersistedFriendListState()).toMatchObject({
            sorting: [{ id: 'displayName', desc: false }],
            pageSize: 50
        });

        writePersistedFriendListState({
            columnVisibility: { avatar: false }
        });

        expect(readPersistedFriendListState()).toMatchObject({
            sorting: [{ id: 'displayName', desc: false }],
            pageSize: 50,
            columnVisibility: { avatar: false }
        });
        expect(readPersistedFriendListState().updatedAt).toEqual(
            expect.any(Number)
        );
    });

    it('falls back to defaults when saved sorting or page sizes cannot be used', () => {
        expect(readPersistedFriendListState()).toEqual({});

        installLocalStorage({
            [STORAGE_KEY]: '{not-json'
        });
        expect(readPersistedFriendListState()).toEqual({});

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
        expect(readPersistedFriendListState()).toEqual({});
        expect(() =>
            writePersistedFriendListState({ pageSize: 10 })
        ).not.toThrow();

        expect(sanitizeFriendListSorting([{ id: 'unknown', desc: true }])).toBe(
            FRIEND_LIST_DEFAULT_SORTING
        );
        expect(sanitizeFriendListPageSizes(['bad', 0])).toBe(
            FRIEND_LIST_DEFAULT_PAGE_SIZES
        );
    });

    it('keeps supported page-size and column choices users can select', () => {
        expect(
            sanitizeFriendListSorting([
                { id: 'friendNumber', desc: true },
                { id: 'unknown', desc: false },
                { id: 'lastSeen', desc: true }
            ])
        ).toEqual([
            { id: 'friendNumber', desc: true },
            { id: 'lastSeen', desc: true }
        ]);

        expect(sanitizeFriendListPageSizes(['50', 10, 25, 10])).toEqual([
            10, 25, 50
        ]);
        expect(resolveFriendListPageSize('50', [10, 25, 50], 25)).toBe(50);
        expect(resolveFriendListPageSize('999', [10, 25, 50], 25)).toBe(50);
        expect(resolveFriendListPageSize('bad', [], 25)).toBe(10);
    });

    it('sanitizes saved columns while keeping friend number always visible', () => {
        expect(
            sanitizeFriendListColumnVisibility({
                friendNumber: false,
                avatar: false,
                status: true,
                unknown: false
            })
        ).toEqual({
            avatar: false,
            status: true
        });

        expect(
            sanitizeFriendListColumnOrder(['status', 'avatar', 'status'])
        ).toEqual([
            'status',
            'avatar',
            ...FRIEND_LIST_COLUMN_IDS.filter(
                (columnId) => columnId !== 'status' && columnId !== 'avatar'
            )
        ]);

        expect(
            sanitizeFriendListColumnSizing({
                avatar: '96px',
                displayName: 220,
                unknown: 100,
                status: 0
            })
        ).toEqual({
            avatar: 96,
            displayName: 220
        });
    });
});
