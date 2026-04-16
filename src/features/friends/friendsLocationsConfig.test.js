import { describe, expect, it } from 'vitest';

import {
    FRIENDS_LOCATIONS_SEGMENTS,
    parseConfigArray,
    safeJsonParse
} from './friendsLocationsConfig.js';

describe('friends locations config helpers', () => {
    it('keeps the expected segment order for the page tabs', () => {
        expect(FRIENDS_LOCATIONS_SEGMENTS.map((segment) => segment.value)).toEqual([
            'online',
            'favorite',
            'same-instance',
            'active',
            'offline'
        ]);
    });

    it('parses JSON config arrays and drops empty entries', () => {
        expect(safeJsonParse('{"enabled":true}', {})).toEqual({ enabled: true });
        expect(safeJsonParse('bad json', { fallback: true })).toEqual({ fallback: true });
        expect(parseConfigArray('["group_a","",null,"group_b"]')).toEqual(['group_a', 'group_b']);
        expect(parseConfigArray(['group_a', '', 'group_b'])).toEqual(['group_a', 'group_b']);
        expect(parseConfigArray('bad json')).toEqual([]);
    });
});
