import { getTimeUnitLabels } from '@/services/i18nService';
import {
    formatClockWithPreferences,
    formatDateFilterWithPreferences,
    formatDateTimeWithPreferences,
    formatRelativeTimeWithPreferences,
    timeToTextWithLabels,
    type DateFilterFormat,
    type DateTimeFormatPreferences,
    type TimeUnitLabels
} from '@/shared/utils/dateTime';
import {
    formatDateTimeValue,
    formatIsoDateTime,
    normalizeDateLocale
} from '@/shared/utils/dateTimeFormatters';
import { useShellStore } from '@/state/shellStore';

export function formatDateFilter(dateStr: unknown, format: DateFilterFormat) {
    const { locale, dateCulture, dateIsoFormat, dateHour12 } =
        useShellStore.getState();
    return formatDateFilterWithPreferences(dateStr, format, {
        appLocale: locale,
        dateCulture,
        dateIsoFormat,
        dateHour12
    });
}

type DateFallbackOptions = {
    empty?: string;
    invalid?: string | ((value: unknown) => string);
};

export function formatDateFilterOrFallback(
    value: unknown,
    format: DateFilterFormat,
    { empty = '-', invalid = '-' }: DateFallbackOptions = {}
) {
    if (!value) {
        return empty;
    }

    const formatted = formatDateFilter(value, format);
    if (formatted !== '-') {
        return formatted;
    }

    return typeof invalid === 'function' ? invalid(value) : invalid;
}

function currentDateTimePreferences(
    overrides: DateTimeFormatPreferences = {}
): DateTimeFormatPreferences {
    const { locale, dateCulture, dateHour12 } = useShellStore.getState();
    return {
        appLocale: locale,
        dateCulture,
        dateHour12,
        ...overrides
    };
}

export function formatDateTime(
    value: unknown,
    options: Intl.DateTimeFormatOptions,
    preferences: DateTimeFormatPreferences = {}
) {
    return formatDateTimeWithPreferences(
        value,
        options,
        currentDateTimePreferences(preferences)
    );
}

export function formatCompactDateTime(value: unknown) {
    return formatDateTime(value, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatScreenshotDateTime(
    value: Date | string | number | null | undefined,
    locale?: string
) {
    if (!value) {
        return '—';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    const {
        dateHour12,
        dateIsoFormat,
        locale: appLocale
    } = useShellStore.getState();

    if (dateIsoFormat) {
        return formatIsoDateTime(date);
    }

    return formatDateTimeValue(
        date,
        {
            dateStyle: 'medium',
            timeStyle: 'short'
        },
        {
            locale: normalizeDateLocale(locale || appLocale, 'en'),
            hour12: Boolean(dateHour12),
            fallback: '—'
        }
    );
}

export function formatClock(
    value: unknown,
    preferences: DateTimeFormatPreferences & { includeSeconds?: boolean } = {}
) {
    return formatClockWithPreferences(
        value,
        currentDateTimePreferences(preferences)
    );
}

export function formatRelativeTime(
    value: unknown,
    preferences: DateTimeFormatPreferences & {
        nowMs?: number;
        style?: Intl.RelativeTimeFormatStyle;
        minUnit?: 'second' | 'minute';
    } = {}
) {
    return formatRelativeTimeWithPreferences(
        value,
        currentDateTimePreferences(preferences)
    );
}

export function timeToText(
    sec: unknown,
    isNeedSeconds: boolean = false,
    unitLabels: Partial<TimeUnitLabels> | undefined = undefined
) {
    return timeToTextWithLabels(
        sec,
        isNeedSeconds,
        unitLabels || getTimeUnitLabels()
    );
}
