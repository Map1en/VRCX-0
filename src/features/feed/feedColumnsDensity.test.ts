import { describe, expect, it } from 'vitest';

import {
    FEED_COLUMN_DENSITY_OPTIONS,
    getFeedColumnDensityConfig,
    sanitizeFeedColumnDensity
} from './feedColumnsDensity';

describe('feed columns density helpers', () => {
    it('offers only compact and dense density modes', () => {
        expect(
            FEED_COLUMN_DENSITY_OPTIONS.map((option) => option.value)
        ).toEqual(['compact', 'dense']);
    });

    it('falls back legacy standard density to compact', () => {
        expect(sanitizeFeedColumnDensity('standard')).toBe('compact');
    });

    it('keeps compact avatar rows tight', () => {
        const compact = getFeedColumnDensityConfig('compact');

        expect(compact.showAvatar).toBe(true);
        expect(compact.avatarSize).toBe(32);
        expect(compact.rowHeight).toBeLessThanOrEqual(62);
    });
});
