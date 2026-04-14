import { DEFAULT_TIME_UNIT_LABELS, useShellStore } from '@/state/shellStore.js';

function padZero(num) {
    return String(num).padStart(2, '0');
}

function toIsoLong(date) {
    const y = date.getFullYear();
    const m = padZero(date.getMonth() + 1);
    const d = padZero(date.getDate());
    const hh = padZero(date.getHours());
    const mm = padZero(date.getMinutes());
    const ss = padZero(date.getSeconds());
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function normalizeDateLocale(locale) {
    if (!locale) {
        return 'en-gb';
    }

    const dateLocale = String(locale).replace('_', '-');
    return dateLocale || 'en-gb';
}

function toLocalShort(date, dateFormat, hour12) {
    return date
        .toLocaleDateString(dateFormat, {
            month: '2-digit',
            day: '2-digit',
            hour: 'numeric',
            minute: 'numeric',
            hourCycle: hour12 ? 'h12' : 'h23'
        })
        .replace(' AM', 'am')
        .replace(' PM', 'pm')
        .replace(',', '');
}

function toLocalLong(date, dateFormat, hour12) {
    return date.toLocaleDateString(dateFormat, {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hourCycle: hour12 ? 'h12' : 'h23'
    });
}

function toLocalTime(date, dateFormat, hour12) {
    return date.toLocaleTimeString(dateFormat, {
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: hour12 ? 'h12' : 'h23'
    });
}

function toLocalDate(date, dateFormat) {
    return date.toLocaleDateString(dateFormat, {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
}

export function formatDateFilter(dateStr, format) {
    if (!dateStr) {
        return '-';
    }

    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) {
        return '-';
    }

    const { dateCulture, dateIsoFormat, dateHour12 } = useShellStore.getState();
    const dateFormat = dateIsoFormat ? 'en-gb' : normalizeDateLocale(dateCulture);

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

export function timeToText(sec, isNeedSeconds = false) {
    let n = Number(sec);
    if (Number.isNaN(n)) {
        return String(sec);
    }

    n = Math.floor(n / 1000);
    const arr = [];
    if (n < 0) {
        n = -n;
    }
    const labels = {
        ...DEFAULT_TIME_UNIT_LABELS,
        ...useShellStore.getState().timeUnitLabels
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
