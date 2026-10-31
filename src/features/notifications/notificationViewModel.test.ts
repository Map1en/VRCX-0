import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';

import {
    toNotificationViewModel,
    type NotificationViewModelOptions
} from './notificationViewModel';

const identityT = ((key: string) => key) as unknown as TFunction;

function viewModel(
    notification: NotificationRow,
    options: Partial<NotificationViewModelOptions> = {}
) {
    return toNotificationViewModel(notification, { t: identityT, ...options });
}

function row(overrides: Record<string, unknown>): NotificationRow {
    return {
        id: 'not_1',
        version: 2,
        seen: true,
        created_at: '2026-01-01T00:00:00Z',
        details: {},
        data: {},
        responses: [],
        ...overrides
    } as NotificationRow;
}

describe('notification view model', () => {
    it('maps group announcements to the broadcast template without the group name prefix', () => {
        const view = viewModel(
            row({
                type: 'group.announcement',
                title: 'Maple Club: Weekly meetup',
                message: 'We meet on Friday at 21:00 JST.',
                imageUrl: 'file_abc',
                link: 'group:grp_1',
                linkText: 'Go to Maple Club',
                data: {
                    groupId: 'grp_1',
                    groupName: 'Maple Club',
                    announcementTitle: 'Weekly meetup'
                }
            })
        );

        expect(view.template).toBe('broadcast');
        expect(view.actor).toEqual({
            kind: 'group',
            id: 'grp_1',
            name: 'Maple Club',
            imageUrl: expect.stringContaining('file_abc')
        });
        expect(view.headline).toBe('Weekly meetup');
        expect(view.headline).not.toContain('Maple Club');
        expect(view.body).toBe('We meet on Friday at 21:00 JST.');
        expect(view.media).toBe('');
        expect(view.link).toBeNull();
    });

    it('falls back to owner fields for group event notifications', () => {
        const view = viewModel(
            row({
                type: 'group.event.created',
                message: 'A new event was scheduled.',
                imageUrl: 'file_banner',
                data: {
                    ownerId: 'grp_2',
                    ownerName: 'Oak Club',
                    title: 'Movie night'
                }
            })
        );

        expect(view.template).toBe('broadcast');
        expect(view.actor).toEqual({
            kind: 'group',
            id: 'grp_2',
            name: 'Oak Club',
            imageUrl: ''
        });
        expect(view.media).toBe('file_banner');
        expect(view.headline).toBe('Movie night');
    });

    it('resolves the group actor from an event response link', () => {
        const view = viewModel(
            row({
                type: 'event.announcement',
                senderUserId: 'usr_system',
                senderUsername: 'System',
                responses: [
                    {
                        type: 'link',
                        text: 'View event',
                        data: 'event:grp_3,event_4'
                    }
                ]
            })
        );

        expect(view.actor).toMatchObject({
            kind: 'group',
            id: 'grp_3'
        });
    });

    it('treats default_ images as missing media', () => {
        const view = viewModel(
            row({
                type: 'group.announcement',
                imageUrl: 'default_group.png',
                data: { groupId: 'grp_1', groupName: 'Maple Club' }
            })
        );

        expect(view.media).toBe('');
        expect(view.actor).toMatchObject({ imageUrl: '' });
    });

    it('never falls back to the sender user icon for group notifications', () => {
        const view = viewModel(
            row({
                type: 'group.event.created',
                senderUserId: 'usr_me',
                senderUserIcon: 'file_my_avatar',
                data: { ownerId: 'grp_2', ownerName: 'Oak Club' }
            })
        );

        expect(view.media).toBe('');
    });

    it('maps invites to the compact template with world context', () => {
        const view = viewModel(
            row({
                type: 'invite',
                senderUserId: 'usr_1',
                senderUsername: 'Maple',
                senderDisplayName: 'Maple Nagisa',
                message: '',
                details: {
                    worldId: 'wrld_1:42',
                    worldName: 'Test World',
                    inviteMessage: 'Come hang out'
                }
            })
        );

        expect(view.template).toBe('compact');
        expect(view.actor).toEqual({
            kind: 'user',
            id: 'usr_1',
            name: 'Maple Nagisa',
            imageUrl: ''
        });
        expect(view.headline).toBe('');
        expect(view.body).toBe('Come hang out');
        expect(view.context).toEqual({
            location: 'wrld_1:42',
            worldName: 'Test World',
            groupName: ''
        });
    });

    it('leaves the context empty when an invite carries no location', () => {
        const view = viewModel(
            row({
                type: 'requestInvite',
                senderUserId: 'usr_2',
                senderUsername: 'Oak'
            })
        );

        expect(view.template).toBe('compact');
        expect(view.context).toBeNull();
        expect(view.body).toBe('');
    });

    it('renders app notification bodies from their message key in the current language', () => {
        const t = ((key: string, params?: Record<string, unknown>) =>
            `${key}:${JSON.stringify(params)}`) as unknown as TFunction;
        const appNotification = row({
            type: 'groupChange',
            senderUserId: 'grp_3',
            senderUsername: 'Birch Club',
            message: '',
            details: {
                messageKey: 'notifications.group_member_roles',
                messageParams: { roles: 'Staff' }
            }
        });

        expect(viewModel(appNotification, { t }).body).toBe(
            'notifications.group_member_roles:{"roles":"Staff"}'
        );
        expect(
            viewModel(
                row({
                    type: 'groupChange',
                    senderUserId: 'grp_3',
                    message: 'Role Staff added'
                }),
                { t }
            ).body
        ).toBe('Role Staff added');
    });

    it('maps group changes and moderation notices to a group actor', () => {
        const groupChange = viewModel(
            row({
                type: 'groupChange',
                senderUserId: 'grp_3',
                senderUsername: 'Birch Club',
                message: 'Group settings changed.'
            })
        );
        const moderation = viewModel(
            row({
                type: 'moderation.warning.group',
                message: 'Please review the rules.',
                data: { groupId: 'grp_4', groupName: 'Cedar Club' }
            })
        );

        expect(groupChange.template).toBe('compact');
        expect(groupChange.actor.kind).toBe('group');
        expect(groupChange.actor.name).toBe('Birch Club');
        expect(moderation.actor).toMatchObject({
            kind: 'group',
            id: 'grp_4',
            name: 'Cedar Club'
        });
    });

    it('keeps the boop actor avatar separate from the default emoji preview', () => {
        const view = viewModel(
            row({
                type: 'boop',
                senderUserId: 'usr_3',
                senderUsername: 'Pine',
                senderUserIcon: 'file_avatar',
                message: 'Boop! in_love',
                imageUrl: 'default_in_love',
                details: { emojiId: 'default_in_love' }
            })
        );

        expect(view.template).toBe('compact');
        expect(view.actor).toMatchObject({
            kind: 'user',
            name: 'Pine',
            imageUrl: expect.stringContaining('file_avatar')
        });
        expect(view.body).toBe('Boop!');
        expect(view.emoji).toEqual({
            id: 'default_in_love',
            imageUrl: 'https://wiki-files.vrchat.com/Inlove.webp',
            kind: 'default',
            name: 'In Love'
        });
    });

    it('maps custom boop files to media without using them as the actor avatar', () => {
        const view = viewModel(
            row({
                type: 'boop',
                senderUserId: 'usr_3',
                senderUsername: 'Pine',
                message: 'Boop!',
                imageUrl: 'https://api.vrchat.cloud/api/1/file/emoji/1',
                details: { emojiId: 'file_emoji' }
            })
        );

        expect(view.actor).toMatchObject({ kind: 'user', imageUrl: '' });
        expect(view.emoji).toMatchObject({
            id: 'file_emoji',
            imageUrl: expect.stringContaining('/file/emoji/1'),
            kind: 'custom'
        });
    });

    it('exposes inventory boops for a sender-scoped item lookup instead of trusting the row image', () => {
        const view = viewModel(
            row({
                type: 'boop',
                senderUserId: 'usr_3',
                senderUsername: 'Pine',
                message: 'Boop!',
                imageUrl: 'https://api.vrchat.cloud/api/1/file/avatar/1',
                details: { inventoryItemId: 'inv_miku' }
            })
        );

        expect(view.body).toBe('Boop!');
        expect(view.emoji).toEqual({
            id: 'inv_miku',
            imageUrl: '',
            kind: 'inventory',
            name: '',
            senderUserId: 'usr_3'
        });
    });

    it('renders a starting group event like a created one, with its banner', () => {
        const view = viewModel(
            row({
                type: 'group.event.starting',
                message: 'Starts in 15 minutes.',
                imageUrl: 'file_banner',
                data: {
                    ownerId: 'grp_2',
                    ownerName: 'Oak Club',
                    title: 'Movie night'
                }
            })
        );

        expect(view.template).toBe('broadcast');
        expect(view.typeLabelKey).toBe(
            'view.notification.filters.group.event.starting'
        );
        expect(view.media).toBe('file_banner');
        expect(view.headline).toBe('Movie night');
    });

    it('renders newer VRChat notification types with their own labels instead of the fallback', () => {
        const kick = viewModel(
            row({ type: 'votetokick', title: 'Vote to kick', message: 'X' })
        );
        const gated = viewModel(
            row({
                type: 'invite.instance.contentGated',
                senderUserId: 'usr_friend',
                senderUsername: 'Friend',
                message: 'Join me'
            })
        );

        expect(kick.template).toBe('compact');
        expect(kick.typeLabelKey).toBe('view.notification.filters.votetokick');
        expect(gated.template).toBe('compact');
        expect(gated.body).toBe('Join me');
        expect(gated.typeLabelKey).toBe(
            'view.notification.filters.inviteInstanceContentGated'
        );
    });

    it('falls back to a system actor for empty or unknown types', () => {
        const empty = viewModel(row({ type: '', message: '', title: '' }), {
            unknownLabel: 'Unknown notification'
        });
        const unknown = viewModel(
            row({ type: 'totally.new.type', message: 'Something happened' }),
            { unknownLabel: 'Unknown notification' }
        );

        expect(empty.template).toBe('fallback');
        expect(empty.actor).toEqual({
            kind: 'system',
            name: 'Unknown notification'
        });
        expect(empty.createdAt).toBe('2026-01-01T00:00:00Z');
        expect(unknown.template).toBe('fallback');
        expect(unknown.body).toBe('Something happened');
    });

    it('derives unseen and expired flags from the shared seen rules', () => {
        const unseen = viewModel(row({ type: 'invite', seen: false }));
        const expired = viewModel(
            row({ type: 'invite', seen: false, expired: true })
        );
        const legacySeen = viewModel(
            row({ type: 'group.announcement', version: 1, seen: false })
        );

        expect(unseen.unseen).toBe(true);
        expect(expired.unseen).toBe(false);
        expect(expired.expired).toBe(true);
        expect(legacySeen.unseen).toBe(false);
    });
});
