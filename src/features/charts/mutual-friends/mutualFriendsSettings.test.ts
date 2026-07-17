import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_EMPTY_USER_ID,
    MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY,
    normalizeExcludedMutualFriendIds,
    readExcludedMutualFriendIds,
    writeExcludedMutualFriendIds
} from './mutualFriendsSettings';

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
);

function installLocalStorage(initialValue: string | null = null) {
    const store = new Map<string, string>();
    if (initialValue !== null) {
        store.set(MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY, initialValue);
    }
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: vi.fn((key: string) => store.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => {
                store.set(key, value);
            })
        }
    });
    return store;
}

afterEach(() => {
    if (originalLocalStorageDescriptor) {
        Object.defineProperty(
            globalThis,
            'localStorage',
            originalLocalStorageDescriptor
        );
    } else {
        Reflect.deleteProperty(globalThis, 'localStorage');
    }
});

describe('mutualFriendsSettings', () => {
    it('keeps saved hidden friend ids trimmed and ignores unusable entries', () => {
        installLocalStorage(
            JSON.stringify([
                ' usr_a ',
                '',
                null,
                MUTUAL_GRAPH_EMPTY_USER_ID,
                'usr_b'
            ])
        );

        expect(readExcludedMutualFriendIds()).toEqual(['usr_a', 'usr_b']);
        expect(
            normalizeExcludedMutualFriendIds([
                ' usr_c ',
                undefined,
                MUTUAL_GRAPH_EMPTY_USER_ID,
                'usr_d'
            ])
        ).toEqual(['usr_c', 'usr_d']);
    });

    it('persists hidden friend ids in the same normalized shape the page reads back', () => {
        const store = installLocalStorage();

        writeExcludedMutualFriendIds([' usr_a ', '', 'usr_b']);

        expect(
            JSON.parse(store.get(MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY) ?? '')
        ).toEqual(['usr_a', 'usr_b']);
    });

    it('falls back to safe graph settings when stored values are out of range or invalid', () => {
        expect(clampMutualGraphNumber('900', 300, 1500, 800)).toBe(900);
        expect(clampMutualGraphNumber(2000, 300, 1500, 800)).toBe(1500);
        expect(clampMutualGraphNumber('bad', 300, 1500, 800)).toBe(800);
    });
});
