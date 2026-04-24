export function getTodayKey() {
    return toLocalDayKey(new Date());
}

export function toLocalDayKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function parseLocalDayKey(dayKey) {
    const [year, month, day] = String(dayKey || '')
        .split('-')
        .map((value) => Number.parseInt(value, 10) || 0);
    return new Date(year, Math.max(0, month - 1), day || 1, 0, 0, 0, 0);
}

export function formatDateLabel(dayKey) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        }).format(parseLocalDayKey(dayKey));
    } catch {
        return dayKey;
    }
}
