import type {
    ActivityCompanionOrder,
    ActivityPageAccessSlice,
    ActivityPageSummary,
    ActivityPageView
} from '@/repositories/activityPageRepository';
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

export function averageMinutesPerDay(summary: ActivityPageSummary): number {
    return summary.windowDays > 0
        ? Math.round(summary.totalMinutes / summary.windowDays)
        : 0;
}

export function changePercent(
    current: number,
    previous: number
): number | null {
    if (previous <= 0) {
        return null;
    }
    return Math.round(((current - previous) / previous) * 100);
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
