import type {
    ActivityCompanionOrder,
    ActivityPageAccessSlice,
    ActivityPageSummary,
    ActivityPageView
} from '@/platform/tauri/bindings';
import { ACTIVITY_PAGE_CONFIG_KEYS } from '@/repositories/configKeys';

export const ACTIVITY_PAGE_RANGE_KEY = ACTIVITY_PAGE_CONFIG_KEYS.range;
export const ACTIVITY_PAGE_SHOW_HOME_KEY =
    ACTIVITY_PAGE_CONFIG_KEYS.showHomeWorld;
export const ACTIVITY_PAGE_COMPANION_ORDER_KEY =
    ACTIVITY_PAGE_CONFIG_KEYS.companionOrder;

export const DEFAULT_COMPANION_ORDER: ActivityCompanionOrder = 'minutes';

export function normalizeCompanionOrder(
    value: string | null
): ActivityCompanionOrder {
    return value === 'days' || value === 'minutes'
        ? value
        : DEFAULT_COMPANION_ORDER;
}

export function homeWorldIdFrom(homeLocation: unknown): string {
    const value = typeof homeLocation === 'string' ? homeLocation.trim() : '';
    return value.startsWith('wrld_') ? value.split(':')[0] : '';
}

const ACTIVITY_RANGES = ['all', '30', '90', '180', '365'] as const;

export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export const ACTIVITY_RANGE_OPTIONS: readonly ActivityRange[] = ACTIVITY_RANGES;

export const DEFAULT_ACTIVITY_RANGE: ActivityRange = '30';

export function normalizeActivityRange(value: string | null): ActivityRange {
    return ACTIVITY_RANGES.includes(value as ActivityRange)
        ? (value as ActivityRange)
        : DEFAULT_ACTIVITY_RANGE;
}

export function rangeDaysFor(range: ActivityRange): number {
    return range === 'all' ? 0 : Number.parseInt(range, 10);
}

export function utcOffsetMinutes(): number {
    return -new Date().getTimezoneOffset();
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export type ActivityWindowOverride = {
    rangeDays: number;
    windowToMs: number;
    custom: boolean;
};

export function localDayEndMs(ms: number, offsetMinutes: number): number {
    const offsetMs = offsetMinutes * MINUTE_MS;
    return Math.floor((ms + offsetMs) / DAY_MS) * DAY_MS + DAY_MS - offsetMs;
}

export function windowEndsNow(view: ActivityPageView, nowMs: number): boolean {
    return view.windowToMs >= localDayEndMs(nowMs, view.utcOffsetMinutes);
}

export function canPageBack(view: ActivityPageView): boolean {
    const firstSourceMs = Date.parse(view.coverage.firstSourceAt);
    return (
        view.rangeDays > 0 &&
        Number.isFinite(firstSourceMs) &&
        firstSourceMs < view.windowFromMs
    );
}

export function previousWindow(
    view: ActivityPageView,
    override: ActivityWindowOverride | null
): ActivityWindowOverride {
    return {
        rangeDays: view.rangeDays,
        windowToMs: view.windowFromMs,
        custom: override?.custom ?? false
    };
}

export function nextWindow(
    view: ActivityPageView,
    override: ActivityWindowOverride | null,
    nowMs: number
): ActivityWindowOverride | null {
    const currentEndMs = localDayEndMs(nowMs, view.utcOffsetMinutes);
    const nextToMs = Math.min(
        view.windowToMs + view.rangeDays * DAY_MS,
        currentEndMs
    );
    const custom = override?.custom ?? false;
    if (nextToMs >= currentEndMs && !custom) {
        return null;
    }
    return { rangeDays: view.rangeDays, windowToMs: nextToMs, custom };
}

export function customWindow(
    from: Date,
    to: Date,
    offsetMinutes: number
): ActivityWindowOverride {
    const fromDay = Date.UTC(
        from.getFullYear(),
        from.getMonth(),
        from.getDate()
    );
    const toDay = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    const startDay = Math.min(fromDay, toDay);
    const endDay = Math.max(fromDay, toDay);
    return {
        rangeDays: Math.round((endDay - startDay) / DAY_MS) + 1,
        windowToMs: endDay + DAY_MS - offsetMinutes * MINUTE_MS,
        custom: true
    };
}

export function parseLocalDate(dateKey: string): Date {
    const [year, month, day] = dateKey
        .split('-')
        .map((value) => Number.parseInt(value, 10) || 0);
    return new Date(year, Math.max(0, month - 1), day || 1);
}

function endOfLocalDay(date: Date): Date {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
}

export function localDateRange(
    startDate: string,
    endDate: string
): { from: Date; to: Date } {
    return {
        from: parseLocalDate(startDate),
        to: endOfLocalDay(parseLocalDate(endDate))
    };
}

function dateKeyAt(ms: number, offsetMinutes: number): string {
    return new Date(ms + offsetMinutes * MINUTE_MS).toISOString().slice(0, 10);
}

export function windowDateRange(
    override: ActivityWindowOverride,
    offsetMinutes: number
): { from: Date; to: Date } {
    return localDateRange(
        dateKeyAt(
            override.windowToMs - override.rangeDays * DAY_MS,
            offsetMinutes
        ),
        dateKeyAt(override.windowToMs - 1, offsetMinutes)
    );
}

export type ActivityPeriodDirection = 'more' | 'less' | 'same';

export function periodDirection(
    currentMinutes: number,
    previousMinutes: number
): ActivityPeriodDirection {
    if (currentMinutes === previousMinutes) {
        return 'same';
    }
    return currentMinutes > previousMinutes ? 'more' : 'less';
}

export function averageMinutesPerDay(summary: ActivityPageSummary): number {
    return summary.windowDays > 0
        ? Math.round(summary.totalMinutes / summary.windowDays)
        : 0;
}

export function accessShare(minutes: number, totalMinutes: number): number {
    return totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0;
}

export function hasAnyActivity(view: ActivityPageView | null): boolean {
    return Boolean(view && view.summary.totalMinutes > 0);
}

export function accessBucketLabelKey(access: string): string {
    return `view.activity.access.${access}`;
}

const HOURS_PER_DAY = 24;
const LATE_NIGHT_HOURS = [0, 1, 2, 3, 4, 5];

const MIN_ACCESS_SHARE_PERCENT = 1;

export function visibleAccessSlices(
    slices: readonly ActivityPageAccessSlice[]
): ActivityPageAccessSlice[] {
    const totalMinutes = slices.reduce((sum, slice) => sum + slice.minutes, 0);
    return slices.filter(
        (slice) =>
            accessShare(slice.minutes, totalMinutes) >= MIN_ACCESS_SHARE_PERCENT
    );
}

export function normalizeHeatmapBuckets(
    rawBuckets: readonly number[]
): number[] {
    const active = rawBuckets
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
    if (active.length === 0) {
        return rawBuckets.map(() => 0);
    }
    return rawBuckets.map((value) => {
        if (value <= 0) {
            return 0;
        }
        const rank = active.filter((sample) => sample <= value).length;
        return rank / active.length;
    });
}

export function hourTotals(rawBuckets: readonly number[]): number[] {
    const totals = Array.from({ length: HOURS_PER_DAY }, () => 0);
    if (rawBuckets.length < 7 * HOURS_PER_DAY) {
        return totals;
    }
    for (let day = 0; day < 7; day += 1) {
        for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
            totals[hour] += rawBuckets[day * HOURS_PER_DAY + hour] || 0;
        }
    }
    return totals;
}

export function peakHour(rawBuckets: readonly number[]): number | null {
    const totals = hourTotals(rawBuckets);
    let bestHour = -1;
    let bestTotal = 0;
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
        if (totals[hour] > bestTotal) {
            bestHour = hour;
            bestTotal = totals[hour];
        }
    }
    return bestHour >= 0 ? bestHour : null;
}

export function lateNightShare(rawBuckets: readonly number[]): number {
    if (rawBuckets.length < 7 * HOURS_PER_DAY) {
        return 0;
    }
    let lateNight = 0;
    let total = 0;
    for (let day = 0; day < 7; day += 1) {
        for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
            const value = rawBuckets[day * HOURS_PER_DAY + hour] || 0;
            total += value;
            if (LATE_NIGHT_HOURS.includes(hour)) {
                lateNight += value;
            }
        }
    }
    return total > 0 ? Math.round((lateNight / total) * 100) : 0;
}
