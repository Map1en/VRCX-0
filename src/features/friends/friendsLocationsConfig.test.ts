import { describe, expect, it } from 'vitest';

import {
    buildFriendsLocationsSegmentOptions,
    FRIENDS_LOCATIONS_SEGMENTS,
    parseConfigArray,
    safeJsonParse
} from './friendsLocationsConfig';
import {
    DEFAULT_FRIENDS_LOCATIONS_DENSITY,
    FRIENDS_LOCATIONS_DENSITY_OPTIONS,
    getFriendsLocationsCardRowHeight,
    getFriendsLocationsDensityConfig,
    sanitizeFriendsLocationsDensity
} from './friendsLocationsDensity';

describe('friends locations config helpers', () => {
    it('keeps the expected segment order for the page tabs', () => {
        expect(
            FRIENDS_LOCATIONS_SEGMENTS.map((segment) => segment.value)
        ).toEqual(['online', 'favorite', 'same-instance', 'active', 'offline']);
    });

    it('adds current counts without changing segment order', () => {
        expect(
            buildFriendsLocationsSegmentOptions({
                online: 12,
                favorite: 3,
                'same-instance': 2,
                active: 4,
                offline: 80
            }).map(({ value, count }) => [value, count])
        ).toEqual([
            ['online', 12],
            ['favorite', 3],
            ['same-instance', 2],
            ['active', 4],
            ['offline', 80]
        ]);
    });

    it('parses JSON config arrays and drops empty entries', () => {
        expect(safeJsonParse('{"enabled":true}', {})).toEqual({
            enabled: true
        });
        expect(safeJsonParse('bad json', { fallback: true })).toEqual({
            fallback: true
        });
        expect(parseConfigArray('["group_a","",null,"group_b"]')).toEqual([
            'group_a',
            'group_b'
        ]);
        expect(parseConfigArray(['group_a', '', 'group_b'])).toEqual([
            'group_a',
            'group_b'
        ]);
        expect(parseConfigArray('bad json')).toEqual([]);
    });

    it('normalizes fixed density options and exposes grid metrics', () => {
        expect(DEFAULT_FRIENDS_LOCATIONS_DENSITY).toBe('compact');
        expect(
            FRIENDS_LOCATIONS_DENSITY_OPTIONS.map((option) => option.value)
        ).toEqual(['standard', 'compact', 'dense']);
        expect(sanitizeFriendsLocationsDensity('standard')).toBe('standard');
        expect(sanitizeFriendsLocationsDensity('bad-value')).toBe('compact');

        expect(getFriendsLocationsDensityConfig('standard')).toMatchObject({
            value: 'standard',
            avatarSize: 44,
            gridMinWidth: 200,
            rowHeight: 132,
            statusOnlyRowHeight: 112,
            identityRowHeight: 64,
            locationLineClamp: 2,
            statusLineClamp: 1,
            showStatusDescription: true,
            layout: 'card'
        });
        expect(getFriendsLocationsDensityConfig('dense')).toMatchObject({
            value: 'dense',
            avatarSize: 32,
            gridMinWidth: 180,
            rowHeight: 72,
            statusOnlyRowHeight: 52,
            identityRowHeight: 52,
            locationLineClamp: 1,
            showStatusDescription: false,
            layout: 'item'
        });

        const standard = getFriendsLocationsDensityConfig('standard');
        expect(getFriendsLocationsCardRowHeight(standard, 'full')).toBe(132);
        expect(getFriendsLocationsCardRowHeight(standard, 'status')).toBe(112);
        expect(getFriendsLocationsCardRowHeight(standard, 'identity')).toBe(64);
    });
});
