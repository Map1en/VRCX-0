import { formatDateTime } from '@/lib/dateTime';

export function getTodayKey() {
    return toLocalDayKey(new Date());
}

export function toLocalDayKey(value: Date | string | number) {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time) || time <= 0) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function parseLocalDayKey(dayKey: string) {
    const [year, month, day] = String(dayKey || '')
        .split('-')
        .map((value: string) => Number.parseInt(value, 10) || 0);
    return new Date(year, Math.max(0, month - 1), day || 1, 0, 0, 0, 0);
}

export function formatDateLabel(dayKey: string) {
    const formatted = formatDateTime(
        parseLocalDayKey(dayKey),
        {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        },
        { fallback: String(dayKey || '') }
    );
    return formatted || String(dayKey || '');
}
