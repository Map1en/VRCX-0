import type { DateTimeRangeValue } from '@/components/date-time-range-picker/DateTimeRangePicker';
import { DAY_MS } from '@/shared/constants/time';

const INSTANCE_HISTORY_DEFAULT_DAYS = 30;

type InstanceHistoryDateRangeSource = 'none' | 'default' | 'unbounded' | 'user';

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

export function buildDefaultInstanceHistoryDateRange(
    now: Date = new Date()
): DateTimeRangeValue {
    const to = new Date(now);
    return {
        from: new Date(to.getTime() - INSTANCE_HISTORY_DEFAULT_DAYS * DAY_MS),
        to
    };
}

export function buildLocalDayInstanceHistoryDateRange(
    dayKey: string
): DateTimeRangeValue {
    const [yearValue, monthValue, dayValue] = dayKey
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
        to: new Date(
            new Date(
                yearValue,
                monthValue - 1,
                dayValue + 1,
                0,
                0,
                0,
                0
            ).getTime() - 1
        )
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
}): InstanceHistoryDateRangeState {
    if (isDayMode) {
        return {
            range: emptyInstanceHistoryDateRange(),
            source: 'none'
        };
    }
    if (isSelfScope) {
        return {
            range: buildDefaultInstanceHistoryDateRange(now),
            source: 'default'
        };
    }
    return {
        range: emptyInstanceHistoryDateRange(),
        source: 'unbounded'
    };
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
    const { source } = state;
    if (isDayMode || source === 'user') {
        return state;
    }
    if (isSelfScope) {
        return source === 'default'
            ? state
            : {
                  range: buildDefaultInstanceHistoryDateRange(now),
                  source: 'default'
              };
    }
    return source === 'unbounded'
        ? state
        : {
              range: emptyInstanceHistoryDateRange(),
              source: 'unbounded'
          };
}

export function refreshDefaultInstanceHistoryDateRange(
    state: InstanceHistoryDateRangeState,
    now: Date = new Date()
): InstanceHistoryDateRangeState {
    if (state.source !== 'default') {
        return state;
    }
    return {
        range: buildDefaultInstanceHistoryDateRange(now),
        source: 'default'
    };
}
