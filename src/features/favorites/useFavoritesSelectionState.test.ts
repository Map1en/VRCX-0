import { describe, expect, it } from 'vitest';

import type { FavoriteItem } from './favoritesTypes';
import { computeSelectionRangeKeys } from './useFavoritesSelectionState';

function buildItem(key: string): FavoriteItem {
    return {
        key,
        id: key,
        kind: 'world',
        source: 'remote'
    };
}

const items: FavoriteItem[] = ['a', 'b', 'c', 'd', 'e'].map(buildItem);

describe('computeSelectionRangeKeys', () => {
    it('selects the inclusive range regardless of click order', () => {
        expect(
            computeSelectionRangeKeys({ items, fromIndex: 1, toIndex: 3 })
        ).toEqual(['b', 'c', 'd']);
        expect(
            computeSelectionRangeKeys({ items, fromIndex: 3, toIndex: 1 })
        ).toEqual(['b', 'c', 'd']);
    });

    it('collapses to a single key when the range is a single index', () => {
        expect(
            computeSelectionRangeKeys({ items, fromIndex: 2, toIndex: 2 })
        ).toEqual(['c']);
    });

    it('clamps out-of-range indexes to the bounds of the item list', () => {
        expect(
            computeSelectionRangeKeys({ items, fromIndex: -5, toIndex: 2 })
        ).toEqual(['a', 'b', 'c']);
        expect(
            computeSelectionRangeKeys({ items, fromIndex: 2, toIndex: 999 })
        ).toEqual(['c', 'd', 'e']);
    });

    it('returns an empty range for an empty item list', () => {
        expect(
            computeSelectionRangeKeys({ items: [], fromIndex: 0, toIndex: 3 })
        ).toEqual([]);
    });
});
