import { describe, expect, it } from 'vitest';

import { DASHBOARD_BLOCKED_PANEL_KEYS } from '@/shared/constants/dashboard';

import {
    DASHBOARD_PAGE_DEFINITIONS,
    getDashboardPanelDefinition
} from './dashboardRegistry';

describe('dashboardRegistry charts retirement', () => {
    it('removes chart pages as dashboard page modes', () => {
        expect(
            DASHBOARD_PAGE_DEFINITIONS.some(
                (definition) => definition.key === 'charts-instance'
            )
        ).toBe(false);
        expect(
            DASHBOARD_PAGE_DEFINITIONS.some(
                (definition) => definition.key === 'charts-mutual'
            )
        ).toBe(false);
        expect(getDashboardPanelDefinition('charts-instance')).toBe(null);
        expect(getDashboardPanelDefinition('charts-mutual')).toBe(null);
        expect(DASHBOARD_BLOCKED_PANEL_KEYS.has('charts-instance')).toBe(false);
        expect(DASHBOARD_BLOCKED_PANEL_KEYS.has('charts-mutual')).toBe(false);
    });
});
