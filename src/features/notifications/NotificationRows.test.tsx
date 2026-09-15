// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow as NotificationRecord } from '@/repositories/notificationPersistenceRepository';

import {
    NotificationRow,
    type NotificationFeedHandlers
} from './components/NotificationRow';
import type { NotificationDrawerHandlers } from './drawer/NotificationDrawerList';
import { NotificationDrawerRow } from './drawer/NotificationDrawerRow';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

vi.mock('./useNotificationActorImage', () => ({
    useNotificationActorImage: () => ''
}));

afterEach(cleanup);

function friendRequest(): NotificationRecord {
    return {
        id: 'notif_friend_request',
        type: 'friendRequest',
        version: 1,
        senderUserId: 'usr_sender',
        senderUsername: 'Sender',
        seen: false,
        created_at: '2026-08-05T00:00:00.000Z',
        responses: []
    };
}

function boop(): NotificationRecord {
    return {
        id: 'notif_boop',
        type: 'boop',
        version: 1,
        senderUserId: 'usr_sender',
        senderUsername: 'Sender',
        seen: false,
        created_at: '2026-08-05T00:00:00.000Z',
        responses: []
    };
}

function invite(): NotificationRecord {
    return {
        id: 'notif_invite',
        type: 'invite',
        version: 1,
        senderUserId: 'usr_sender',
        senderUsername: 'Sender',
        seen: false,
        created_at: '2026-08-05T00:00:00.000Z',
        responses: []
    };
}

function actionHandlers() {
    return {
        onAcceptFriendRequest: vi.fn(),
        onAcceptRequestInvite: vi.fn(),
        onHideNotification: vi.fn(),
        onMarkSeen: vi.fn(),
        onSendInviteResponseWithMessage: vi.fn(),
        onSendNotificationResponse: vi.fn()
    };
}

describe('friend request notification rows', () => {
    it('renders mark seen as the third action in the notification page row', () => {
        const handlers: NotificationFeedHandlers = {
            ...actionHandlers(),
            onDeleteNotification: vi.fn(),
            onOpenImagePreview: vi.fn(),
            onOpenLink: vi.fn()
        };

        render(
            <NotificationRow
                notification={friendRequest()}
                currentUserId="usr_self"
                canInviteFromCurrentLocation={false}
                handlers={handlers}
            />
        );

        const actionButtons = screen
            .getAllByRole('button')
            .filter((button) =>
                [
                    'view.notification.actions.accept',
                    'view.notification.actions.decline',
                    'view.notification.action.mark_seen'
                ].includes(button.textContent || '')
            );
        expect(actionButtons.map((button) => button.textContent)).toEqual([
            'view.notification.actions.accept',
            'view.notification.actions.decline',
            'view.notification.action.mark_seen'
        ]);

        fireEvent.click(actionButtons[2]);
        expect(handlers.onMarkSeen).toHaveBeenCalledTimes(1);
    });

    it('renders mark seen as the third action in the notification drawer row', () => {
        const handlers: NotificationDrawerHandlers = {
            ...actionHandlers(),
            onDeleteNotification: vi.fn(),
            onJoinQueueReady: vi.fn()
        };

        render(
            <NotificationDrawerRow
                notification={friendRequest()}
                isUnseen
                currentUserId="usr_self"
                canInviteFromCurrentLocation={false}
                handlers={handlers}
            />
        );

        const actionButtons = screen
            .getAllByRole('button')
            .filter((button) =>
                [
                    'view.notification.actions.accept',
                    'view.notification.actions.decline',
                    'view.notification.action.mark_seen'
                ].includes(button.textContent || '')
            );
        expect(actionButtons.map((button) => button.textContent)).toEqual([
            'view.notification.actions.accept',
            'view.notification.actions.decline',
            'view.notification.action.mark_seen'
        ]);

        fireEvent.click(actionButtons[2]);
        expect(handlers.onMarkSeen).toHaveBeenCalledTimes(1);
    });
});

describe('boop notification rows', () => {
    it('uses a distinct violet badge in the notification drawer', () => {
        const handlers: NotificationDrawerHandlers = {
            ...actionHandlers(),
            onDeleteNotification: vi.fn(),
            onJoinQueueReady: vi.fn()
        };

        render(
            <NotificationDrawerRow
                notification={boop()}
                isUnseen
                currentUserId="usr_self"
                canInviteFromCurrentLocation={false}
                handlers={handlers}
            />
        );

        expect(
            screen.getByText('view.notification.filters.boop').className
        ).toContain('bg-violet-500/15');
    });
});

describe('action notification badge colors', () => {
    it('uses a visible status foreground for invite badges', () => {
        const handlers: NotificationDrawerHandlers = {
            ...actionHandlers(),
            onDeleteNotification: vi.fn(),
            onJoinQueueReady: vi.fn()
        };

        render(
            <NotificationDrawerRow
                notification={invite()}
                isUnseen
                currentUserId="usr_self"
                canInviteFromCurrentLocation={false}
                handlers={handlers}
            />
        );

        expect(
            screen.getByText('view.notification.filters.invite').className
        ).toContain('text-[var(--status-joinme)]');
    });
});
