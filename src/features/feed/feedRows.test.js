import { describe, expect, it } from 'vitest';

import {
    buildFeedFavoriteIdSet,
    canRequestInviteFromFeedFriend,
    collectMatchingLiveFeedEntries,
    feedEntryMatchesView,
    feedSearchMatches,
    getFeedRowId,
    isUserIdLike,
    mergeLiveFeedEntries,
    normalizeFeedId,
    parseDateInput,
    resolveDisplayNameCandidate,
    resolveFeedCurrentInviteLocation,
    resolveFeedFriendStateBucket,
    resolveFeedStatusMeta,
    resolveFeedUserDisplayName,
    resolveFeedUserId,
    toDateInputValue,
    UNKNOWN_FEED_USER_DISPLAY_NAME
} from './feedRows.js';

const USER_ID = 'usr_12345678-1234-1234-1234-1234567890ab';

describe('feed row helpers', () => {
    it('normalizes ids and resolves feed user labels without showing raw user ids as names', () => {
        expect(normalizeFeedId('  usr_1  ')).toBe('usr_1');
        expect(isUserIdLike(USER_ID)).toBe(true);
        expect(resolveDisplayNameCandidate(USER_ID, USER_ID)).toBe('');
        expect(resolveDisplayNameCandidate('Unknown', USER_ID)).toBe('');
        expect(resolveDisplayNameCandidate('Maple', USER_ID)).toBe('Maple');
        expect(resolveFeedUserId({ sender_user_id: USER_ID })).toBe(USER_ID);
        expect(resolveFeedUserId({ displayName: USER_ID })).toBe(USER_ID);
        expect(resolveFeedUserDisplayName(
            { userId: USER_ID, displayName: USER_ID },
            { displayName: 'Friend Name' },
            'Cached Name'
        )).toBe('Friend Name');
        expect(resolveFeedUserDisplayName({ userId: USER_ID }, null, '')).toBe(UNKNOWN_FEED_USER_DISPLAY_NAME);
    });

    it('resolves friend state and current invite location from visible session data', () => {
        expect(resolveFeedFriendStateBucket({ id: USER_ID, state: 'offline:offline' }, {})).toBe('offline');
        expect(resolveFeedFriendStateBucket({ id: USER_ID }, { onlineFriends: [USER_ID] })).toBe('online');
        expect(canRequestInviteFromFeedFriend({ id: USER_ID }, { onlineFriends: [USER_ID] })).toBe(true);
        expect(
            resolveFeedCurrentInviteLocation(
                { currentLocation: 'traveling', currentDestination: 'wrld_dest:123' },
                { location: 'wrld_profile:456' }
            )
        ).toBe('wrld_dest:123');
        expect(resolveFeedCurrentInviteLocation({}, { $locationTag: 'wrld_profile:456' })).toBe('wrld_profile:456');
    });

    it('builds favorite friend ids from selected remote groups and local favorites', () => {
        const ids = buildFeedFavoriteIdSet(
            {
                fav_1: { type: 'friend', favoriteId: USER_ID, $groupKey: 'group_a' },
                fav_2: { type: 'friend', favoriteId: 'usr_other', $groupKey: 'group_b' },
                fav_3: { type: 'world', favoriteId: 'wrld_1', $groupKey: 'group_a' }
            },
            {
                Local: [' usr_local ', '']
            },
            ['group_a']
        );

        expect([...ids]).toEqual([USER_ID, 'usr_local']);
    });

    it('matches feed rows by filters, favorites, dates, and search text', () => {
        const row = {
            type: 'GPS',
            userId: USER_ID,
            displayName: 'Maple',
            location: 'wrld_123:456',
            worldName: 'Club Orion',
            created_at: '2026-01-15T12:00:00.000Z'
        };

        expect(feedSearchMatches(row, 'orion')).toBe(true);
        expect(feedSearchMatches(row, 'wrld_123')).toBe(true);
        expect(feedEntryMatchesView({
            currentUserId: 'current',
            row,
            activeFilters: ['GPS'],
            dateFrom: '2026-01-15',
            dateTo: '2026-01-15',
            favoriteIdSet: new Set([USER_ID]),
            favoritesOnly: true,
            search: 'maple'
        })).toBe(true);
        expect(feedEntryMatchesView({
            currentUserId: 'current',
            row,
            activeFilters: ['OnPlayerJoined'],
            dateFrom: '2026-01-15',
            dateTo: '2026-01-15',
            favoriteIdSet: new Set([USER_ID]),
            favoritesOnly: true,
            search: 'maple'
        })).toBe(false);
    });

    it('collects and merges live feed entries without duplicating existing rows', () => {
        const oldRow = { id: 1, type: 'GPS', userId: USER_ID, displayName: 'Old' };
        const updatedRow = { id: 1, type: 'GPS', userId: USER_ID, displayName: 'Updated' };
        const newRow = { rowId: 2, type: 'GPS', userId: USER_ID, displayName: 'New' };

        expect(getFeedRowId(oldRow)).toBe('id:1');
        const result = collectMatchingLiveFeedEntries([
            { sequence: 1, entry: oldRow },
            { sequence: 2, entry: updatedRow },
            { sequence: 3, entry: newRow }
        ], 1, {
            currentUserId: 'current',
            activeFilters: ['GPS'],
            dateFrom: '',
            dateTo: '',
            favoriteIdSet: new Set(),
            favoritesOnly: false,
            search: ''
        });

        expect(result.maxSequence).toBe(3);
        expect(result.matchingEntries).toEqual([updatedRow, newRow]);
        expect(mergeLiveFeedEntries([oldRow], result.matchingEntries, 10)).toEqual([newRow, updatedRow]);
    });

    it('keeps the newest live feed row when the same row id appears more than once', () => {
        const firstUpdate = { id: 1, type: 'GPS', userId: USER_ID, displayName: 'First update' };
        const secondUpdate = { id: 1, type: 'GPS', userId: USER_ID, displayName: 'Second update' };

        expect(mergeLiveFeedEntries([], [secondUpdate, firstUpdate], 10)).toEqual([secondUpdate]);
    });

    it('formats date inputs and status display metadata', () => {
        const parsed = parseDateInput('2026-03-04');

        expect(parsed).toBeInstanceOf(Date);
        expect(toDateInputValue(parsed)).toBe('2026-03-04');
        expect(parseDateInput('not-a-date')).toBeUndefined();
        expect(toDateInputValue(null)).toBe('');
        expect(resolveFeedStatusMeta('active')).toEqual({
            label: 'Online',
            className: 'bg-[var(--status-online)]'
        });
        expect(resolveFeedStatusMeta('joinme')).toEqual({
            label: 'Join Me',
            className: 'bg-[var(--status-joinme)]'
        });
        expect(resolveFeedStatusMeta('')).toEqual({
            label: 'Offline',
            className: ''
        });
    });
});
