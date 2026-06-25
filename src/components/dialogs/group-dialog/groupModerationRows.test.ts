import { describe, expect, it } from 'vitest';

import {
    getGroupModerationActions,
    getGroupModerationTabs,
    moderationRowDate,
    moderationRowLabel,
    moderationRowRoles,
    moderationRowSearchText,
    moderationRowStatus,
    moderationRowSubtitle,
    moderationRowUserId
} from './groupModerationRows';

const t = (key: string) => key;

describe('groupModerationRows', () => {
    const group = {
        roles: [
            { id: 'grol_member', name: 'Member' },
            { id: 'grol_mod', name: 'Moderator' }
        ]
    };

    it('builds moderation tab metadata from locale keys', () => {
        expect(getGroupModerationTabs(t).map((tab: any) => tab.value)).toEqual([
            'members',
            'bans',
            'invites',
            'requests',
            'blocked',
            'logs'
        ]);
    });

    it('resolves user-facing row fields from nested and fallback moderation data', () => {
        const row = {
            user: {
                id: 'usr_nested',
                displayName: 'Nested User',
                roleIds: ['grol_member', 'grol_missing']
            },
            userId: 'usr_direct',
            action: 'ban',
            createdAt: '2026-06-22T10:00:00Z',
            note: 'Repeated reports'
        };

        expect(moderationRowUserId(row)).toBe('usr_direct');
        expect(moderationRowLabel(row)).toBe('Nested User');
        expect(moderationRowRoles(row, group)).toBe('Member, Role');
        expect(moderationRowStatus(row)).toBe('ban');
        expect(moderationRowDate(row)).toBe('2026-06-22T10:00:00Z');
        expect(moderationRowSubtitle(row)).toBe('ban | 2026-06-22T10:00:00Z');
        expect(moderationRowSearchText(row, group)).toBe(
            'nested user usr_direct member, role ban 2026-06-22t10:00:00z repeated reports'
        );
        expect(moderationRowLabel(null)).toBe('—');
    });

    it('returns tab-specific actions only when a row resolves to a user id', () => {
        expect(
            getGroupModerationActions('members', { userId: 'usr_1' }, t)
        ).toEqual([
            {
                key: 'kick',
                label: 'dialog.group_member_moderation.kick',
                destructive: true
            },
            {
                key: 'ban',
                label: 'dialog.group_member_moderation.ban',
                destructive: true
            }
        ]);
        expect(
            getGroupModerationActions('requests', { targetUserId: 'usr_2' }, t)
        ).toEqual([
            {
                key: 'accept-request',
                label: 'dialog.group_member_moderation.accept'
            },
            {
                key: 'reject-request',
                label: 'dialog.group_member_moderation.reject',
                destructive: true
            },
            {
                key: 'block-request',
                label: 'dialog.group_member_moderation.block',
                destructive: true
            }
        ]);
        expect(
            getGroupModerationActions('logs', { userId: 'usr_3' }, t)
        ).toEqual([]);
        expect(getGroupModerationActions('members', {}, t)).toEqual([]);
    });
});
