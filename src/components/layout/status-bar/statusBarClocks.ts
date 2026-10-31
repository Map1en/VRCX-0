import { HOUR_MS } from '@/shared/constants/time';
import { getDateTimeFormatter } from '@/shared/utils/dateTimeFormatters';
import { isRecord } from '@/shared/utils/record';

import type { StatusBarClock } from './statusBarTypes';

function normalizeUtcHour(value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(-12, Math.min(14, Math.round(numeric)));
}

export function parseClockOffset(entry: unknown) {
    const value = isRecord(entry)
        ? 'offset' in entry
            ? entry.offset
            : entry.timezone
        : entry;
    if (typeof value === 'number') {
        return normalizeUtcHour(value);
    }
    if (typeof value !== 'string') {
        return 0;
    }
    if (/^[+-]?\d+$/.test(value.trim())) {
        return normalizeUtcHour(Number(value));
    }
    const utcMatch = value.trim().match(/^UTC([+-])(\d{1,2})(?::(\d{1,2}))?$/i);
    if (utcMatch) {
        const sign = utcMatch[1] === '+' ? 1 : -1;
        const hours = Number(utcMatch[2]);
        const minutes = Number(utcMatch[3] || 0);
        return normalizeUtcHour(sign * (hours + minutes / 60));
    }

    try {
        const parts = getDateTimeFormatter('en-US', {
            timeZone: value,
            timeZoneName: 'longOffset'
        }).formatToParts(new Date());
        const timeZoneName =
            parts.find((part) => part.type === 'timeZoneName')?.value || '';
        const offsetMatch = timeZoneName.match(
            /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/
        );
        if (offsetMatch) {
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            const hours = Number(offsetMatch[2]);
            const minutes = Number(offsetMatch[3] || 0);
            return normalizeUtcHour(sign * (hours + minutes / 60));
        }
    } catch {
        return 0;
    }

    return 0;
}

function formatUtcHour(offset: number) {
    const normalized = normalizeUtcHour(offset);
    return `UTC${normalized >= 0 ? '+' : ''}${normalized}`;
}

export const TIMEZONE_OPTIONS = Array.from({ length: 27 }, (_, index) => {
    const value = index - 12;
    return { value, label: formatUtcHour(value) };
});

export function formatClock(nowMs: number, offset: number) {
    const shifted = new Date(nowMs + normalizeUtcHour(offset) * HOUR_MS);
    const hours = String(shifted.getUTCHours()).padStart(2, '0');
    const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${formatUtcHour(offset)}`;
}

function getDefaultClockOffset(localOffset: number) {
    return localOffset >= 0 ? -5 : 9;
}

export function createDefaultClocks(): StatusBarClock[] {
    const localOffset = normalizeUtcHour(-new Date().getTimezoneOffset() / 60);
    return [
        { offset: getDefaultClockOffset(localOffset) },
        { offset: localOffset },
        { offset: 0 }
    ];
}
