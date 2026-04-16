import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_EMPTY_USER_ID,
    MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY,
    normalizeExcludedMutualFriendIds,
    readExcludedMutualFriendIds,
    writeExcludedMutualFriendIds
} from './mutualFriendsSettings.js';

const originalLocalStorage = globalThis.localStorage;

function installLocalStorage(initialValue = null) {
    const store = new Map();
    if (initialValue !== null) {
        store.set(MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY, initialValue);
    }
    globalThis.localStorage = {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => {
            store.set(key, value);
        })
    };
    return store;
}

afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
});

describe('mutualFriendsSettings', () => {
    it('keeps saved hidden friend ids trimmed and ignores unusable entries', () => {
        installLocalStorage(JSON.stringify([' usr_a ', '', null, MUTUAL_GRAPH_EMPTY_USER_ID, 'usr_b']));

        expect(readExcludedMutualFriendIds()).toEqual(['usr_a', 'usr_b']);
        expect(normalizeExcludedMutualFriendIds([' usr_c ', undefined, MUTUAL_GRAPH_EMPTY_USER_ID, 'usr_d'])).toEqual([
            'usr_c',
            'usr_d'
        ]);
    });

    it('persists hidden friend ids in the same normalized shape the page reads back', () => {
        const store = installLocalStorage();

        writeExcludedMutualFriendIds([' usr_a ', '', 'usr_b']);

        expect(JSON.parse(store.get(MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY))).toEqual([
            'usr_a',
            'usr_b'
        ]);
    });

    it('falls back to safe graph settings when stored values are out of range or invalid', () => {
        expect(clampMutualGraphNumber('900', 300, 1500, 800)).toBe(900);
        expect(clampMutualGraphNumber(2000, 300, 1500, 800)).toBe(1500);
        expect(clampMutualGraphNumber('bad', 300, 1500, 800)).toBe(800);
    });
});
