import { describe, expect, it } from 'vitest';

import {
    buildCurrentEntryFromFriend,
    buildFriendLogRowsById,
    buildFriendStateMap,
    buildSeedRosterFriendsById,
    createFallbackFriendUser,
    getDisplayName,
    getMeaningfulDisplayName,
    hasCompleteFriendStateSnapshot,
    hasFriendListSnapshot,
    normalizeFriendEntry,
    normalizeFriendsById,
    normalizeStateBucket,
    normalizeStringArray,
    normalizeUserId
} from './friendBootstrapModel';

describe('friendBootstrapModel pure normalizers', () => {
    it('normalizes ids, state buckets, string arrays, and friend maps defensively', () => {
        expect(normalizeUserId(' usr_friend ')).toBe('usr_friend');
        expect(normalizeUserId(null)).toBe('');
        expect(normalizeStateBucket('ONLINE')).toBe('online');
        expect(normalizeStateBucket('busy')).toBe('');
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
        expect(hasFriendListSnapshot({ friends: ['usr_a'] })).toBe(true);
    });

    it('chooses meaningful display names without echoing the user id', () => {
        expect(
            getDisplayName({
                id: 'usr_id',
                username: 'Username'
            })
        ).toBe('Username');
        expect(
            getMeaningfulDisplayName(
                {
                    id: 'usr_id',
                    displayName: 'usr_id',
                    username: 'Real Name'
                },
                'usr_id'
            )
        ).toBe('Real Name');
        expect(
            getMeaningfulDisplayName(
                {
                    id: 'usr_id',
                    displayName: 'usr_id',
                    username: 'usr_id'
                },
                'usr_id'
            )
        ).toBe('');
    });

    it('normalizes friend entries from profile data while preserving existing row fallbacks', () => {
        const normalized = normalizeFriendEntry(
            {
                id: 'usr_friend',
                displayName: 'usr_friend',
                username: 'Profile Name',
                platform: 'android',
                last_platform: 'standalonewindows',
                friendNumber: '9',
                trustLevel: 'Known User',
                tags: ['system_trust_trusted']
            },
            'online',
            {
                userId: 'usr_friend',
                displayName: 'Cached Name',
                trustLevel: 'Visitor',
                friendNumber: 2
            }
        );

        expect(normalized).toMatchObject({
            id: 'usr_friend',
            displayName: 'Profile Name',
            state: 'online',
            stateBucket: 'online',
            friendNumber: 9,
            $friendNumber: 9,
            trustLevel: 'Known User',
            $trustLevel: 'Known User'
        });

        const fallback = normalizeFriendEntry(null, 'offline', {
            userId: 'usr_cached',
            displayName: 'Cached Friend',
            trustLevel: 'Trusted User',
            friendNumber: 7
        });
        expect(fallback).toMatchObject({
            id: 'usr_cached',
            displayName: 'Cached Friend',
            stateBucket: 'offline',
            friendNumber: 7,
            trustLevel: 'Trusted User'
        });
    });

    it('builds friend-log current entries and seed rosters from mixed row shapes', () => {
        const currentEntry = buildCurrentEntryFromFriend({
            userId: 'usr_friend',
            friend: {
                id: 'usr_friend',
                username: 'Friend',
                $trustLevel: 'Trusted User'
            },
            friendNumber: 3
        });
        expect(currentEntry).toEqual({
            userId: 'usr_friend',
            displayName: 'Friend',
            trustLevel: 'Trusted User',
            friendNumber: 3
        });

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

    it('creates deterministic offline fallback users from cached rows', () => {
        expect(
            createFallbackFriendUser(' usr_cached ', {
                userId: 'usr_cached',
                displayName: 'Cached Friend',
                trustLevel: 'Visitor',
                friendNumber: 0
            })
        ).toMatchObject({
            id: 'usr_cached',
            displayName: 'Cached Friend',
            platform: 'offline',
            location: 'offline',
            state: 'offline'
        });
    });
});
