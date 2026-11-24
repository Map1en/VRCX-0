import { format, startOfDay, startOfMonth } from 'date-fns';
import { enUS } from 'react-day-picker/locale/en-US';
import { ja } from 'react-day-picker/locale/ja';
import { zhCN } from 'react-day-picker/locale/zh-CN';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildEventSeries,
    buildEventsByDate,
    buildFollowedCountByDate,
    buildTimelineData,
    groupPaletteColor,
    calendarDateKey,
    calendarLocaleForLanguage,
    dateKeyToLocalDate,
    defaultOccurrenceIndex,
    monthDateFromKey,
    weeklySlotStart
} from '@/components/group-event/groupCalendarModel';

describe('groupCalendarModel date helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-22T05:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves date keys in the requested calendar time zone', () => {
        const instant = new Date('2026-01-01T01:30:00.000Z');

        expect(calendarDateKey(instant, 'Asia/Tokyo')).toBe('2026-01-01');
        expect(calendarDateKey(instant, 'America/New_York')).toBe('2025-12-31');
    });

    it('falls back to local date key when the time zone is invalid', () => {
        const instant = new Date('2026-01-01T01:30:00.000Z');

        // Invalid zone: no throw, falls back to machine-local formatting.
        expect(calendarDateKey(instant, 'Invalid/Zone')).toBe(
            format(instant, 'yyyy-MM-dd')
        );
        // Contrast: a valid faraway zone genuinely shifts the day, proving the
        // fallback above is not just returning a zone-resolved value.
        expect(calendarDateKey(instant, 'America/New_York')).toBe('2025-12-31');
    });

    it('parses strict date keys and falls back to today for invalid input', () => {
        // Derive the expected fallback the same way the implementation does so
        // the assertion stays correct regardless of the runner's time zone.
        const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');

        expect(format(dateKeyToLocalDate('2026-02-03'), 'yyyy-MM-dd')).toBe(
            '2026-02-03'
        );
        expect(format(dateKeyToLocalDate('2026-02-30'), 'yyyy-MM-dd')).toBe(
            todayKey
        );
        expect(format(dateKeyToLocalDate('2026/02/03'), 'yyyy-MM-dd')).toBe(
            todayKey
        );
    });

    it('resolves month start dates from date keys', () => {
        const monthKey = format(startOfMonth(new Date()), 'yyyy-MM-dd');

        expect(format(monthDateFromKey('2026-02-18'), 'yyyy-MM-dd')).toBe(
            '2026-02-01'
        );
        expect(format(monthDateFromKey('bad-date'), 'yyyy-MM-dd')).toBe(
            monthKey
        );
    });

    it('maps app languages to calendar locales', () => {
        expect(calendarLocaleForLanguage('zh_CN')).toBe(zhCN);
        expect(calendarLocaleForLanguage('ja')).toBe(ja);
        expect(calendarLocaleForLanguage('ko')).toBe(enUS);
        expect(calendarLocaleForLanguage('')).toBe(enUS);
    });
});

describe('groupCalendarModel event grouping', () => {
    it('groups events by requested time zone date key and sorts by start time', () => {
        const lateTokyo = {
            id: 'evt_late_tokyo',
            startsAt: '2026-01-01T03:00:00.000Z'
        };
        const earlyTokyo = {
            id: 'evt_early_tokyo',
            startsAt: '2026-01-01T01:30:00.000Z'
        };
        const previousTokyo = {
            id: 'evt_previous_tokyo',
            startsAt: '2025-12-31T14:00:00.000Z'
        };

        expect(
            buildEventsByDate(
                [lateTokyo, earlyTokyo, previousTokyo],
                'Asia/Tokyo'
            )
        ).toEqual({
            '2025-12-31': [previousTokyo],
            '2026-01-01': [earlyTokyo, lateTokyo]
        });
        expect(buildEventsByDate([earlyTokyo], 'America/New_York')).toEqual({
            '2025-12-31': [earlyTokyo]
        });
    });

    it('counts followed events with the same time zone date key as event grouping', () => {
        const events = [
            {
                id: 'evt_followed_tokyo',
                startsAt: '2026-01-01T01:30:00.000Z'
            },
            {
                eventId: 'evt_followed_previous',
                startsAt: '2025-12-31T14:00:00.000Z'
            },
            {
                id: 'evt_unfollowed',
                startsAt: '2026-01-01T02:00:00.000Z'
            },
            {
                startsAt: '2026-01-01T03:00:00.000Z'
            }
        ];

        expect(
            buildFollowedCountByDate(
                events,
                ['evt_followed_tokyo', 'evt_followed_previous'],
                'Asia/Tokyo'
            )
        ).toEqual({
            '2025-12-31': 1,
            '2026-01-01': 1
        });
        expect(
            buildFollowedCountByDate(
                events,
                ['evt_followed_tokyo'],
                'America/New_York'
            )
        ).toEqual({
            '2025-12-31': 1
        });
    });
});

describe('groupPaletteColor', () => {
    it('gives a group the same palette color every time and spreads groups across the palette', () => {
        const groupIds = Array.from(
            { length: 40 },
            (_, index) => `grp_${index}`
        );
        const colors = groupIds.map(groupPaletteColor);

        expect(groupIds.map(groupPaletteColor)).toEqual(colors);
        expect(new Set(colors).size).toBeGreaterThan(5);
        expect(colors.every((color) => color.startsWith('var(--color-'))).toBe(
            true
        );
    });
});

describe('buildTimelineData', () => {
    it('builds one row per group with followed groups first, then by earliest start', () => {
        const { resources, events } = buildTimelineData(
            [
                {
                    id: 'evt_late',
                    ownerId: 'grp_a',
                    title: 'Late',
                    startsAt: '2026-10-06T14:00:00.000Z',
                    endsAt: '2026-10-06T16:00:00.000Z'
                },
                {
                    id: 'evt_early',
                    ownerId: 'grp_b',
                    title: 'Early',
                    startsAt: '2026-10-06T10:00:00.000Z',
                    endsAt: '2026-10-06T11:00:00.000Z'
                },
                {
                    id: 'evt_followed',
                    ownerId: 'grp_c',
                    title: 'Followed',
                    startsAt: '2026-10-06T20:00:00.000Z',
                    endsAt: '2026-10-07T01:00:00.000Z'
                }
            ],
            { grp_a: 'Group A', grp_c: 'Group C' },
            ['evt_followed']
        );

        expect(resources).toEqual([
            { id: 'grp_c', title: 'Group C' },
            { id: 'grp_b', title: 'grp_b' },
            { id: 'grp_a', title: 'Group A' }
        ]);
        expect(
            events.map((event) => [event.id, event.resourceId, event.color])
        ).toEqual([
            ['evt_late', 'grp_a', groupPaletteColor('grp_a')],
            ['evt_early', 'grp_b', groupPaletteColor('grp_b')],
            ['evt_followed', 'grp_c', groupPaletteColor('grp_c')]
        ]);
        expect(events[2].end.toISOString()).toBe('2026-10-07T01:00:00.000Z');
    });

    it('drops events without id, group or valid start and clamps a bad end to the start', () => {
        const { resources, events } = buildTimelineData(
            [
                { ownerId: 'grp_a', startsAt: '2026-10-06T10:00:00.000Z' },
                { id: 'evt_no_group', startsAt: '2026-10-06T10:00:00.000Z' },
                { id: 'evt_bad_start', ownerId: 'grp_a', startsAt: 'nope' },
                {
                    id: 'evt_bad_end',
                    ownerId: 'grp_a',
                    startsAt: '2026-10-06T10:00:00.000Z',
                    endsAt: '2026-10-06T09:00:00.000Z'
                }
            ],
            {},
            []
        );

        expect(resources).toEqual([{ id: 'grp_a', title: 'grp_a' }]);
        expect(events).toHaveLength(1);
        expect(events[0].id).toBe('evt_bad_end');
        expect(events[0].end.getTime()).toBe(events[0].start.getTime());
    });
});

describe('buildEventSeries', () => {
    it('groups events of one group by trimmed, case-insensitive title in start order', () => {
        const series = buildEventSeries([
            { id: 'a1', ownerId: 'grp_a', title: 'Meetup' },
            { id: 'b1', ownerId: 'grp_a', title: 'Other' },
            { id: 'a2', ownerId: 'grp_a', title: ' meetup ' },
            { id: 'c1', ownerId: 'grp_b', title: 'Meetup' }
        ]);

        expect(
            series.map((entry) => entry.events.map((event) => event.id))
        ).toEqual([['a1', 'a2'], ['b1'], ['c1']]);
    });
});

describe('weeklySlotStart', () => {
    it('returns the first start when every occurrence shares weekday and local time', () => {
        const first = new Date(2026, 9, 4, 21, 0);
        const slot = weeklySlotStart([
            { startsAt: first.toISOString() },
            { startsAt: new Date(2026, 9, 11, 21, 0).toISOString() },
            { startsAt: new Date(2026, 9, 18, 21, 0).toISOString() }
        ]);

        expect(slot?.getTime()).toBe(first.getTime());
    });

    it('returns null for single events, different weekdays or different times', () => {
        expect(
            weeklySlotStart([
                { startsAt: new Date(2026, 9, 4, 21, 0).toISOString() }
            ])
        ).toBeNull();
        expect(
            weeklySlotStart([
                { startsAt: new Date(2026, 9, 4, 21, 0).toISOString() },
                { startsAt: new Date(2026, 9, 5, 21, 0).toISOString() }
            ])
        ).toBeNull();
        expect(
            weeklySlotStart([
                { startsAt: new Date(2026, 9, 4, 21, 0).toISOString() },
                { startsAt: new Date(2026, 9, 11, 22, 0).toISOString() }
            ])
        ).toBeNull();
    });
});

describe('defaultOccurrenceIndex', () => {
    const events = [
        {
            startsAt: '2026-10-04T12:00:00.000Z',
            endsAt: '2026-10-04T14:00:00.000Z'
        },
        {
            startsAt: '2026-10-11T12:00:00.000Z',
            endsAt: '2026-10-11T14:00:00.000Z'
        }
    ];

    it('picks the first occurrence that has not ended yet', () => {
        expect(
            defaultOccurrenceIndex(
                events,
                Date.parse('2026-10-04T13:00:00.000Z')
            )
        ).toBe(0);
        expect(
            defaultOccurrenceIndex(
                events,
                Date.parse('2026-10-06T00:00:00.000Z')
            )
        ).toBe(1);
    });

    it('falls back to the last occurrence when all have ended', () => {
        expect(
            defaultOccurrenceIndex(
                events,
                Date.parse('2026-10-20T00:00:00.000Z')
            )
        ).toBe(1);
    });
});
