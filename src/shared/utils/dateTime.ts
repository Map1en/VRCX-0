export const DEFAULT_TIME_UNIT_LABELS = Object.freeze({
    y: 'y',
    d: 'd',
    h: 'h',
    m: 'm',
    s: 's'
});

type DateFilterFormat = 'long' | 'short' | 'time' | 'date' | string;
type TimeUnitLabels = typeof DEFAULT_TIME_UNIT_LABELS;

type DateFilterPreferences = {
    appLocale?: unknown;
    dateCulture?: unknown;
    dateIsoFormat?: unknown;
    dateHour12?: unknown;
};

type DateTimeFormatPreferences = Pick<
    DateFilterPreferences,
    'appLocale' | 'dateCulture' | 'dateHour12'
> & {
    hour12?: boolean;
    fallback?: string;
};

function padZero(num: unknown) {
    return String(num).padStart(2, '0');
}

function toIsoLong(date: Date) {
    const y = date.getFullYear();
    const m = padZero(date.getMonth() + 1);
    const d = padZero(date.getDate());
    const hh = padZero(date.getHours());
    const mm = padZero(date.getMinutes());
    const ss = padZero(date.getSeconds());
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export function normalizeDateLocale(locale: unknown, fallback = 'en-gb') {
    if (!locale) {
        return fallback;
    }

    const dateLocale = String(locale).replace(/_/g, '-').trim();
    return dateLocale || fallback;
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

    const dt = new Date(dateStr as any);
    if (Number.isNaN(dt.getTime())) {
        return '-';
    }

    const dateIsoFormat = Boolean(preferences.dateIsoFormat);
    const dateHour12 = Boolean(preferences.dateHour12);
    const dateFormat = normalizeDateLocale(
        preferences.appLocale || preferences.dateCulture
    );

    if (dateIsoFormat && format === 'long') {
        return toIsoLong(dt);
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

    const date = new Date(value as any);
    if (Number.isNaN(date.getTime())) {
        return preferences.fallback ?? '-';
    }

    const locale = normalizeDateLocale(
        preferences.appLocale || preferences.dateCulture
    );
    const hour12 =
        typeof preferences.hour12 === 'boolean'
            ? preferences.hour12
            : Boolean(preferences.dateHour12);
    const formatOptions = { ...options };
    if (
        typeof formatOptions.hour !== 'undefined' ||
        typeof formatOptions.minute !== 'undefined' ||
        typeof formatOptions.second !== 'undefined'
    ) {
        formatOptions.hour12 = hour12;
    }

    try {
        return new Intl.DateTimeFormat(locale, formatOptions).format(date);
    } catch {
        return preferences.fallback ?? '-';
    }
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

    const date = new Date(value as any);
    if (Number.isNaN(date.getTime())) {
        return preferences.fallback ?? '';
    }

    const nowMs = Number.isFinite(preferences.nowMs)
        ? Number(preferences.nowMs)
        : Date.now();
    const diffSeconds = Math.round((date.getTime() - nowMs) / 1000);
    const absSeconds = Math.abs(diffSeconds);
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', 31536000],
        ['month', 2592000],
        ['week', 604800],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
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
        return new Intl.RelativeTimeFormat(locale, {
            numeric: 'auto',
            style: preferences.style || 'long'
        }).format(amount, unit);
    } catch {
        return preferences.fallback ?? '';
    }
}

export function timeToTextWithLabels(
    sec: unknown,
    isNeedSeconds: any = false,
    unitLabels: Partial<TimeUnitLabels> | undefined = undefined
) {
    let n = Number(sec);
    if (Number.isNaN(n)) {
        return String(sec);
    }

    n = Math.floor(n / 1000);
    const arr = [];
    if (n < 0) {
        n = -n;
    }
    const labels: TimeUnitLabels = {
        ...DEFAULT_TIME_UNIT_LABELS,
        ...(unitLabels || {})
    };
    if (n >= 31536000) {
        arr.push(`${Math.floor(n / 31536000)}${labels.y}`);
        n %= 31536000;
    }
    if (n >= 86400) {
        arr.push(`${Math.floor(n / 86400)}${labels.d}`);
        n %= 86400;
    }
    if (n >= 3600) {
        arr.push(`${Math.floor(n / 3600)}${labels.h}`);
        n %= 3600;
    }
    if (n >= 60) {
        arr.push(`${Math.floor(n / 60)}${labels.m}`);
        n %= 60;
    }
    if (isNeedSeconds || (arr.length === 0 && n < 60)) {
        n = Math.floor((n + 2.5) / 5) * 5;
        arr.push(`${n}${labels.s}`);
    }
    return arr.join(' ');
}

export type {
    DateFilterFormat,
    DateFilterPreferences,
    DateTimeFormatPreferences,
    TimeUnitLabels
};
