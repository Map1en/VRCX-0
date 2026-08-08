// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en', resolvedLanguage: 'en' },
        t: (key: string) =>
            ({
                'dashboard.friend_status_widget': 'Friend Status',
                'dialog.user.status.join_me': 'Join Me',
                'dialog.user.status.online': 'Online',
                'dialog.user.status.ask_me': 'Ask Me',
                'dialog.user.status.busy': 'Do Not Disturb',
                'view.dashboard.friend_status.total_online_friends':
                    'Online friends',
                'view.dashboard.friend_status.distribution':
                    'Friend status distribution',
                'view.dashboard.friend_status.empty': 'No online friends',
                'view.dashboard.friend_status.empty_description':
                    'The current roster has no online friends.'
            })[key] || key
    })
}));

vi.mock('@/state/shellStore', () => ({
    useShellStore: <T,>(selector: (state: { themeMode: string }) => T) =>
        selector({ themeMode: 'light' })
}));

import { DashboardFriendStatusWidgetView } from './DashboardFriendStatusWidget';

function renderWidget(
    props: Parameters<typeof DashboardFriendStatusWidgetView>[0]
) {
    return renderToStaticMarkup(
        <MemoryRouter>
            <DashboardFriendStatusWidgetView {...props} />
        </MemoryRouter>
    );
}

describe('DashboardFriendStatusWidgetView', () => {
    it('renders all four counts and percentages in a DOM legend', () => {
        const html = renderWidget({
            loadStatus: 'ready',
            onlineIds: ['usr_join', 'usr_online', 'usr_ask', 'usr_busy'],
            friendsById: {
                usr_join: { status: 'join me' },
                usr_online: { status: 'active' },
                usr_ask: { status: 'ask me' },
                usr_busy: { status: 'busy' }
            }
        });

        expect(html).toContain('aria-label="Friend status distribution"');
        for (const tone of ['join-me', 'online', 'ask-me', 'busy']) {
            expect(html).toContain(`data-status-tone="${tone}"`);
        }
        expect(html.match(/data-status-count="1">1</g)).toHaveLength(4);
        expect(html.match(/data-status-percentage="25%">25%/g)).toHaveLength(4);
        expect(html).toContain('Online friends');
    });

    it('renders the empty state after a ready zero-online snapshot', () => {
        const html = renderWidget({
            loadStatus: 'ready',
            onlineIds: [],
            friendsById: {}
        });

        expect(html).toContain('No online friends');
        expect(html).not.toContain('data-status-tone');
    });
});
