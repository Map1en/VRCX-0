import { describe, expect, it } from 'vitest';

import {
    buildFriendListFavoriteIdSet,
    buildFriendListUserStatsById,
    filterFriendListRows,
    friendNumberForSort,
    matchesFriendListSearch,
    normalizeFriendListId
} from './friendListRows.js';

describe('friendListRows', () => {
    it('combines remote and local favorite ids for the favorites-only filter', () => {
        expect(
            [...buildFriendListFavoriteIdSet([' usr_remote ', ''], {
                groupA: ['usr_local'],
                ignored: 'not-an-array'
            })]
        ).toEqual(['usr_remote', 'usr_local']);
    });

    it('aggregates game-log stats by friend id and keeps the most recent last seen time', () => {
        const stats = buildFriendListUserStatsById(
            [
                {
                    displayName: 'Ava',
                    userId: 'usr_ava',
                    lastSeen: '2026-04-10T00:00:00.000Z',
                    timeSpent: 100,
                    joinCount: 1
                },
                {
                    displayName: 'Ava',
                    lastSeen: '2026-04-12T00:00:00.000Z',
                    timeSpent: 200,
                    joinCount: 2
                },
                {
                    displayName: 'Ben',
                    lastSeen: '2026-04-11T00:00:00.000Z',
                    timeSpent: 50,
                    joinCount: 1
                }
            ],
            [
                { id: 'usr_ava', displayName: 'Ava' },
                { id: 'usr_ben', displayName: 'Ben' }
            ]
        );

        expect(stats.get('usr_ava')).toMatchObject({
            lastSeen: '2026-04-12T00:00:00.000Z',
            timeSpent: 300,
            joinCount: 3
        });
        expect(stats.get('usr_ben')).toMatchObject({
            lastSeen: '2026-04-11T00:00:00.000Z',
            timeSpent: 50,
            joinCount: 1
        });
    });

    it('matches friends by the search filters users can toggle', () => {
        const friend = {
            id: 'usr_friend',
            displayName: 'Ａｌｉｃｅ Star',
            username: 'alice_user',
            $trustLevel: 'Trusted',
            statusDescription: 'Working on avatars',
            status: 'active',
            stateBucket: 'online',
            bio: 'VR dancer',
            note: 'old note',
            memo: 'local memo'
        };
        const memos = new Map([['usr_friend', 'raid buddy']]);
        const notes = new Map([['usr_friend', 'met at event']]);

        expect(matchesFriendListSearch(friend, 'AliceStar', new Set(), memos, notes)).toBe(
            true
        );
        expect(
            matchesFriendListSearch(friend, 'alice_user', new Set(['username']), memos, notes)
        ).toBe(true);
        expect(
            matchesFriendListSearch(friend, 'trusted', new Set(['rank']), memos, notes)
        ).toBe(true);
        expect(
            matchesFriendListSearch(friend, 'avatars', new Set(['status']), memos, notes)
        ).toBe(true);
        expect(
            matchesFriendListSearch(friend, 'dancer', new Set(['bio']), memos, notes)
        ).toBe(true);
        expect(
            matchesFriendListSearch(friend, 'event', new Set(['note']), memos, notes)
        ).toBe(true);
        expect(
            matchesFriendListSearch(friend, 'raid', new Set(['memo']), memos, notes)
        ).toBe(true);
        expect(
            matchesFriendListSearch(friend, 'missing', new Set(['displayName']), memos, notes)
        ).toBe(false);
    });

    it('returns the friends a user expects after combining favorites-only and search', () => {
        const rows = [
            { id: 'usr_1', displayName: 'Ava', bio: 'Quest worlds' },
            { id: 'usr_2', displayName: 'Ben', bio: 'Desktop worlds' },
            { id: 'usr_3', displayName: 'Cara', bio: 'Quest worlds' }
        ];
        const favorites = new Set(['usr_1', 'usr_3']);

        expect(
            filterFriendListRows({
                rosterRows: rows,
                favoritesOnly: true,
                favoriteFriendIds: favorites,
                searchQuery: 'quest',
                activeSearchFilterIds: new Set(['bio']),
                userMemoById: new Map(),
                userNoteById: new Map()
            }).map((friend) => friend.id)
        ).toEqual(['usr_1', 'usr_3']);
        expect(
            filterFriendListRows({
                rosterRows: rows,
                favoritesOnly: true,
                favoriteFriendIds: favorites,
                searchQuery: 'ben',
                activeSearchFilterIds: new Set(['displayName']),
                userMemoById: new Map(),
                userNoteById: new Map()
            })
        ).toEqual([]);
    });

    it('normalizes ids and sorts friend numbers as users see them', () => {
        expect(normalizeFriendListId(' usr_1 ')).toBe('usr_1');
        expect(normalizeFriendListId(null)).toBe('');
        expect(friendNumberForSort({ $friendNumber: '12' })).toBe(12);
        expect(friendNumberForSort({ friendNumber: '7' })).toBe(7);
        expect(friendNumberForSort({})).toBe(0);
    });
});
