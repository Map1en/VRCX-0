// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('./DashboardEmbeddedPagePanel', () => ({
    DashboardEmbeddedPagePanel: () => <div>embedded page</div>
}));

vi.mock('./widgets/DashboardFeedWidget', () => ({
    DashboardFeedWidget: () => <div>feed</div>
}));

vi.mock('./widgets/DashboardGameLogWidget', () => ({
    DashboardGameLogWidget: () => <div>game log</div>
}));

vi.mock('./widgets/DashboardInstanceWidget', () => ({
    DashboardInstanceWidget: () => <div>instance</div>
}));

import { DashboardPanelPreview } from './DashboardPanelPreview';

const definition = {
    key: 'widget:feed',
    category: 'widget' as const,
    labelKey: 'dashboard.registry.feed_widget'
};

const pageMetrics = {
    friendCount: 0,
    onlineCount: 0,
    favoriteFriendCount: 0,
    favoriteWorldCount: 0,
    favoriteAvatarCount: 0,
    notificationCount: 0
};

describe('DashboardPanelPreview', () => {
    afterEach(cleanup);

    it('uses a flush frame in the runtime dock while keeping editor cards framed', () => {
        const view = render(
            <DashboardPanelPreview
                panelKey="widget:feed"
                definition={definition}
                config={{}}
                pageMetrics={pageMetrics}
                frameMode="docked"
            />
        );
        const docked = view.container.firstElementChild;

        expect(docked?.classList.contains('rounded-none')).toBe(true);
        expect(docked?.classList.contains('border-0')).toBe(true);
        expect(docked?.classList.contains('is-compact-table')).toBe(true);

        view.rerender(
            <DashboardPanelPreview
                panelKey="widget:feed"
                definition={definition}
                config={{}}
                pageMetrics={pageMetrics}
            />
        );
        const card = view.container.firstElementChild;

        expect(card?.classList.contains('rounded-md')).toBe(true);
        expect(card?.classList.contains('border')).toBe(true);
        expect(card?.classList.contains('is-compact-table')).toBe(true);
    });
});
