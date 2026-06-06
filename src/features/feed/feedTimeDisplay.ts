import type { TFunction } from 'i18next';

import { formatDateFilter, formatRelativeTime } from '@/lib/dateTime';
import type { FeedTimeDisplayModePreference } from '@/state/preferencesStore';

function parseTimestampMs(value: unknown) {
    if (!value) {
        return null;
    }

    const timestampMs = new Date(value as any).getTime();
    return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function formatFeedRelativeTime(
    value: unknown,
    nowMs: number,
    _t: TFunction
) {
    const timestampMs = parseTimestampMs(value);
    if (timestampMs === null) {
        return '-';
    }

    return formatRelativeTime(timestampMs, {
        nowMs,
        style: 'short'
    });
}

export function formatFeedExactTime(
    value: unknown,
    format: 'short' | 'long' = 'short'
) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, format);
}

export function resolveFeedColumnTimeDisplay({
    mode,
    nowMs,
    t,
    value
}: {
    mode: FeedTimeDisplayModePreference;
    nowMs: number;
    t: TFunction;
    value: unknown;
}) {
    if (mode === 'relative') {
        return {
            label: formatFeedRelativeTime(value, nowMs, t),
            title: formatFeedExactTime(value, 'long')
        };
    }

    return {
        label: formatFeedExactTime(value, 'short'),
        title: formatFeedRelativeTime(value, nowMs, t)
    };
}
