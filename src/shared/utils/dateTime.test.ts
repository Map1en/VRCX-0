import { describe, expect, it } from 'vitest';

import {
    formatClockWithPreferences,
    formatDateFilterWithPreferences,
    formatDateTimeWithPreferences,
    formatRelativeTimeWithPreferences
} from './dateTime';

const LOCAL_DATE = '2026-06-04T09:20:02';

describe('dateTime utils', () => {
    it('formats visible dates with the app locale before date culture', () => {
        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'long', {
                appLocale: 'zh-CN',
                dateCulture: 'en-gb',
                dateHour12: false
            })
        ).toBe('2026年6月4日 9:20:02');
    });

    it('formats Chinese short dates as month and day text', () => {
        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'short', {
                appLocale: 'zh-CN',
                dateHour12: false
            })
        ).toBe('6月4日 9:20');
        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'date', {
                appLocale: 'zh-TW'
            })
        ).toBe('2026年6月4日');
    });

    it('formats Japanese date labels with Japanese locale ordering', () => {
        const date = new Date(LOCAL_DATE);
        const expected = date.toLocaleDateString('ja', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });

        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'date', {
                appLocale: 'ja'
            })
        ).toBe(expected);
    });

    it('formats English short dates with the English app locale', () => {
        const date = new Date(LOCAL_DATE);
        const expected = date
            .toLocaleDateString('en', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hourCycle: 'h23'
            })
            .replace(' AM', 'am')
            .replace(' PM', 'pm')
            .replace(',', '');

        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'short', {
                appLocale: 'en',
                dateHour12: false
            })
        ).toBe(expected);
    });

    it('keeps long ISO output when ISO format is enabled', () => {
        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'long', {
                appLocale: 'ja',
                dateIsoFormat: true
            })
        ).toBe('2026-06-04 09:20:02');
    });

    it('switches the clock between 12-hour and 24-hour preferences', () => {
        const date = new Date(LOCAL_DATE);

        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'time', {
                appLocale: 'en',
                dateHour12: true
            })
        ).toBe(
            date.toLocaleTimeString('en', {
                hour: 'numeric',
                minute: 'numeric',
                hourCycle: 'h12'
            })
        );
        expect(
            formatDateFilterWithPreferences(LOCAL_DATE, 'time', {
                appLocale: 'en',
                dateHour12: false
            })
        ).toBe(
            date.toLocaleTimeString('en', {
                hour: 'numeric',
                minute: 'numeric',
                hourCycle: 'h23'
            })
        );
    });

    it('formats arbitrary date time options and clocks with app locale', () => {
        const date = new Date(LOCAL_DATE);

        expect(
            formatDateTimeWithPreferences(
                LOCAL_DATE,
                {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                },
                {
                    appLocale: 'ja',
                    dateHour12: false
                }
            )
        ).toBe(
            new Intl.DateTimeFormat('ja', {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).format(date)
        );
        expect(
            formatClockWithPreferences(LOCAL_DATE, {
                appLocale: 'en',
                hour12: true,
                includeSeconds: true
            })
        ).toBe(
            new Intl.DateTimeFormat('en', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            }).format(date)
        );
    });

    it('returns fallbacks for empty and invalid dates', () => {
        expect(formatDateFilterWithPreferences('', 'long')).toBe('-');
        expect(formatDateFilterWithPreferences('not-a-date', 'long')).toBe('-');
        expect(formatDateTimeWithPreferences('not-a-date', {})).toBe('-');
        expect(formatClockWithPreferences('not-a-date')).toBe('');
        expect(formatRelativeTimeWithPreferences('not-a-date')).toBe('');
    });

    it('formats relative time with app locale', () => {
        const expected = new Intl.RelativeTimeFormat('zh-CN', {
            numeric: 'auto'
        }).format(-2, 'hour');

        expect(
            formatRelativeTimeWithPreferences('2026-06-04T07:20:02', {
                appLocale: 'zh-CN',
                nowMs: new Date(LOCAL_DATE).getTime()
            })
        ).toBe(expected);
    });
});
