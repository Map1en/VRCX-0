export const GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS = 7;

function normalizeDateInput(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function parseGameLogDateInput(value) {
    const normalizedValue = normalizeDateInput(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return undefined;
    }
    const [year, month, day] = normalizedValue
        .split('-')
        .map((part) => Number.parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function toGameLogDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function isoToGameLogDateInputValue(value) {
    const normalized = normalizeDateInput(value);
    if (!normalized) {
        return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return normalized;
    }
    const date = new Date(normalized);
    return toGameLogDateInputValue(date);
}

export function toGameLogIsoRangeStart(value) {
    const date = parseGameLogDateInput(value);
    if (!date) {
        return '';
    }
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
}

export function toGameLogIsoRangeEnd(value) {
    const date = parseGameLogDateInput(value);
    if (!date) {
        return '';
    }
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
}

function addCalendarDays(date, days) {
    const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
}

export function clampGameLogSessionDateInputRange(from, to) {
    const startInput = normalizeDateInput(from);
    const endInput = normalizeDateInput(to);
    const startDate = parseGameLogDateInput(startInput);
    const endDate = parseGameLogDateInput(endInput);
    if (!startDate || !endDate) {
        return [startInput, endInput];
    }

    const lowerDate = startDate <= endDate ? startDate : endDate;
    const upperDate = startDate <= endDate ? endDate : startDate;
    const maxUpperDate = addCalendarDays(
        lowerDate,
        GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS
    );
    if (upperDate <= maxUpperDate) {
        return [
            toGameLogDateInputValue(lowerDate),
            toGameLogDateInputValue(upperDate)
        ];
    }

    return [
        toGameLogDateInputValue(lowerDate),
        toGameLogDateInputValue(maxUpperDate)
    ];
}
