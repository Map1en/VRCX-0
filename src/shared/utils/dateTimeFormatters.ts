export type DateTimeFormatterOptions = {
    locale?: unknown;
    fallback?: string;
    hour12?: boolean;
};

export type TimeZoneDateParts = {
    year: string;
    month: string;
    day: string;
};

export function normalizeDateLocale(
    locale: unknown,
    fallback = 'en-gb'
): string {
    if (!locale) {
        return fallback;
    }

    const dateLocale = String(locale).replace(/_/g, '-').trim();
    return dateLocale || fallback;
}

export function toValidDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value as never);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function padDatePart(value: unknown): string {
    return String(value).padStart(2, '0');
}

export function formatIsoDateTime(
    value: unknown,
    fallback = '-'
): string {
    const date = toValidDate(value);
    if (!date) {
        return fallback;
    }

    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
        date.getDate()
    )} ${padDatePart(date.getHours())}:${padDatePart(
        date.getMinutes()
    )}:${padDatePart(date.getSeconds())}`;
}

export function formatDateTimeValue(
    value: unknown,
    options: Intl.DateTimeFormatOptions,
    { locale, fallback = '-', hour12 }: DateTimeFormatterOptions = {}
): string {
    const date = toValidDate(value);
    if (!date) {
        return fallback;
    }

    const formatOptions = { ...options };
    if (typeof hour12 === 'boolean') {
        formatOptions.hour12 = hour12;
    }

    try {
        return new Intl.DateTimeFormat(
            normalizeDateLocale(locale),
            formatOptions
        ).format(date);
    } catch {
        return fallback;
    }
}

export function getTimeZoneDateParts(
    value: unknown,
    timeZone: unknown
): TimeZoneDateParts | null {
    const date = toValidDate(value || new Date());
    if (!date) {
        return null;
    }

    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: String(timeZone || ''),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const values = Object.fromEntries(
            parts
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, part.value])
        );
        if (values.year && values.month && values.day) {
            return {
                year: values.year,
                month: values.month,
                day: values.day
            };
        }
    } catch {
        return null;
    }

    return null;
}
