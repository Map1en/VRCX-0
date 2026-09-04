import {
    SECOND_MS,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
    SECONDS_PER_MONTH,
    SECONDS_PER_WEEK,
    SECONDS_PER_YEAR
} from '@/shared/constants/time';

import {
    formatDateTimeValue,
    formatIsoDateTime,
    getRelativeTimeFormatter,
    normalizeDateLocale
} from './dateTimeFormatters';

export const DEFAULT_TIME_UNIT_LABELS = Object.freeze({
    y: 'y',
    d: 'd',
    h: 'h',
    m: 'm',
    s: 's'
});

type DateFilterFormat = 'long' | 'short' | 'time' | 'date';
type TimeUnitLabels = {
    -readonly [Unit in keyof typeof DEFAULT_TIME_UNIT_LABELS]: string;
};

type DateFilterPreferences = {
    appLocale?: string | null;
    dateCulture?: string | null;
    dateIsoFormat?: boolean;
    dateHour12?: boolean;
};

type DateTimeFormatPreferences = Pick<
    DateFilterPreferences,
    'appLocale' | 'dateCulture' | 'dateHour12'
> & {
    hour12?: boolean;
    fallback?: string;
};

type DateInputValue = string | number | Date;

function toDateInput(value: unknown): DateInputValue | null {
    return typeof value === 'string' ||
        typeof value === 'number' ||
        value instanceof Date
        ? value
        : null;
}

export function dateFromUnknown(value: unknown): Date | null {
    const input = toDateInput(value);
    if (input === null) {
        return null;
    }

    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function timestampMsFromValue(value: unknown) {
    if (value === null || value === undefined || value === '') {
        return 0;
    }
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) {
        return numberValue;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

function toLocalClock(
    date: Date,
    dateFormat: string,
    hour12: boolean,
    includeSeconds = false
) {
    return date.toLocaleTimeString(dateFormat, {
        hour: 'numeric',
        minute: '2-digit',
        second: includeSeconds ? '2-digit' : undefined,
        hourCycle: hour12 ? 'h12' : 'h23'
    });
}

function toLocalShort(date: Date, dateFormat: string, hour12: boolean) {
    return date
        .toLocaleDateString(dateFormat, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hourCycle: hour12 ? 'h12' : 'h23'
        })
        .replace(' AM', 'am')
        .replace(' PM', 'pm')
        .replace(',', '');
}

function toLocalLong(date: Date, dateFormat: string, hour12: boolean) {
    return date.toLocaleDateString(dateFormat, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: hour12 ? 'h12' : 'h23'
    });
}

function toLocalTime(date: Date, dateFormat: string, hour12: boolean) {
    return toLocalClock(date, dateFormat, hour12);
}

function toLocalDate(date: Date, dateFormat: string) {
    return date.toLocaleDateString(dateFormat, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

export function formatDateFilterWithPreferences(
    dateStr: unknown,
    format: DateFilterFormat,
    preferences: DateFilterPreferences = {}
) {
    if (!dateStr) {
        return '-';
    }

    const dt = dateFromUnknown(dateStr);
    if (!dt) {
        return '-';
    }

    const dateIsoFormat = preferences.dateIsoFormat ?? false;
    const dateHour12 = preferences.dateHour12 ?? false;
    const dateFormat = normalizeDateLocale(
        preferences.appLocale || preferences.dateCulture
    );

    if (dateIsoFormat && format === 'long') {
        return formatIsoDateTime(dt);
    }
    if (format === 'long') {
        return toLocalLong(dt, dateFormat, dateHour12);
    }
    if (format === 'short') {
        return toLocalShort(dt, dateFormat, dateHour12);
    }
    if (format === 'time') {
        return toLocalTime(dt, dateFormat, dateHour12);
    }
    if (format === 'date') {
        return toLocalDate(dt, dateFormat);
    }

    return '-';
}

export function formatDateTimeWithPreferences(
    value: unknown,
    options: Intl.DateTimeFormatOptions,
    preferences: DateTimeFormatPreferences = {}
) {
    if (!value) {
        return preferences.fallback ?? '-';
    }

    const date = dateFromUnknown(value);
    if (!date) {
        return preferences.fallback ?? '-';
    }

    const locale = normalizeDateLocale(
        preferences.appLocale || preferences.dateCulture
    );
    const hour12 = preferences.hour12 ?? preferences.dateHour12 ?? false;
    const formatOptions = { ...options };
    if (
        typeof formatOptions.hour !== 'undefined' ||
        typeof formatOptions.minute !== 'undefined' ||
        typeof formatOptions.second !== 'undefined' ||
        typeof formatOptions.timeStyle !== 'undefined'
    ) {
        formatOptions.hour12 = hour12;
    }

    return formatDateTimeValue(date, formatOptions, {
        locale,
        fallback: preferences.fallback ?? '-'
    });
}

export function formatClockWithPreferences(
    value: unknown,
    preferences: DateTimeFormatPreferences & { includeSeconds?: boolean } = {}
) {
    return formatDateTimeWithPreferences(
        value,
        {
            hour: '2-digit',
            minute: '2-digit',
            second: preferences.includeSeconds ? '2-digit' : undefined
        },
        {
            ...preferences,
            fallback: preferences.fallback ?? ''
        }
    );
}

export function formatRelativeTimeWithPreferences(
    value: unknown,
    preferences: DateTimeFormatPreferences & {
        nowMs?: number;
        style?: Intl.RelativeTimeFormatStyle;
    } = {}
) {
    if (!value) {
        return preferences.fallback ?? '';
    }

    const date = dateFromUnknown(value);
    if (!date) {
        return preferences.fallback ?? '';
    }

    const nowMs = Number.isFinite(preferences.nowMs)
        ? Number(preferences.nowMs)
        : Date.now();
    const diffSeconds = Math.round((date.getTime() - nowMs) / SECOND_MS);
    const absSeconds = Math.abs(diffSeconds);
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', SECONDS_PER_YEAR],
        ['month', SECONDS_PER_MONTH],
        ['week', SECONDS_PER_WEEK],
        ['day', SECONDS_PER_DAY],
        ['hour', SECONDS_PER_HOUR],
        ['minute', SECONDS_PER_MINUTE],
        ['second', 1]
    ];
    const [unit, unitSeconds] =
        units.find(([, seconds]) => absSeconds >= seconds) ||
        units[units.length - 1];
    const amount = Math.round(diffSeconds / unitSeconds);
    const locale = normalizeDateLocale(
        preferences.appLocale || preferences.dateCulture
    );

    try {
        return getRelativeTimeFormatter(locale, {
            numeric: 'auto',
            style: preferences.style || 'long'
        }).format(amount, unit);
    } catch {
        return preferences.fallback ?? '';
    }
}

export function timeToTextWithLabels(
    sec: unknown,
    isNeedSeconds = false,
    unitLabels: Partial<TimeUnitLabels> | undefined = undefined,
    separator = ' '
) {
    let n = Number(sec);
    if (!Number.isFinite(n)) {
        return String(sec);
    }

    n = Math.floor(n / SECOND_MS);
    const arr = [];
    if (n < 0) {
        n = -n;
    }
    if (isNeedSeconds || n < SECONDS_PER_MINUTE) {
        n = Math.floor((n + 2.5) / 5) * 5;
    }
    const labels: TimeUnitLabels = {
        ...DEFAULT_TIME_UNIT_LABELS,
        ...unitLabels
    };
    if (n >= SECONDS_PER_YEAR) {
        arr.push(`${Math.floor(n / SECONDS_PER_YEAR)}${labels.y}`);
        n %= SECONDS_PER_YEAR;
    }
    if (n >= SECONDS_PER_DAY) {
        arr.push(`${Math.floor(n / SECONDS_PER_DAY)}${labels.d}`);
        n %= SECONDS_PER_DAY;
    }
    if (n >= SECONDS_PER_HOUR) {
        arr.push(`${Math.floor(n / SECONDS_PER_HOUR)}${labels.h}`);
        n %= SECONDS_PER_HOUR;
    }
    if (n >= SECONDS_PER_MINUTE) {
        arr.push(`${Math.floor(n / SECONDS_PER_MINUTE)}${labels.m}`);
        n %= SECONDS_PER_MINUTE;
    }
    if (isNeedSeconds || (arr.length === 0 && n < SECONDS_PER_MINUTE)) {
        arr.push(`${n}${labels.s}`);
    }
    return arr.join(separator);
}

export type {
    DateFilterFormat,
    DateFilterPreferences,
    DateTimeFormatPreferences,
    TimeUnitLabels
};
export { normalizeDateLocale };
