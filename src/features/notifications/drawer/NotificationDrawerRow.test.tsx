// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';

import { openSender } from '../notificationCenterUtils';
import type { NotificationDrawerHandlers } from './NotificationDrawerList';
import { NotificationDrawerRow } from './NotificationDrawerRow';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

vi.mock('../useNotificationActorImage', () => ({
    useNotificationActorImage: () => ''
}));

vi.mock('../notificationCenterUtils', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../notificationCenterUtils')>();
    return { ...actual, openSender: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function renderNotification(notification: NotificationRow, isUnseen = true) {
    const handlers: NotificationDrawerHandlers = {
        onAcceptFriendRequest: vi.fn(),
        onAcceptRequestInvite: vi.fn(),
        onDeleteNotification: vi.fn(),
        onHideNotification: vi.fn(),
        onJoinQueueReady: vi.fn(),
        onMarkSeen: vi.fn(),
        onSendInviteResponseWithMessage: vi.fn(),
        onSendNotificationResponse: vi.fn()
    };
    render(
        <NotificationDrawerRow
            notification={notification}
            isUnseen={isUnseen}
            canInviteFromCurrentLocation={false}
            currentUserId="usr_me"
            handlers={handlers}
        />
    );
    return handlers;
}

describe('NotificationDrawerRow', () => {
    it('separates the announcement source, headline and body while preserving source navigation', () => {
        const notification: NotificationRow = {
            id: 'not_announcement',
            type: 'group.announcement',
            title: 'Maple Club: Weekly meetup',
            message: 'We meet on Friday at 21:00 JST.',
            data: {
                groupId: 'grp_maple',
                groupName: 'Maple Club',
                announcementTitle: 'Weekly meetup'
            }
        };
        renderNotification(notification);

        expect(screen.getAllByText('Weekly meetup')).toHaveLength(1);
        expect(screen.getAllByText(notification.message ?? '')).toHaveLength(1);
        expect(screen.queryByText(notification.title ?? '')).toBeNull();
        expect(screen.getByText('view.notification.feed.unread')).toBeTruthy();
        fireEvent.click(screen.getByText('Maple Club'));
        expect(openSender).toHaveBeenCalledWith(
            notification,
            expect.any(Function)
        );
    });

    it('keeps the original title when structured announcement data is absent', () => {
        renderNotification({
            id: 'not_partial',
            type: 'group.announcement',
            title: 'An announcement with limited metadata',
            message: 'The original body'
        });

        expect(
            screen.getByText('An announcement with limited metadata')
        ).toBeTruthy();
        expect(screen.getByText('The original body')).toBeTruthy();
        expect(
            screen.getByText('view.notification.feed.unknown_sender')
        ).toBeTruthy();
    });

    it('shows identical announcement headline and body only once', () => {
        renderNotification(
            {
                id: 'not_duplicate',
                type: 'group.announcement',
                title: 'Maple Club: Meetup starts now',
                message: 'Meetup starts now',
                data: {
                    groupName: 'Maple Club',
                    announcementTitle: 'Meetup starts now'
                }
            },
            false
        );

        expect(screen.getAllByText('Meetup starts now')).toHaveLength(1);
        expect(screen.queryByText('view.notification.feed.unread')).toBeNull();
    });

    it('keeps friend request accept and mark-read actions available', () => {
        const notification: NotificationRow = {
            id: 'not_friend',
            type: 'friendRequest',
            senderUserId: 'usr_friend',
            senderUsername: 'Maple',
            seen: false,
            version: 1
        };
        const handlers = renderNotification(notification);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.notification.actions.accept'
            })
        );
        expect(handlers.onAcceptFriendRequest).toHaveBeenCalledWith(
            notification
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.notification.action.mark_seen'
            })
        );
        expect(handlers.onMarkSeen).toHaveBeenCalledWith(notification);
    });

    it('marks an announcement read from its relocated menu', async () => {
        const notification: NotificationRow = {
            id: 'not_menu',
            type: 'group.announcement',
            title: 'Weekly meetup',
            seen: false
        };
        const handlers = renderNotification(notification);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'side_panel.notification_center.more_actions'
            })
        );
        fireEvent.click(
            await screen.findByRole('menuitem', {
                name: 'side_panel.notification_center.mark_as_read'
            })
        );
        expect(handlers.onMarkSeen).toHaveBeenCalledWith(notification);
    });

    it('hides a message that only restates the notification type', () => {
        renderNotification({
            id: 'not_instance_closed',
            type: 'instance.closed',
            message: 'view.notification.filters.instance.closed',
            seen: false
        });

        expect(
            screen.getAllByText('view.notification.filters.instance.closed')
        ).toHaveLength(1);
    });

    it('drops mark as read when the notification offers a dismiss response', async () => {
        const notification: NotificationRow = {
            id: 'not_dismissable',
            type: 'group.announcement',
            title: 'Weekly meetup',
            responses: [{ type: 'delete', icon: 'check', text: 'Dismiss' }],
            seen: false
        };
        renderNotification(notification);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'side_panel.notification_center.more_actions'
            })
        );
        expect(
            await screen.findByRole('menuitem', {
                name: 'view.notification.actions.delete_log'
            })
        ).toBeTruthy();
        expect(
            screen.queryByRole('menuitem', {
                name: 'side_panel.notification_center.mark_as_read'
            })
        ).toBeNull();
    });

    it.each(['group.announcement', 'group.event.created'])(
        'renders %s response actions as inline buttons',
        (type) => {
            const response = {
                type: 'link',
                text: 'View group',
                data: 'group:grp_maple'
            };
            const notification: NotificationRow = {
                id: 'not_broadcast',
                type,
                title: 'Weekly meetup',
                responses: [response],
                seen: true
            };
            const handlers = renderNotification(notification, false);

            fireEvent.click(screen.getByRole('button', { name: 'View group' }));
            expect(handlers.onSendNotificationResponse).toHaveBeenCalledWith(
                notification,
                response
            );
        }
    );
});
