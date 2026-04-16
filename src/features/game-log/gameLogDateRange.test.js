import { describe, expect, it } from 'vitest';

import {
    clampGameLogSessionDateInputRange,
    GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS,
    isoToGameLogDateInputValue,
    parseGameLogDateInput,
    toGameLogDateInputValue,
    toGameLogIsoRangeEnd,
    toGameLogIsoRangeStart
} from './gameLogDateRange.js';

describe('gameLogDateRange', () => {
    it('shows stored ISO dates as editable calendar input values', () => {
        expect(isoToGameLogDateInputValue('2026-04-16')).toBe('2026-04-16');
        expect(isoToGameLogDateInputValue('2026-04-16T12:00:00.000Z')).toBe(
            '2026-04-16'
        );
        expect(isoToGameLogDateInputValue('')).toBe('');
        expect(isoToGameLogDateInputValue('not-a-date')).toBe('');
    });

    it('accepts valid calendar dates and ignores invalid input', () => {
        expect(toGameLogDateInputValue(parseGameLogDateInput('2026-04-16'))).toBe(
            '2026-04-16'
        );
        expect(parseGameLogDateInput('04/16/2026')).toBeUndefined();
        expect(toGameLogDateInputValue(new Date(Number.NaN))).toBe('');
    });

    it('saves selected calendar days as full-day ISO range boundaries', () => {
        const start = new Date(toGameLogIsoRangeStart('2026-04-16'));
        const end = new Date(toGameLogIsoRangeEnd('2026-04-16'));

        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);
        expect(start.getSeconds()).toBe(0);
        expect(end.getHours()).toBe(23);
        expect(end.getMinutes()).toBe(59);
        expect(end.getSeconds()).toBe(59);
        expect(toGameLogIsoRangeStart('bad')).toBe('');
        expect(toGameLogIsoRangeEnd('bad')).toBe('');
    });

    it('keeps a user-selected session range ordered and within the supported max days', () => {
        expect(clampGameLogSessionDateInputRange('2026-04-18', '2026-04-16')).toEqual([
            '2026-04-16',
            '2026-04-18'
        ]);

        expect(clampGameLogSessionDateInputRange('2026-04-01', '2026-04-30')).toEqual([
            '2026-04-01',
            '2026-04-08'
        ]);

        expect(GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS).toBe(7);
        expect(clampGameLogSessionDateInputRange('bad', '2026-04-16')).toEqual([
            'bad',
            '2026-04-16'
        ]);
    });
});
