import { describe, expect, it } from 'vitest';

import {
    createBaseDefaultNavLayout,
    getNavShortcutEntries,
    routePathByName,
    type NavMenuItem
} from './navMenuModel';

describe('navMenuModel defaults', () => {
    it('places browse history directly after search', () => {
        const layout = createBaseDefaultNavLayout((key: string) => key);
        const searchIndex = layout.findIndex(
            (entry) => entry.type === 'item' && entry.key === 'search'
        );

        expect(routePathByName['browse-history']).toBe('/browse-history');
        expect(layout[searchIndex + 1]).toEqual({
            type: 'item',
            key: 'browse-history'
        });
    });

    it('keeps mutual friends as a top-level default item', () => {
        const layout = createBaseDefaultNavLayout((key: string) => key);

        expect(layout).toContainEqual({ type: 'item', key: 'charts-mutual' });
    });

    it('maps positions to leaf entries in customized order without exposing missing positions', () => {
        const menuItems: NavMenuItem[] = [
            { index: 'empty-folder', children: [] },
            {
                index: 'folder',
                children: [{ index: 'first' }, { index: 'second' }]
            },
            { index: 'third' },
            { index: 'fourth' },
            { index: 'fifth' },
            { index: 'sixth' },
            { index: 'seventh' },
            { index: 'eighth' },
            { index: 'ninth' },
            { index: 'tenth' }
        ];

        expect(
            getNavShortcutEntries(menuItems).map(({ entry, position }) => [
                position,
                entry.index
            ])
        ).toEqual([
            [1, 'first'],
            [2, 'second'],
            [3, 'third'],
            [4, 'fourth'],
            [5, 'fifth'],
            [6, 'sixth'],
            [7, 'seventh'],
            [8, 'eighth'],
            [9, 'ninth']
        ]);
        expect(getNavShortcutEntries(menuItems.slice(0, 2))).toHaveLength(2);
    });
});
