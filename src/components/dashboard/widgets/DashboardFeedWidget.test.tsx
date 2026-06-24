import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { DashboardFeedWidgetView } from './DashboardFeedWidget';

describe('DashboardFeedWidgetView', () => {
    it('renders from explicit props without reading dashboard stores', () => {
        const html = renderToStaticMarkup(
            <MemoryRouter>
                <DashboardFeedWidgetView
                    config={{}}
                    configUpdater={null}
                    currentUserId=""
                    addGameLogEventCount={0}
                    liveFeedEntries={[]}
                    liveFeedVersion={0}
                    remoteFavoriteFriendIds={[]}
                    localFriendFavorites={{}}
                    friendsById={{}}
                />
            </MemoryRouter>
        );

        expect(html).toContain('Feed unavailable');
    });
});
