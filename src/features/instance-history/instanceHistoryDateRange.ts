import type { DateTimeRangeValue } from '@/components/date-time-range-picker/DateTimeRangePicker';
import { DAY_MS } from '@/shared/constants/time';

export const INSTANCE_HISTORY_SELF_DEFAULT_DAYS = 30;

export type InstanceHistoryDateRangeSource = 'none' | 'defaultSelf' | 'user';

export type InstanceHistoryDateRangeState = {
    range: DateTimeRangeValue;
    source: InstanceHistoryDateRangeSource;
};

export function emptyInstanceHistoryDateRange(): DateTimeRangeValue {
    return { from: null, to: null };
}

export function isEmptyInstanceHistoryDateRange(
    range: DateTimeRangeValue
): boolean {
    return !range.from && !range.to;
}

export function buildDefaultSelfInstanceHistoryDateRange(
    now: Date = new Date()
): DateTimeRangeValue {
    const to = new Date(now);
    return {
        from: new Date(
            to.getTime() - INSTANCE_HISTORY_SELF_DEFAULT_DAYS * DAY_MS
        ),
        to
    };
}

export function buildLocalDayInstanceHistoryDateRange(
    dayKey: string
): DateTimeRangeValue {
    const [yearValue, monthValue, dayValue] = String(dayKey || '')
        .split('-')
        .map((value) => Number.parseInt(value, 10));
    if (
        !Number.isInteger(yearValue) ||
        !Number.isInteger(monthValue) ||
        !Number.isInteger(dayValue)
    ) {
        return emptyInstanceHistoryDateRange();
    }

    const from = new Date(yearValue, monthValue - 1, dayValue, 0, 0, 0, 0);
    if (
        from.getFullYear() !== yearValue ||
        from.getMonth() !== monthValue - 1 ||
        from.getDate() !== dayValue
    ) {
        return emptyInstanceHistoryDateRange();
    }

    return {
        from,
        to: new Date(from.getTime() + DAY_MS - 1)
    };
}

export function resolveClearedInstanceHistoryDateRange({
    isDayMode,
    isSelfScope,
    now = new Date()
}: {
    isDayMode: boolean;
    isSelfScope: boolean;
    now?: Date;
}): DateTimeRangeValue {
    return isSelfScope && !isDayMode
        ? buildDefaultSelfInstanceHistoryDateRange(now)
        : emptyInstanceHistoryDateRange();
}

export function resolveScopedInstanceHistoryDateRange({
    isDayMode,
    isSelfScope,
    state,
    now = new Date()
}: {
    isDayMode: boolean;
    isSelfScope: boolean;
    state: InstanceHistoryDateRangeState;
    now?: Date;
}): InstanceHistoryDateRangeState {
    const { range, source } = state;
    if (isDayMode) {
        return state;
    }
    if (
        isSelfScope &&
        source === 'none' &&
        isEmptyInstanceHistoryDateRange(range)
    ) {
        return {
            range: buildDefaultSelfInstanceHistoryDateRange(now),
            source: 'defaultSelf'
        };
    }
    if (!isSelfScope && source === 'defaultSelf') {
        return {
            range: emptyInstanceHistoryDateRange(),
            source: 'none'
        };
    }
    return state;
}

export function refreshDefaultSelfInstanceHistoryDateRange(
    state: InstanceHistoryDateRangeState,
    now: Date = new Date()
): InstanceHistoryDateRangeState {
    if (state.source !== 'defaultSelf') {
        return state;
    }
    return {
        range: buildDefaultSelfInstanceHistoryDateRange(now),
        source: 'defaultSelf'
    };
}
