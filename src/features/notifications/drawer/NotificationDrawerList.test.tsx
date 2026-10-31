// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import type { NotificationCategories } from '@/state/vrcNotificationStore';

import { NotificationDrawerList } from './NotificationDrawerList';

vi.mock('../useNotificationActorImage', () => ({
    useNotificationActorImage: () => ''
}));

afterEach(cleanup);

function handlers() {
    return {
        onAcceptFriendRequest: vi.fn(),
        onAcceptRequestInvite: vi.fn(),
        onDeleteNotification: vi.fn(),
        onHideNotification: vi.fn(),
        onIgnoreNotificationLocally: vi.fn(),
        onJoinQueueReady: vi.fn(),
        onMarkSeen: vi.fn(),
        onSendInviteResponseWithMessage: vi.fn(),
        onSendNotificationResponse: vi.fn()
    };
}

const RESPONSE_KEY = 'inviteResponse:*';

function activity(
    id: string,
    minute: number,
    type = 'inviteResponse',
    groupKey = RESPONSE_KEY
): NotificationRow {
    return {
        id,
        type,
        version: 1,
        senderUserId: 'usr_alice',
        senderUsername: 'Alice',
        message: `reply ${id}`,
        seen: false,
        createdAt: `2026-10-29T10:${String(minute).padStart(2, '0')}:00.000Z`,
        groupKey
    };
}

function renderDrawer(
    unseen: NotificationRow[],
    recent: NotificationRow[] = []
) {
    const categories: NotificationCategories = {
        friend: { unseen, recent },
        group: { unseen: [], recent: [] },
        other: { unseen: [], recent: [] }
    };
    render(
        <NotificationDrawerList
            categories={categories}
            canInviteFromCurrentLocation={false}
            handlers={handlers()}
            onNavigateToTable={vi.fn()}
        />
    );
}

describe('NotificationDrawerList', () => {
    it('shows the full notification history link when the drawer is empty', () => {
        const categories: NotificationCategories = {
            friend: { unseen: [], recent: [] },
            group: { unseen: [], recent: [] },
            other: { unseen: [], recent: [] }
        };
        const onNavigateToTable = vi.fn();

        render(
            <NotificationDrawerList
                categories={categories}
                canInviteFromCurrentLocation={false}
                handlers={{
                    onAcceptFriendRequest: vi.fn(),
                    onAcceptRequestInvite: vi.fn(),
                    onDeleteNotification: vi.fn(),
                    onHideNotification: vi.fn(),
                    onIgnoreNotificationLocally: vi.fn(),
                    onJoinQueueReady: vi.fn(),
                    onMarkSeen: vi.fn(),
                    onSendInviteResponseWithMessage: vi.fn(),
                    onSendNotificationResponse: vi.fn()
                }}
                onNavigateToTable={onNavigateToTable}
            />
        );

        expect(
            screen.getByText(
                'side_panel.notification_center.no_new_notifications'
            )
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'side_panel.notification_center.view_more'
            })
        );
        expect(onNavigateToTable).toHaveBeenCalledTimes(1);
    });

    it('folds adjacent grouped rows into one expandable summary without changing bucket counts', () => {
        renderDrawer([activity('not_reply_1', 3), activity('not_reply_2', 2)]);

        expect(screen.getByText('(2)')).toBeTruthy();
        expect(
            screen.getByText('view.notification.feed.group.from_actor')
        ).toBeTruthy();
        expect(screen.queryByText('reply not_reply_1')).toBeNull();

        const summary = screen.getByRole('button', { expanded: false });
        fireEvent.click(summary);

        expect(summary.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('reply not_reply_1')).toBeTruthy();
        expect(screen.getByText('reply not_reply_2')).toBeTruthy();
        expect(screen.getByText('(2)')).toBeTruthy();

        fireEvent.click(summary);
        expect(screen.queryByText('reply not_reply_1')).toBeNull();
    });

    it('gathers unseen rows of the same group key across other rows', () => {
        renderDrawer([
            activity('not_reply_1', 5),
            activity('not_message', 4, 'message', ''),
            activity('not_reply_2', 3)
        ]);

        const [summary] = screen.getAllByRole('button', { expanded: false });
        expect(screen.getByText('reply not_message')).toBeTruthy();
        expect(screen.queryByText('reply not_reply_2')).toBeNull();

        fireEvent.click(summary);
        expect(screen.getByText('reply not_reply_1')).toBeTruthy();
        expect(screen.getByText('reply not_reply_2')).toBeTruthy();
    });

    it('expands separated runs of seen rows with the same group key independently', () => {
        renderDrawer(
            [],
            [
                activity('not_reply_1', 5),
                activity('not_reply_2', 4),
                activity('not_message', 3, 'message', ''),
                activity('not_reply_3', 2),
                activity('not_reply_4', 1)
            ]
        );

        expect(screen.getByText('(5)')).toBeTruthy();
        const [first, second] = screen.getAllByRole('button', {
            expanded: false
        });
        fireEvent.click(first);

        expect(first.getAttribute('aria-expanded')).toBe('true');
        expect(second.getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByText('reply not_reply_1')).toBeTruthy();
        expect(screen.queryByText('reply not_reply_3')).toBeNull();
    });
});
