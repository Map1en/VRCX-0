// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from '../notificationPageTypes';
import { NotificationGroupSummary } from './NotificationGroupSummary';

vi.mock('../useNotificationActorImage', () => ({
    useNotificationActorImage: () => ''
}));

afterEach(cleanup);

function inviteResponse(id: string, senderUserId: string): NotificationRow {
    return {
        id,
        type: 'inviteResponse',
        version: 1,
        senderUserId,
        senderUsername: senderUserId,
        seen: true,
        createdAt: '2026-10-29T10:00:00.000Z',
        groupKey: 'inviteResponse:*:2026-10-29'
    };
}

describe('NotificationGroupSummary', () => {
    it('caps stacked avatars and names the group by its first sender', () => {
        const { container } = render(
            <NotificationGroupSummary
                variant="page"
                rows={['usr_a', 'usr_b', 'usr_c', 'usr_d', 'usr_a'].map(
                    (sender, index) => inviteResponse(`not_${index}`, sender)
                )}
                expanded={false}
                onToggle={vi.fn()}
            />
        );

        expect(
            screen.getByText('view.notification.feed.group.from_people')
        ).toBeTruthy();
        expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(
            3
        );
    });

    it('uses the single-source title when every row shares one sender', () => {
        render(
            <NotificationGroupSummary
                variant="drawer"
                rows={[
                    inviteResponse('not_1', 'usr_a'),
                    inviteResponse('not_2', 'usr_a')
                ]}
                expanded
                onToggle={vi.fn()}
            />
        );

        expect(
            screen.getByText('view.notification.feed.group.from_actor')
        ).toBeTruthy();
        expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    });
});
