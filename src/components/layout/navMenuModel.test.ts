import { describe, expect, it, vi } from 'vitest';

import {
    createBaseDefaultNavLayout,
    getNavShortcutEntries,
    loadNavMenuModel,
    type NavLayoutEntry,
    type NavMenuItem
} from './navMenuModel';

const storedNavConfig = vi.hoisted(() => ({ value: '' }));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn(async () => storedNavConfig.value),
        setString: vi.fn(async () => {})
    }
}));

function layoutKeys(layout: NavLayoutEntry[]) {
    return layout.flatMap((entry) =>
        entry.type === 'item'
            ? [entry.key]
            : entry.items.map((item) =>
                  typeof item === 'string' ? item : item.key
              )
    );
}

describe('navMenuModel stored layout', () => {
    it('shows pages missing from a customized layout unless the user removed them', async () => {
        storedNavConfig.value = JSON.stringify({
            layout: [
                { type: 'item', key: 'search' },
                { type: 'item', key: 'feed' }
            ],
            hiddenKeys: ['game-log']
        });

        const model = await loadNavMenuModel({ t: (key: string) => key });
        const keys = layoutKeys(model.layout);

        expect(keys.slice(0, 2)).toEqual(['search', 'feed']);
        expect(keys).toContain('browse-history');
        expect(keys).not.toContain('game-log');
        expect(model.hiddenKeys).toEqual(['game-log']);
    });
});

describe('navMenuModel defaults', () => {
    it('places browse history directly after search', () => {
        const layout = createBaseDefaultNavLayout((key: string) => key);
        const searchIndex = layout.findIndex(
            (entry) => entry.type === 'item' && entry.key === 'search'
        );

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
