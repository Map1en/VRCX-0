import { describe, expect, it } from 'vitest';

import {
    buildFeedFavoriteIdSet,
    canRequestInviteFromFeedFriend,
    getFeedRowId,
    isUserIdLike,
    normalizeFeedId,
    parseDateInput,
    resolveDisplayNameCandidate,
    resolveFeedCurrentInviteLocation,
    resolveFeedLocationForDisplay,
    resolveFeedFriendStateBucket,
    resolveFeedStatusMeta,
    resolveFeedUserDisplayName,
    resolveFeedUserId,
    toDateInputValue,
    UNKNOWN_FEED_USER_DISPLAY_NAME
} from './feedRows';

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
        expect(
            resolveFeedUserDisplayName(
                { userId: USER_ID, displayName: USER_ID },
                { displayName: 'Friend Name' },
                'Cached Name'
            )
        ).toBe('Friend Name');
        expect(resolveFeedUserDisplayName({ userId: USER_ID }, null, '')).toBe(
            UNKNOWN_FEED_USER_DISPLAY_NAME
        );
        expect(getFeedRowId({ rowId: 1, type: 'GPS', userId: USER_ID })).toBe(
            'row:GPS:1'
        );
        expect(getFeedRowId({ row_id: 1, type: 'GPS', sourceRank: 60 })).toBe(
            'row:GPS:60:1'
        );
        expect(
            getFeedRowId({ row_id: 1, type: 'Status', sourceRank: 40 })
        ).toBe('row:Status:40:1');
    });

    it('resolves friend state and current invite location from visible session data', () => {
        expect(
            resolveFeedFriendStateBucket(
                { id: USER_ID, state: 'offline:offline' },
                {}
            )
        ).toBe('offline');
        expect(
            resolveFeedFriendStateBucket(
                { id: USER_ID },
                { onlineFriends: [USER_ID] }
            )
        ).toBe('online');
        expect(
            canRequestInviteFromFeedFriend(
                { id: USER_ID },
                { onlineFriends: [USER_ID] }
            )
        ).toBe(true);
        expect(
            resolveFeedCurrentInviteLocation(
                {
                    currentLocation: 'traveling',
                    currentDestination: 'wrld_dest:123'
                },
                { location: 'wrld_profile:456' }
            )
        ).toBe('wrld_dest:123');
        expect(
            resolveFeedCurrentInviteLocation(
                {},
                { $locationTag: 'wrld_profile:456' }
            )
        ).toBe('wrld_profile:456');
    });

    it('hides stale offline locations only for online feed display rows', () => {
        expect(
            resolveFeedLocationForDisplay({
                type: 'Online',
                location: 'offline'
            })
        ).toBe('');
        expect(
            resolveFeedLocationForDisplay({
                type: 'Online',
                location: 'offline:offline'
            })
        ).toBe('');
        expect(
            resolveFeedLocationForDisplay({
                type: 'Offline',
                location: 'offline'
            })
        ).toBe('offline');
        expect(
            resolveFeedLocationForDisplay({
                type: 'Online',
                location: 'private'
            })
        ).toBe('private');
    });

    it('builds favorite friend ids from selected remote groups and local favorites', () => {
        const ids = buildFeedFavoriteIdSet(
            {
                fav_1: {
                    type: 'friend',
                    favoriteId: USER_ID,
                    $groupKey: 'group_a'
                },
                fav_2: {
                    type: 'friend',
                    favoriteId: 'usr_other',
                    $groupKey: 'group_b'
                },
                fav_3: {
                    type: 'world',
                    favoriteId: 'wrld_1',
                    $groupKey: 'group_a'
                }
            },
            {
                Local: [' usr_local ', '']
            },
            ['group_a']
        );

        expect([...ids]).toEqual([USER_ID, 'usr_local']);
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
