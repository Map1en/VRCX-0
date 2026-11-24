import {
    compareAsc,
    format,
    isValid,
    parse,
    startOfDay,
    startOfMonth
} from 'date-fns';
import { enUS } from 'react-day-picker/locale/en-US';
import { ja } from 'react-day-picker/locale/ja';
import { zhCN } from 'react-day-picker/locale/zh-CN';

import { eventStatus } from '@/components/group-event/groupEventFormat';
import { GANTT_COLORS } from '@/components/reui/gantt/gantt-bar';
import type {
    GanttEvent,
    GanttResource
} from '@/components/reui/gantt/gantt-types';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { getTimeZoneDateParts } from '@/shared/utils/dateTimeFormatters';

import { getEventGroupId, getEventId } from './groupEventFormat';

const DATE_KEY_FORMAT = 'yyyy-MM-dd';

export function dateKeyToLocalDate(dateKey: string) {
    const parsed = parse(dateKey, DATE_KEY_FORMAT, new Date());
    const valid =
        isValid(parsed) && format(parsed, DATE_KEY_FORMAT) === dateKey;
    return startOfDay(valid ? parsed : new Date());
}

export function monthDateFromKey(dateKey: string) {
    return startOfMonth(dateKeyToLocalDate(dateKey));
}

export function calendarDateKey(
    value: Date | number | string | null | undefined,
    timeZone: string
) {
    const sourceValue = value || new Date();
    const dateParts = getTimeZoneDateParts(sourceValue, timeZone);
    if (dateParts) {
        return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    }
    return format(sourceValue, DATE_KEY_FORMAT);
}

export function formatCalendarRequestDate(value: Date | number | string) {
    return format(value, "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

export function calendarLocaleForLanguage(language: string) {
    const normalized = language.replace('_', '-').toLowerCase();
    if (normalized.startsWith('zh')) {
        return zhCN;
    }
    if (normalized.startsWith('ja')) {
        return ja;
    }
    return enUS;
}

export function buildEventsByDate(
    events: GroupCalendarEventRecord[],
    timeZone: string
) {
    const result: Record<string, GroupCalendarEventRecord[]> = {};
    for (const event of events) {
        const dateKey = calendarDateKey(event.startsAt, timeZone);
        if (!Array.isArray(result[dateKey])) {
            result[dateKey] = [];
        }
        result[dateKey].push(event);
    }
    for (const rows of Object.values(result)) {
        rows.sort((left, right) =>
            compareAsc(
                new Date(left.startsAt || 0),
                new Date(right.startsAt || 0)
            )
        );
    }
    return result;
}

export function buildFollowedCountByDate(
    events: GroupCalendarEventRecord[],
    followingIds: string[],
    timeZone: string
) {
    const followedSet = new Set(followingIds);
    const result: Record<string, number> = {};
    for (const event of events) {
        const eventId = getEventId(event);
        if (!eventId || !followedSet.has(eventId)) {
            continue;
        }
        const dateKey = calendarDateKey(event.startsAt, timeZone);
        result[dateKey] = (result[dateKey] ?? 0) + 1;
    }
    return result;
}

type GroupCalendarTimelineData = {
    resources: GanttResource[];
    events: GanttEvent<GroupCalendarEventRecord>[];
};

export function groupPaletteColor(groupId: string) {
    let hash = 0;
    for (let index = 0; index < groupId.length; index += 1) {
        hash = (hash * 31 + groupId.charCodeAt(index)) >>> 0;
    }
    return GANTT_COLORS[hash % GANTT_COLORS.length].value;
}

export function buildTimelineData(
    events: GroupCalendarEventRecord[],
    groupNames: Record<string, string>,
    followingIds: string[]
): GroupCalendarTimelineData {
    const followedSet = new Set(followingIds);
    const groups = new Map<
        string,
        { name: string; hasFollowed: boolean; firstStart: number }
    >();
    const timelineEvents: GanttEvent<GroupCalendarEventRecord>[] = [];
    for (const event of events) {
        const eventId = getEventId(event);
        const groupId = getEventGroupId(event);
        const start = new Date(event.startsAt || '');
        if (!eventId || !groupId || !isValid(start)) {
            continue;
        }
        const parsedEnd = new Date(event.endsAt || '');
        const end =
            isValid(parsedEnd) && parsedEnd >= start ? parsedEnd : start;
        const isFollowed = followedSet.has(eventId);
        timelineEvents.push({
            id: eventId,
            title: event.title || '',
            start,
            end,
            resourceId: groupId,
            readOnly: true,
            color: groupPaletteColor(groupId),
            data: event
        });
        const group = groups.get(groupId);
        if (group) {
            group.hasFollowed ||= isFollowed;
            group.firstStart = Math.min(group.firstStart, start.getTime());
        } else {
            groups.set(groupId, {
                name: groupNames[groupId] || groupId,
                hasFollowed: isFollowed,
                firstStart: start.getTime()
            });
        }
    }
    const resources = Array.from(groups.entries())
        .sort(
            ([, left], [, right]) =>
                Number(right.hasFollowed) - Number(left.hasFollowed) ||
                left.firstStart - right.firstStart ||
                left.name.localeCompare(right.name)
        )
        .map(([id, group]) => ({ id, title: group.name }));
    return { resources, events: timelineEvents };
}

export type GroupCalendarEventSeries = {
    key: string;
    events: GroupCalendarEventRecord[];
};

export function buildEventSeries(
    events: GroupCalendarEventRecord[]
): GroupCalendarEventSeries[] {
    const series = new Map<string, GroupCalendarEventRecord[]>();
    for (const event of events) {
        const key = `${getEventGroupId(event)}:${(event.title || '').trim().toLowerCase()}`;
        const rows = series.get(key);
        if (rows) {
            rows.push(event);
        } else {
            series.set(key, [event]);
        }
    }
    return Array.from(series, ([key, rows]) => ({ key, events: rows }));
}

export function weeklySlotStart(events: GroupCalendarEventRecord[]) {
    if (events.length < 2) {
        return null;
    }
    const starts = events.map((event) => new Date(event.startsAt || ''));
    const [first] = starts;
    const sameSlot = starts.every(
        (start) =>
            isValid(start) &&
            start.getDay() === first.getDay() &&
            start.getHours() === first.getHours() &&
            start.getMinutes() === first.getMinutes()
    );
    return sameSlot ? first : null;
}

export function defaultOccurrenceIndex(
    events: GroupCalendarEventRecord[],
    nowMs: number
) {
    const index = events.findIndex(
        (event) => eventStatus(event, nowMs) !== 'ended'
    );
    return index === -1 ? events.length - 1 : index;
}
