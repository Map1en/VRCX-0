import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TIME_UNIT_LABELS } from '@/shared/utils/dateTime';
import { useShellStore } from '@/state/shellStore';

import {
    formatDateFilterOrFallback,
    formatRelativeTime,
    timeToText
} from './dateTime';

const NOW = new Date('2026-06-22T12:00:00Z').getTime();
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const YEAR_MS = 365 * DAY_MS;

describe('app dateTime wrappers', () => {
    beforeEach(() => {
        useShellStore.setState({
            locale: 'en',
            dateCulture: 'en-gb',
            dateHour12: false,
            dateIsoFormat: false,
            timeUnitLabels: DEFAULT_TIME_UNIT_LABELS
        });
    });

    it('formats relative time through the current shell locale', () => {
        useShellStore.setState({ locale: 'zh-CN' });
        const value = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
        const expected = new Intl.RelativeTimeFormat('zh-CN', {
            numeric: 'auto',
            style: 'long'
        }).format(-2, 'hour');

        expect(formatRelativeTime(value, { nowMs: NOW })).toBe(expected);
    });

    it('returns relative-time fallback for empty and invalid values', () => {
        expect(formatRelativeTime('', { fallback: 'missing' })).toBe('missing');
        expect(formatRelativeTime('not-a-date', { fallback: 'invalid' })).toBe(
            'invalid'
        );
    });

    it('formats date filters with caller-specific empty and invalid fallbacks', () => {
        useShellStore.setState({ dateIsoFormat: true });

        expect(
            formatDateFilterOrFallback('2026-01-02T03:04:05', 'long', {
                empty: '',
                invalid: (value) => String(value)
            })
        ).toBe('2026-01-02 03:04:05');
        expect(
            formatDateFilterOrFallback('', 'long', {
                empty: '',
                invalid: (value) => String(value)
            })
        ).toBe('');
        expect(
            formatDateFilterOrFallback('not-a-date', 'long', {
                empty: '',
                invalid: (value) => String(value)
            })
        ).toBe('not-a-date');
        expect(
            formatDateFilterOrFallback('not-a-date', 'long', {
                empty: '—',
                invalid: '—'
            })
        ).toBe('—');
    });

    it('formats millisecond durations with stable unit boundaries', () => {
        expect(timeToText(0)).toBe('0s');
        expect(timeToText(90_000)).toBe('1m');
        expect(timeToText(90_000, true)).toBe('1m 30s');
        expect(timeToText(3_661_000, true)).toBe('1h 1m 0s');
        expect(timeToText(-86_400_000)).toBe('1d');
        expect(timeToText('not-a-number')).toBe('not-a-number');
    });

    it('rounds displayed seconds to five-second buckets', () => {
        expect(timeToText(999)).toBe('0s');
        expect(timeToText(2_999)).toBe('0s');
        expect(timeToText(3_000)).toBe('5s');
        expect(timeToText(7_499)).toBe('5s');
        expect(timeToText(8_000)).toBe('10s');
        expect(timeToText(57_000)).toBe('55s');
        expect(timeToText(58_000)).toBe('1m');
        expect(timeToText(58_000, true)).toBe('1m 0s');
    });

    it('carries rounded seconds across larger unit boundaries', () => {
        expect(timeToText(13 * MINUTE_MS + 58 * SECOND_MS, true)).toBe(
            '14m 0s'
        );
        expect(timeToText(59 * MINUTE_MS + 58 * SECOND_MS, true)).toBe('1h 0s');
        expect(
            timeToText(23 * HOUR_MS + 59 * MINUTE_MS + 58 * SECOND_MS, true)
        ).toBe('1d 0s');
        expect(
            timeToText(
                364 * DAY_MS + 23 * HOUR_MS + 59 * MINUTE_MS + 58 * SECOND_MS,
                true
            )
        ).toBe('1y 0s');
    });

    it('keeps seconds hidden for multi-unit durations unless requested', () => {
        expect(timeToText(61_000)).toBe('1m');
        expect(timeToText(HOUR_MS + MINUTE_MS + 5 * SECOND_MS)).toBe('1h 1m');
        expect(timeToText(DAY_MS + HOUR_MS + MINUTE_MS + 5 * SECOND_MS)).toBe(
            '1d 1h 1m'
        );
    });

    it('formats negative durations as absolute elapsed time', () => {
        expect(timeToText(-58_000)).toBe('1m');
        expect(timeToText(-58_000, true)).toBe('1m 0s');
        expect(timeToText(-(HOUR_MS + MINUTE_MS + SECOND_MS), true)).toBe(
            '1h 1m 0s'
        );
    });

    it('handles numeric-like and invalid duration inputs', () => {
        expect(timeToText('65000', true)).toBe('1m 5s');
        expect(timeToText(null)).toBe('0s');
        expect(timeToText('')).toBe('0s');
        expect(timeToText(undefined)).toBe('undefined');
        expect(timeToText('not-a-number')).toBe('not-a-number');
        expect(timeToText(Number.POSITIVE_INFINITY)).toBe('Infinity');
        expect(timeToText(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
    });

    it('uses shell-provided duration labels unless explicit labels are passed', () => {
        useShellStore.getState().setTimeUnitLabels({
            y: ' years',
            d: ' days',
            h: ' hours',
            m: ' minutes',
            s: ' seconds'
        });

        expect(timeToText(3_600_000)).toBe('1 hours');
        expect(timeToText(65_000, true)).toBe('1 minutes 5 seconds');
        expect(
            timeToText(
                YEAR_MS +
                    2 * DAY_MS +
                    3 * HOUR_MS +
                    4 * MINUTE_MS +
                    5 * SECOND_MS,
                true
            )
        ).toBe('1 years 2 days 3 hours 4 minutes 5 seconds');
        expect(timeToText(65_000, true, { m: 'm', s: 's' })).toBe('1m 5s');
    });
});
