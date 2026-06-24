import { describe, expect, it } from 'vitest';

import { navDefinitions } from '@/shared/constants/ui';

import {
    createBaseDefaultNavLayout,
    routePathByName,
    sanitizeNavLayout
} from './navMenuModel';

describe('navMenuModel charts retirement', () => {
    it('removes charts-instance from route paths and nav definitions', () => {
        expect('charts-instance' in routePathByName).toBe(false);
        expect(
            navDefinitions.some(
                (definition) => definition.key === 'charts-instance'
            )
        ).toBe(false);
    });

    it('keeps mutual friends as a top-level default item instead of a charts folder', () => {
        const layout = createBaseDefaultNavLayout((key: string) => key);

        expect(
            layout.some(
                (entry) =>
                    entry.type === 'folder' &&
                    entry.nameKey === 'nav_tooltip.charts'
            )
        ).toBe(false);
        expect(layout).toContainEqual({ type: 'item', key: 'charts-mutual' });
    });

    it('filters stale charts-instance entries from custom layouts without migration', () => {
        const sanitized = sanitizeNavLayout({
            layout: [
                { type: 'item', key: 'charts-instance' },
                {
                    type: 'folder',
                    id: 'default-folder-charts',
                    nameKey: 'nav_tooltip.charts',
                    items: ['charts-instance', 'charts-mutual']
                }
            ],
            hiddenKeys: [],
            definitions: navDefinitions,
            appendDefinitions: [],
            t: (key: string) => key
        });

        expect(JSON.stringify(sanitized)).not.toContain('charts-instance');
        expect(sanitized).toContainEqual({
            type: 'item',
            key: 'charts-mutual'
        });
        expect(JSON.stringify(sanitized)).not.toContain('nav_tooltip.charts');
        expect(JSON.stringify(sanitized)).not.toContain('instance-history');
    });
});
