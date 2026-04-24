import { describe, expect, it } from 'vitest';

import {
    cloneDashboardConfig,
    cloneDashboardRows,
    createDashboardPanelSelectOptions,
    createDashboardWidgetPanelValue,
    getDashboardFilterList,
    getDashboardInstanceWidgetColumns,
    getDashboardPanelConfig,
    getDashboardRowKey,
    getKnownDashboardInstanceWidgetColumns,
    getNextDashboardFilterConfig,
    getNextDashboardInstanceColumnConfig,
    isDashboardFilterActive
} from './dashboardConfig.js';

const dashboardT = (key, params = {}) => {
    const messages = {
        'dashboard.registry.feed': 'Feed',
        'dashboard.registry.feed_widget': 'Feed Widget',
        'view.dashboard.generated_dynamic.existing_value': `Existing · ${params.value}`,
        'view.dashboard.generated_dynamic.page_value': `Page · ${params.value}`,
        'view.dashboard.generated_dynamic.widget_value': `Widget · ${params.value}`
    };

    return messages[key] ?? key;
};

describe('dashboardConfig', () => {
    it('keeps saved dashboard rows editable without mutating the stored dashboard', () => {
        const rows = [
            {
                id: 'row_1',
                direction: 'horizontal',
                panels: [{ key: 'feed', config: { filters: ['friend'] } }]
            }
        ];

        const cloned = cloneDashboardRows(rows);
        cloned[0].panels[0].config.filters.push('gps');

        expect(rows[0].panels[0].config.filters).toEqual(['friend']);
        expect(cloneDashboardRows(null)).toEqual([]);
    });

    it('gives dashboard rows stable keys for persisted and legacy rows', () => {
        expect(getDashboardRowKey({ id: ' row_custom ' })).toBe('row_custom');

        const legacyRow = {
            direction: 'vertical',
            panels: ['feed', { key: 'game-log' }]
        };

        expect(getDashboardRowKey(legacyRow)).toBe(
            getDashboardRowKey(legacyRow)
        );
        expect(
            getDashboardRowKey({ ...legacyRow, direction: 'horizontal' })
        ).not.toBe(getDashboardRowKey(legacyRow));
    });

    it('lets users pick widgets, pages, and existing unknown panels', () => {
        const options = createDashboardPanelSelectOptions(
            'legacy-panel',
            dashboardT
        );

        expect(options[0]).toEqual({
            value: 'legacy-panel',
            label: 'Existing · legacy-panel'
        });
        expect(
            options.some((option) => option.label === 'Widget · Feed Widget')
        ).toBe(true);
        expect(options.some((option) => option.label === 'Page · Feed')).toBe(
            true
        );
        expect(
            createDashboardPanelSelectOptions('__none__', dashboardT).some(
                (option) => option.value === '__none__'
            )
        ).toBe(false);
    });

    it('keeps widget panel configs isolated when changing panel settings', () => {
        const config = {
            filters: ['friend'],
            nested: { enabled: true }
        };

        expect(getDashboardPanelConfig({ config })).toBe(config);
        expect(getDashboardPanelConfig('feed')).toEqual({});

        const clonedConfig = cloneDashboardConfig(config);
        clonedConfig.nested.enabled = false;
        expect(config.nested.enabled).toBe(true);

        const panelValue = createDashboardWidgetPanelValue(
            'widget:feed',
            config
        );
        panelValue.config.filters.push('gps');
        expect(config.filters).toEqual(['friend']);
    });

    it('treats empty dashboard filter config as All and toggles individual filters predictably', () => {
        const filterTypes = ['friend', 'gps', 'avatar'];

        expect(getDashboardFilterList({ filters: ['friend'] })).toEqual([
            'friend'
        ]);
        expect(isDashboardFilterActive({}, 'friend')).toBe(true);
        expect(isDashboardFilterActive({ filters: ['gps'] }, 'friend')).toBe(
            false
        );

        expect(
            getNextDashboardFilterConfig({}, 'friend', filterTypes).filters
        ).toEqual(['gps', 'avatar']);
        expect(
            getNextDashboardFilterConfig(
                { filters: ['gps', 'avatar'] },
                'friend',
                filterTypes
            ).filters
        ).toEqual([]);
        expect(
            getNextDashboardFilterConfig(
                { filters: ['friend'] },
                'friend',
                filterTypes
            ).filters
        ).toEqual([]);
    });

    it('keeps display name visible while users customize instance widget columns', () => {
        expect(
            getDashboardInstanceWidgetColumns({ columns: ['timer', 'timer'] })
        ).toEqual(['displayName', 'timer']);
        expect(
            getDashboardInstanceWidgetColumns({
                columns: ['timer', 'legacyColumn']
            })
        ).toEqual(['displayName', 'timer', 'legacyColumn']);
        expect(
            getKnownDashboardInstanceWidgetColumns({
                columns: ['timer', 'legacyColumn']
            })
        ).toEqual(['displayName', 'timer']);

        expect(
            getNextDashboardInstanceColumnConfig(
                { columns: ['displayName', 'timer', 'legacyColumn'] },
                'timer'
            ).columns
        ).toEqual(['displayName', 'legacyColumn']);
        expect(
            getNextDashboardInstanceColumnConfig(
                { columns: ['displayName', 'legacyColumn'] },
                'platform'
            ).columns
        ).toEqual(['displayName', 'platform', 'legacyColumn']);

        const config = { columns: ['displayName', 'timer'] };
        expect(
            getNextDashboardInstanceColumnConfig(config, 'displayName')
        ).toBe(config);
    });
});
