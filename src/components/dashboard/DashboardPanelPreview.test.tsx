// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('./widgets/DashboardFriendStatusWidget', () => ({
    DashboardFriendStatusWidget: () => (
        <div data-testid="friend-status-widget">friend status widget</div>
    )
}));

import { DashboardPanelPreview } from './DashboardPanelPreview';
import { getDashboardPanelDefinition } from './dashboardRegistry';

const pageMetrics = {
    friendCount: 0,
    onlineCount: 0,
    favoriteFriendCount: 0,
    favoriteWorldCount: 0,
    favoriteAvatarCount: 0,
    notificationCount: 0
};

describe('DashboardPanelPreview', () => {
    it('dispatches the friend-status definition to its donut widget', () => {
        const definition = getDashboardPanelDefinition('widget:friend-status');
        if (!definition) {
            throw new Error('friend-status widget definition is missing');
        }

        const html = renderToStaticMarkup(
            <DashboardPanelPreview
                panelKey="widget:friend-status"
                definition={definition}
                config={{}}
                pageMetrics={pageMetrics}
            />
        );

        expect(html).toContain('data-testid="friend-status-widget"');
        expect(html).not.toContain('dashboard.widget.feed');
    });
});
