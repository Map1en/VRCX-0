import { USER_ACTIVITY_CONFIG_KEYS } from '@/repositories/configKeys';

export const ACTIVITY_FRIEND_PERIOD_KEY =
    USER_ACTIVITY_CONFIG_KEYS.friendPeriodDays;
export const OVERLAP_EXCLUDE_ENABLED_KEY =
    USER_ACTIVITY_CONFIG_KEYS.overlapExcludeEnabled;
export const OVERLAP_EXCLUDE_START_KEY =
    USER_ACTIVITY_CONFIG_KEYS.overlapExcludeStart;
export const OVERLAP_EXCLUDE_END_KEY =
    USER_ACTIVITY_CONFIG_KEYS.overlapExcludeEnd;

export type ActivityHeatmapData = {
    normalizedBuckets: number[];
    rawBuckets: number[];
};

const ACTIVITY_PERIODS = ['7', '30', '90', '180', '365', 'all'] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];
const VALID_ACTIVITY_PERIODS = new Set<string>(ACTIVITY_PERIODS);
export const USER_ACTIVITY_HOUR_LABELS = Array.from(
    { length: 24 },
    (_, index) => `${String(index).padStart(2, '0')}:00`
);
export const OVERLAP_LOADING_DELAY_MS = 120;
export const OVERLAP_RENDER_DELAY_MS = 80;

export function getRangeDays(period: string | null | undefined) {
    if (period === 'all') {
        return 0;
    }
    const parsed = Number.parseInt(period ?? '', 10);
    return Number.isNaN(parsed) ? 30 : parsed;
}

export function getDisplayDayLabels(
    dayLabels: readonly string[],
    weekStartsOn: number
) {
    return Array.from(
        { length: 7 },
        (_, index) => dayLabels[(weekStartsOn + index) % 7]
    );
}

function isActivityPeriod(value: string): value is ActivityPeriod {
    return VALID_ACTIVITY_PERIODS.has(value);
}

export function normalizeActivityPeriod(period: string): ActivityPeriod {
    return isActivityPeriod(period) ? period : '30';
}
