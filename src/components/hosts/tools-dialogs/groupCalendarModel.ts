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

import { getTimeZoneDateParts } from '@/shared/utils/dateTimeFormatters';

import { getEventId } from './toolsDialogUtils';

export const DATE_KEY_FORMAT = 'yyyy-MM-dd';

export function dateKeyToLocalDate(dateKey: any) {
    const value = String(dateKey || '');
    const parsed = parse(value, DATE_KEY_FORMAT, new Date());
    const valid = isValid(parsed) && format(parsed, DATE_KEY_FORMAT) === value;
    return startOfDay(valid ? parsed : new Date());
}

export function monthDateFromKey(dateKey: any) {
    return startOfMonth(dateKeyToLocalDate(dateKey));
}

export function calendarDateKey(value: any, timeZone: any) {
    const sourceValue = value || new Date();
    const dateParts = getTimeZoneDateParts(sourceValue, timeZone);
    if (dateParts) {
        return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    }
    return format(sourceValue, DATE_KEY_FORMAT);
}

export function formatCalendarRequestDate(value: any) {
    return format(value, "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

export function calendarLocaleForLanguage(language: any) {
    const normalized = String(language || '')
        .replace('_', '-')
        .toLowerCase();
    if (normalized.startsWith('zh')) {
        return zhCN;
    }
    if (normalized.startsWith('ja')) {
        return ja;
    }
    return enUS;
}

export function buildEventsByDate(events: any, timeZone: any) {
    const result: any = {};
    for (const event of Array.isArray(events) ? events : []) {
        const dateKey = calendarDateKey(event.startsAt, timeZone);
        if (!Array.isArray(result[dateKey])) {
            result[dateKey] = [];
        }
        result[dateKey].push(event);
    }
    for (const rows of Object.values(result) as any[]) {
        rows.sort((left: any, right: any) =>
            compareAsc(new Date(left.startsAt), new Date(right.startsAt))
        );
    }
    return result;
}

export function buildFollowedCountByDate(
    events: any,
    followingIds: any,
    timeZone: any
) {
    const followedSet = new Set(
        Array.isArray(followingIds) ? followingIds : []
    );
    const result: any = {};
    for (const event of Array.isArray(events) ? events : []) {
        const eventId = getEventId(event);
        if (!eventId || !followedSet.has(eventId)) {
            continue;
        }
        const dateKey = calendarDateKey(event.startsAt, timeZone);
        result[dateKey] = (result[dateKey] ?? 0) + 1;
    }
    return result;
}
