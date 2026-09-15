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

import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { getTimeZoneDateParts } from '@/shared/utils/dateTimeFormatters';

import { getEventId } from './toolsDialogUtils';

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
