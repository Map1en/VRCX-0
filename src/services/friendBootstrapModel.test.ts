import { describe, expect, it } from 'vitest';

import {
    buildFriendLogRowsById,
    buildFriendStateMap,
    buildSeedRosterFriendsById,
    getDisplayName,
    hasCompleteFriendStateSnapshot,
    normalizeFriendsById,
    normalizeStringArray,
    normalizeUserId
} from './friendBootstrapModel';

describe('friendBootstrapModel pure normalizers', () => {
    it('normalizes ids, string arrays, and friend maps defensively', () => {
        expect(normalizeUserId(' usr_friend ')).toBe('usr_friend');
        expect(normalizeUserId(null)).toBe('');
        expect(normalizeStringArray([' usr_a ', '', null, 42])).toEqual([
            'usr_a',
            '42'
        ]);
        expect(
            normalizeFriendsById({
                usr_a: { id: 'usr_a' },
                usr_b: null,
                usr_c: 'bad'
            })
        ).toEqual({
            usr_a: { id: 'usr_a' }
        });
    });

    it('builds friend state maps with online and active lists overriding the base friend list', () => {
        const stateById = buildFriendStateMap({
            friends: ['usr_online', 'usr_active', 'usr_offline'],
            offlineFriends: ['usr_offline'],
            activeFriends: ['usr_active'],
            onlineFriends: ['usr_online', 'usr_active']
        });

        expect([...stateById.entries()]).toEqual([
            ['usr_online', 'online'],
            ['usr_active', 'online'],
            ['usr_offline', 'offline']
        ]);
        expect(
            hasCompleteFriendStateSnapshot({
                friends: [],
                offlineFriends: [],
                activeFriends: [],
                onlineFriends: []
            })
        ).toBe(true);
        expect(hasCompleteFriendStateSnapshot({ friends: [] })).toBe(false);
    });

    it('derives display names from profile fields', () => {
        expect(
            getDisplayName({
                id: 'usr_id',
                username: 'Username'
            })
        ).toBe('Username');
    });

    it('builds friend-log row maps and seed rosters from mixed row shapes', () => {
        const rowsById = buildFriendLogRowsById([
            {
                userId: 'usr_a',
                displayName: 'A',
                trustLevel: 'Known User',
                friendNumber: 1
            },
            {
                user_id: 'usr_b',
                displayName: 'B',
                trustLevel: 'Visitor',
                $friendNumber: 2
            },
            {
                userId: '',
                displayName: 'Skipped',
                trustLevel: 'Visitor',
                friendNumber: 0
            }
        ]);
        expect([...rowsById.keys()]).toEqual(['usr_a', 'usr_b']);

        const seed = buildSeedRosterFriendsById(
            new Map([
                ['usr_a', 'online'],
                ['usr_b', 'active'],
                ['usr_missing', 'offline']
            ]),
            [...rowsById.values()]
        );
        expect(seed).toMatchObject({
            usr_a: {
                id: 'usr_a',
                displayName: 'A',
                stateBucket: 'online',
                $friendNumber: 1
            },
            usr_b: {
                id: 'usr_b',
                displayName: 'B',
                stateBucket: 'active',
                $friendNumber: 2
            },
            usr_missing: {
                id: 'usr_missing',
                displayName: 'usr_missing',
                stateBucket: 'offline',
                $trustLevel: 'Visitor'
            }
        });
    });
});
