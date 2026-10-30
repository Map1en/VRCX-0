import { describe, expect, it } from 'vitest';

import { activePresence, pendingPresence } from '@/test/presenceFixtures';

import {
    filterFriendListRows,
    friendNumberForSort,
    matchesFriendListSearch,
    normalizeFriendListId
} from './friendListRows';

describe('friendListRows', () => {
    it('matches friends by the search filters users can toggle', () => {
        const friend: Parameters<typeof matchesFriendListSearch>[0] = {
            id: 'usr_friend',
            displayName: 'Ａｌｉｃｅ Star',
            username: 'alice_user',
            $trustLevel: 'Trusted',
            statusDescription: 'Working on avatars',
            status: 'active',
            stateBucket: 'online',
            note: 'old note',
            memo: 'local memo'
        };
        const memos = new Map([['usr_friend', 'raid buddy']]);
        const notes = new Map([['usr_friend', 'met at event']]);

        expect(
            matchesFriendListSearch(
                friend,
                'AliceStar',
                new Set(),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'alice_user',
                new Set(['username']),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'trusted',
                new Set(['rank']),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'avatars',
                new Set(['status']),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                { ...friend, $presence: pendingPresence() },
                'online',
                new Set(['status']),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                { ...friend, $presence: activePresence() },
                'online',
                new Set(['status']),
                memos,
                notes
            )
        ).toBe(false);
        expect(
            matchesFriendListSearch(
                friend,
                'event',
                new Set(['note']),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'raid',
                new Set(['memo']),
                memos,
                notes
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'missing',
                new Set(['displayName']),
                memos,
                notes
            )
        ).toBe(false);
    });

    it('searches profile bio text and bio links by default', () => {
        const friend: Parameters<typeof matchesFriendListSearch>[0] = {
            id: 'usr_friend',
            displayName: 'Alice',
            bio: 'Weekend DJ ＠ Club˸ Nova',
            bioLinks: ['https://twitter.com/alice_vr']
        };
        const empty = new Map<string, string>();

        expect(
            matchesFriendListSearch(friend, 'dj', new Set(), empty, empty)
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                '@ club: nova',
                new Set(['bio']),
                empty,
                empty
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'twitter.com/alice',
                new Set(['bio']),
                empty,
                empty
            )
        ).toBe(true);
        expect(
            matchesFriendListSearch(
                friend,
                'dj',
                new Set(['displayName']),
                empty,
                empty
            )
        ).toBe(false);
    });

    it('returns the friends a user expects after combining favorites-only and search', () => {
        const rows = [
            {
                id: 'usr_1',
                displayName: 'Ava',
                statusDescription: 'Quest worlds'
            },
            {
                id: 'usr_2',
                displayName: 'Ben',
                statusDescription: 'Desktop worlds'
            },
            {
                id: 'usr_3',
                displayName: 'Cara',
                statusDescription: 'Quest worlds'
            }
        ];
        const favorites = new Set(['usr_1', 'usr_3']);

        expect(
            filterFriendListRows({
                rosterRows: rows,
                favoritesOnly: true,
                favoriteFriendIds: favorites,
                searchQuery: 'quest',
                activeSearchFilterIds: new Set(['status']),
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
