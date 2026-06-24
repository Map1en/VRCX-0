import { describe, expect, it } from 'vitest';

import { canEmbedDashboardPagePanel } from './dashboardPagePanelRegistry';

describe('dashboardPagePanelRegistry charts retirement', () => {
    it('does not embed stale charts-instance panels', () => {
        expect(canEmbedDashboardPagePanel('charts-instance')).toBe(false);
        expect(canEmbedDashboardPagePanel('charts-mutual')).toBe(false);
    });
});
