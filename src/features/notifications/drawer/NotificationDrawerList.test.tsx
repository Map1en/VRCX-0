// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationCategories } from '@/state/vrcNotificationStore';

import {
    collectUnseenDrawerEntries,
    NotificationDrawerList,
    type NotificationDrawerHandlers
} from './NotificationDrawerList';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

function emptyCategories(): NotificationCategories {
    return {
        friend: { unseen: [], recent: [] },
        group: { unseen: [], recent: [] },
        other: { unseen: [], recent: [] }
    };
}

describe('notification drawer entries', () => {
    it('keeps notification history out of the unread-only drawer', () => {
        const categories = emptyCategories();
        categories.friend.recent.push({
            id: 'already-read',
            type: 'invite',
            version: 2,
            seen: true
        });
        categories.other.unseen.push({
            id: 'still-unread',
            type: 'message',
            version: 2,
            seen: false
        });

        expect(
            collectUnseenDrawerEntries(categories).map(
                (entry) => entry.notification.id
            )
        ).toEqual(['still-unread']);
    });

    it('describes an empty drawer as having no unread notifications', () => {
        const categories = emptyCategories();
        categories.friend.recent.push({
            id: 'already-read',
            type: 'invite',
            version: 2,
            seen: true
        });

        render(
            <NotificationDrawerList
                categories={categories}
                canInviteFromCurrentLocation={false}
                handlers={{} as NotificationDrawerHandlers}
                onNavigateToTable={() => {}}
            />
        );

        expect(
            screen.getByText(
                'side_panel.notification_center.no_unseen_notifications'
            )
        ).toBeTruthy();
    });
});
