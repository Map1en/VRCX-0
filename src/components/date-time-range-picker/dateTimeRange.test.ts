import { describe, expect, it } from 'vitest';

import {
    buildDateTimeRange,
    buildMinuteOptions,
    combineDateTime,
    slotEndTime,
    snapMinuteDown,
    stripTime,
    toTimeValue
} from './dateTimeRange';

describe('buildMinuteOptions', () => {
    it('returns every minute for step 1', () => {
        expect(buildMinuteOptions(1)).toHaveLength(60);
        expect(buildMinuteOptions(1)[0]).toBe('00');
        expect(buildMinuteOptions(1)[59]).toBe('59');
    });

    it('returns the quarter-hour slots for step 15', () => {
        expect(buildMinuteOptions(15)).toEqual(['00', '15', '30', '45']);
    });

    it('falls back to step 1 for invalid steps', () => {
        expect(buildMinuteOptions(0)).toHaveLength(60);
        expect(buildMinuteOptions(NaN)).toHaveLength(60);
    });
});

describe('snapMinuteDown', () => {
    it('floors the minute to the step and keeps the hour', () => {
        expect(snapMinuteDown('23:59', 15)).toBe('23:45');
        expect(snapMinuteDown('09:07', 15)).toBe('09:00');
        expect(snapMinuteDown('09:30', 15)).toBe('09:30');
    });

    it('is a no-op for step 1', () => {
        expect(snapMinuteDown('14:37', 1)).toBe('14:37');
    });
});

describe('slotEndTime', () => {
    it('extends an end slot to the last minute of its block', () => {
        expect(slotEndTime('23:45', 15)).toBe('23:59');
        expect(slotEndTime('09:30', 15)).toBe('09:44');
    });

    it('snaps a non-aligned value before extending', () => {
        expect(slotEndTime('23:59', 15)).toBe('23:59');
    });

    it('leaves the minute unchanged for step 1', () => {
        expect(slotEndTime('14:37', 1)).toBe('14:37');
    });
});

describe('toTimeValue', () => {
    it('returns the fallback when the date is missing', () => {
        expect(toTimeValue(null, '08:00')).toBe('08:00');
        expect(toTimeValue(undefined, '23:59')).toBe('23:59');
    });

    it('formats a date as zero-padded HH:MM', () => {
        expect(toTimeValue(new Date(2026, 5, 22, 3, 5), '')).toBe('03:05');
        expect(toTimeValue(new Date(2026, 5, 22, 17, 45), '')).toBe('17:45');
    });
});

describe('stripTime', () => {
    it('zeroes the time of day but keeps the calendar date', () => {
        const result = stripTime(new Date(2026, 5, 22, 13, 27, 42, 500));
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(5);
        expect(result.getDate()).toBe(22);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
        expect(result.getSeconds()).toBe(0);
        expect(result.getMilliseconds()).toBe(0);
    });

    it('does not mutate the input date', () => {
        const input = new Date(2026, 5, 22, 13, 27);
        stripTime(input);
        expect(input.getHours()).toBe(13);
        expect(input.getMinutes()).toBe(27);
    });
});

describe('combineDateTime', () => {
    const day = new Date(2026, 5, 22);

    it('applies the start of the minute when endOfMinute is false', () => {
        const result = combineDateTime(day, '09:30', false);
        expect(result.getHours()).toBe(9);
        expect(result.getMinutes()).toBe(30);
        expect(result.getSeconds()).toBe(0);
        expect(result.getMilliseconds()).toBe(0);
    });

    it('applies the end of the minute when endOfMinute is true', () => {
        const result = combineDateTime(day, '17:45', true);
        expect(result.getHours()).toBe(17);
        expect(result.getMinutes()).toBe(45);
        expect(result.getSeconds()).toBe(59);
        expect(result.getMilliseconds()).toBe(999);
    });

    it('falls back to 00:00 for malformed time strings', () => {
        const result = combineDateTime(day, 'not-a-time', false);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
    });

    it('does not mutate the input date', () => {
        combineDateTime(day, '12:00', false);
        expect(day.getHours()).toBe(0);
    });
});

describe('buildDateTimeRange', () => {
    it('returns a null range when there is no draft start date', () => {
        expect(buildDateTimeRange(undefined, '00:00', '23:59')).toEqual({
            from: null,
            to: null
        });
        expect(buildDateTimeRange({ from: null }, '00:00', '23:59')).toEqual({
            from: null,
            to: null
        });
    });

    it('merges the date range with the selected times', () => {
        const range = {
            from: new Date(2026, 5, 20),
            to: new Date(2026, 5, 22)
        };
        const result = buildDateTimeRange(range, '09:30', '17:45');
        expect(result.from?.getDate()).toBe(20);
        expect(result.from?.getHours()).toBe(9);
        expect(result.from?.getMinutes()).toBe(30);
        expect(result.from?.getSeconds()).toBe(0);
        expect(result.to?.getDate()).toBe(22);
        expect(result.to?.getHours()).toBe(17);
        expect(result.to?.getMinutes()).toBe(45);
        expect(result.to?.getSeconds()).toBe(59);
        expect(result.from!.getTime()).toBeLessThan(result.to!.getTime());
    });

    it('uses the start date for the end bound when only one day is selected', () => {
        const range = { from: new Date(2026, 5, 22) };
        const result = buildDateTimeRange(range, '08:00', '20:15');
        expect(result.from?.getDate()).toBe(22);
        expect(result.to?.getDate()).toBe(22);
        expect(result.to?.getHours()).toBe(20);
        expect(result.to?.getMinutes()).toBe(15);
    });
});
