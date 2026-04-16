import { describe, expect, it } from 'vitest';

import {
    favoriteGroupType,
    normalizeFavoriteEntityId,
    normalizeFavoriteSearchValue,
    resolveCurrentInviteLocation,
    shrinkFavoriteImage,
    sortFavoriteItems
} from './favoritesItems.js';

describe('favorite item helpers', () => {
    it('normalizes search text and entity ids for matching and actions', () => {
        expect(normalizeFavoriteSearchValue('  Rooftop Club  ')).toBe('rooftop club');
        expect(normalizeFavoriteSearchValue(null)).toBe('');
        expect(normalizeFavoriteEntityId('  wrld_123  ')).toBe('wrld_123');
        expect(normalizeFavoriteEntityId(42)).toBe('42');
        expect(normalizeFavoriteEntityId(null)).toBe('');
    });

    it('resolves the current invite location from game state before profile fallback', () => {
        expect(
            resolveCurrentInviteLocation(
                { currentLocation: 'wrld_live:123', currentDestination: 'wrld_next:456' },
                { location: 'wrld_profile:789' }
            )
        ).toBe('wrld_live:123');

        expect(
            resolveCurrentInviteLocation(
                { currentLocation: 'traveling', currentDestination: 'wrld_next:456' },
                { location: 'wrld_profile:789' }
            )
        ).toBe('wrld_next:456');

        expect(resolveCurrentInviteLocation({}, { $locationTag: 'wrld_profile:789' })).toBe('wrld_profile:789');
    });

    it('sorts favorite items by saved order, name, or player count', () => {
        const items = [
            { id: 'b', title: 'Beta', orderIndex: 2, playerCount: 6 },
            { id: 'a', title: 'Alpha', orderIndex: 1, playerCount: 10 },
            { id: 'c', title: 'Alpha', orderIndex: 3, playerCount: 2 }
        ];

        expect(sortFavoriteItems(items, 'date').map((item) => item.id)).toEqual(['a', 'b', 'c']);
        expect(sortFavoriteItems(items, 'name').map((item) => item.id)).toEqual(['a', 'c', 'b']);
        expect(sortFavoriteItems(items, 'players').map((item) => item.id)).toEqual(['a', 'b', 'c']);
        expect(items.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    });

    it('shrinks direct image URLs from 256 to 128 when possible', () => {
        expect(shrinkFavoriteImage('https://example.test/image/file_abc/1/256')).toBe(
            'https://example.test/image/file_abc/1/128'
        );
        expect(shrinkFavoriteImage('')).toBe('');
    });

    it('resolves favorite group type from explicit group data or page kind', () => {
        expect(favoriteGroupType('avatar', { type: 'avatar' })).toBe('avatar');
        expect(favoriteGroupType('world', {})).toBe('world');
        expect(favoriteGroupType('friend', {})).toBe('friend');
    });
});
