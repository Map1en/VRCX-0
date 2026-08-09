import { describe, expect, it } from 'vitest';

import { getActivityStatusPercentage } from './user-dialog/userActivityPanelModel';
import { getDisplayDayLabels, getRangeDays } from './UserActivityPanelImpl';

describe('UserActivityPanelImpl helpers', () => {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    it('rotates day labels from the configured first day of week', () => {
        expect(getDisplayDayLabels(dayLabels, 0)).toEqual([
            'Sun',
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri',
            'Sat'
        ]);
        expect(getDisplayDayLabels(dayLabels, 1)).toEqual([
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri',
            'Sat',
            'Sun'
        ]);
        expect(getDisplayDayLabels(dayLabels, 6)).toEqual([
            'Sat',
            'Sun',
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri'
        ]);
    });

    it('parses range days and falls back to the default range', () => {
        expect(getRangeDays('7')).toBe(7);
        expect(getRangeDays('bad')).toBe(30);
        expect(getRangeDays(undefined)).toBe(30);
    });

    it('computes status-log percentages without treating missing data as a ratio', () => {
        expect(getActivityStatusPercentage(1, 4)).toBe(25);
        expect(getActivityStatusPercentage(2, 3)).toBeCloseTo(66.6667, 3);
        expect(getActivityStatusPercentage(-1, 4)).toBe(0);
        expect(getActivityStatusPercentage(1, 0)).toBe(0);
    });
});
