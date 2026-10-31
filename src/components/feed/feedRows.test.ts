import { describe, expect, it } from 'vitest';

import { onlinePresence, pendingPresence } from '@/test/presenceFixtures';

import {
    buildFeedFavoriteIdSet,
    canExpandFeedRow,
    canRequestInviteFromFeedFriend,
    getFeedRowCreatedAtMs,
    getFeedRowId,
    isUserIdLike,
    normalizeFeedId,
    resolveDisplayNameCandidate,
    resolveFeedLocationForDisplay,
    resolveFeedStatusMeta,
    resolveFeedUserDisplayName,
    resolveFeedUserId,
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
        expect(resolveFeedUserId({ userId: USER_ID })).toBe(USER_ID);
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
            'row:GPS::1'
        );
        expect(getFeedRowId({ rowId: 1, type: 'GPS', sourceRank: 60 })).toBe(
            'row:GPS:60:1'
        );
        expect(getFeedRowId({ rowId: 1, type: 'Status', sourceRank: 40 })).toBe(
            'row:Status:40:1'
        );
        expect(
            getFeedRowId({
                type: 'GPS',
                created_at: '2026-05-15T00:00:00Z',
                userId: USER_ID,
                location: 'wrld_1:instance'
            })
        ).toBe(`GPS:2026-05-15T00:00:00Z:${USER_ID}:wrld_1:instance`);
    });

    it('resolves invite requests from presence and the current invite location', () => {
        expect(
            canRequestInviteFromFeedFriend({
                id: USER_ID,
                $presence: onlinePresence()
            })
        ).toBe(true);
        expect(
            canRequestInviteFromFeedFriend({
                id: USER_ID,
                $presence: pendingPresence()
            })
        ).toBe(false);
        expect(canRequestInviteFromFeedFriend({ id: USER_ID })).toBe(false);
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

    it('counts only the selected local and remote favorite groups', () => {
        const groups = {
            remoteGroupKeys: ['group_a', 'group_b'],
            remoteIdsByGroupKey: {
                group_a: [USER_ID],
                group_b: ['usr_other']
            },
            localGroupNames: ['Local', 'Close'],
            localFriendFavorites: {
                Local: [' usr_local ', ''],
                Close: ['usr_close']
            }
        };

        expect([
            ...buildFeedFavoriteIdSet({
                ...groups,
                selectedGroupKeys: ['group_a', 'local:Close']
            })
        ]).toEqual([USER_ID, 'usr_close']);
        expect([
            ...buildFeedFavoriteIdSet({
                ...groups,
                selectedGroupKeys: ['local:Local']
            })
        ]).toEqual(['usr_local']);
    });

    it('counts every local and remote favorite group when no live group is selected', () => {
        const groups = {
            remoteGroupKeys: ['group_a'],
            remoteIdsByGroupKey: { group_a: [USER_ID] },
            localGroupNames: ['Local'],
            localFriendFavorites: { Local: ['usr_local'] }
        };

        for (const selectedGroupKeys of [[], ['local:Deleted', 'group_gone']]) {
            expect([
                ...buildFeedFavoriteIdSet({ ...groups, selectedGroupKeys })
            ]).toEqual([USER_ID, 'usr_local']);
        }
    });

    it('resolves status display metadata', () => {
        expect(resolveFeedStatusMeta('active')).toEqual({
            label: 'Online',
            className: 'user-status-indicator online bg-[var(--status-online)]'
        });
        expect(resolveFeedStatusMeta('joinme')).toEqual({
            label: 'Join Me',
            className: 'user-status-indicator joinme bg-[var(--status-joinme)]'
        });
        expect(resolveFeedStatusMeta('')).toEqual({
            label: 'Offline',
            className: ''
        });
    });

    it('determines which feed row types can expand based on whether they carry new information', () => {
        expect(canExpandFeedRow({ type: 'GPS', previousLocation: '' })).toBe(
            false
        );
        expect(
            canExpandFeedRow({ type: 'GPS', previousLocation: 'wrld_1:1' })
        ).toBe(true);
        expect(
            canExpandFeedRow({ type: 'Online', previousLocation: 'wrld_1:1' })
        ).toBe(false);
        expect(canExpandFeedRow({ type: 'Offline', time: 0 })).toBe(false);
        expect(canExpandFeedRow({ type: 'Offline', time: 42 })).toBe(false);
        expect(
            canExpandFeedRow({
                type: 'Status',
                statusDescription: 'Busy',
                previousStatusDescription: 'Busy'
            })
        ).toBe(false);
        expect(
            canExpandFeedRow({
                type: 'Status',
                statusDescription: 'Busy',
                previousStatusDescription: 'Ask me'
            })
        ).toBe(true);
        expect(canExpandFeedRow({ type: 'Avatar' })).toBe(false);
        expect(
            canExpandFeedRow({
                type: 'Avatar',
                currentAvatarThumbnailImageUrl: 'https://example.com/a.png'
            })
        ).toBe(true);
        expect(
            canExpandFeedRow({ type: 'Bio', bio: '', previousBio: '' })
        ).toBe(false);
        expect(
            canExpandFeedRow({ type: 'Bio', bio: 'Hello', previousBio: '' })
        ).toBe(true);
        expect(canExpandFeedRow({ type: 'Friend' })).toBe(false);
    });
});

describe('getFeedRowCreatedAtMs', () => {
    it('parses timestamps and caches them per row reference', () => {
        const row = { created_at: '2024-01-02T03:04:05.000Z' };
        const expected = new Date('2024-01-02T03:04:05.000Z').valueOf();

        expect(getFeedRowCreatedAtMs(row)).toBe(expected);

        row.created_at = '2025-06-07T08:09:10.000Z';
        expect(getFeedRowCreatedAtMs(row)).toBe(expected);
        expect(
            getFeedRowCreatedAtMs({ created_at: '2025-06-07T08:09:10.000Z' })
        ).toBe(new Date('2025-06-07T08:09:10.000Z').valueOf());
    });

    it('returns 0 for missing rows and unparsable timestamps', () => {
        expect(getFeedRowCreatedAtMs(null)).toBe(0);
        expect(getFeedRowCreatedAtMs(undefined)).toBe(0);
        expect(getFeedRowCreatedAtMs({ created_at: 'not-a-date' })).toBe(0);
    });
});
