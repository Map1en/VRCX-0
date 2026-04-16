import { describe, expect, it } from 'vitest';

import {
    buildCachedInstanceMap,
    canDeclineNotification,
    filterNotificationRows,
    getCachedInstanceLocation,
    getFileImageUrl,
    getInviteCooldownLabel,
    getNotificationCreatedAt,
    getNotificationGroupColumnLabel,
    getNotificationGroupLabel,
    getNotificationMessage,
    getResponseLabel,
    matchesNotificationSearch,
    normalizeInviteMessageRows,
    normalizeWorldTarget,
    resolveCurrentInviteLocation
} from './notificationRows.js';

describe('notification row helpers', () => {
    it('builds readable notification date, message, and group labels', () => {
        const notification = {
            created_at: '2026-01-01T00:00:00Z',
            title: 'Invite',
            message: 'This is a generated invite to Test World',
            details: {
                worldName: 'Test World',
                inviteMessage: 'Join me',
                groupName: 'Group From Details'
            },
            data: {
                groupName: 'Group From Data'
            }
        };

        expect(getNotificationCreatedAt(notification)).toBe('2026-01-01T00:00:00Z');
        expect(getNotificationMessage(notification)).toBe('Invite, Join me');
        expect(getNotificationGroupLabel(notification)).toBe('Group From Data');
    });

    it('uses sender group names for group-style notification columns', () => {
        expect(
            getNotificationGroupColumnLabel({
                senderUserId: 'grp_123',
                senderUsername: 'Group Sender',
                details: { groupName: 'Details Group' }
            })
        ).toBe('Group Sender');
        expect(
            getNotificationGroupColumnLabel({
                link: 'group:grp_123',
                linkText: 'Linked Group'
            })
        ).toBe('Linked Group');
    });

    it('filters notifications by type and user search text', () => {
        const rows = [
            { type: 'invite', senderUsername: 'Maple', message: 'Join me' },
            { type: 'message', senderUsername: 'Oak', message: 'Hello' },
            { type: 'boop', senderUsername: 'Birch', message: 'Boop' }
        ];

        expect(matchesNotificationSearch(rows[0], 'join')).toBe(true);
        expect(filterNotificationRows(rows, ['invite', 'message'], 'oak')).toEqual([rows[1]]);
        expect(filterNotificationRows(rows, [], '')).toEqual(rows);
    });

    it('normalizes world targets and current invite location fallbacks', () => {
        expect(normalizeWorldTarget('wrld_123:456~private')).toBe('wrld_123');
        expect(normalizeWorldTarget('wrld_123')).toBe('wrld_123');
        expect(
            resolveCurrentInviteLocation(
                { currentLocation: 'traveling', currentDestination: 'wrld_dest:1' },
                { location: 'wrld_profile:2' }
            )
        ).toBe('wrld_dest:1');
        expect(resolveCurrentInviteLocation({}, { $locationTag: 'wrld_profile:2' })).toBe('wrld_profile:2');
    });

    it('keeps remote decline actions only for actionable notifications', () => {
        expect(canDeclineNotification({ type: 'invite', link: '' })).toBe(true);
        expect(canDeclineNotification({ type: 'message', link: '' })).toBe(false);
        expect(canDeclineNotification({ type: 'group.announcement', link: '' })).toBe(false);
        expect(canDeclineNotification({ type: 'invite', link: 'economy.alert' })).toBe(false);
    });

    it('normalizes response labels, emoji images, cached instances, and invite messages', () => {
        expect(getResponseLabel({ text: 'Accept', type: 'accept' })).toBe('Accept');
        expect(getResponseLabel({ type: 'accept' })).toBe('accept');
        expect(getResponseLabel(null)).toBe('Respond');
        expect(getFileImageUrl({ versions: [{ file: { url: 'https://example.test/old.png' } }, { file: { url: 'https://example.test/new.png' } }] })).toBe('https://example.test/new.png');
        expect(getCachedInstanceLocation({ instance: { location: 'wrld_123:456' } })).toBe('wrld_123:456');

        const cached = buildCachedInstanceMap([
            { instance: { location: 'wrld_123:456', name: 'Cached' } },
            { instanceId: 'wrld_789:000', name: 'Fallback' }
        ]);
        expect(cached.get('wrld_123:456')).toEqual({ location: 'wrld_123:456', name: 'Cached' });
        expect(cached.get('wrld_789:000')).toEqual({ instanceId: 'wrld_789:000', name: 'Fallback' });

        expect(
            normalizeInviteMessageRows({
                messages: [
                    { slot: '2', text: 'Second' },
                    { slot: '1', message: 'First' },
                    { slot: 'bad', message: 'Ignored' }
                ]
            }, 'response')
        ).toEqual([
            { slot: 1, message: 'First', messageType: 'response' },
            { slot: 2, text: 'Second', message: 'Second', messageType: 'response' }
        ]);
    });

    it('shows invite cooldown labels from the remaining lockout time', () => {
        const nowMs = new Date('2026-01-01T12:30:00Z').getTime();

        expect(getInviteCooldownLabel('2026-01-01T12:00:00Z', nowMs)).toBe('30m');
        expect(getInviteCooldownLabel('2026-01-01T11:00:00Z', nowMs)).toBe('');
        expect(getInviteCooldownLabel('not a date', nowMs)).toBe('not a date');
    });
});
