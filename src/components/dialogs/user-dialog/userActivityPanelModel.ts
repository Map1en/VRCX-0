import { USER_ACTIVITY_CONFIG_KEYS } from '@/repositories/configKeys';

export const ACTIVITY_SELF_PERIOD_KEY =
    USER_ACTIVITY_CONFIG_KEYS.selfPeriodDays;
export const ACTIVITY_FRIEND_PERIOD_KEY =
    USER_ACTIVITY_CONFIG_KEYS.friendPeriodDays;
export const ACTIVITY_SELF_TOP_WORLDS_SORT_KEY =
    USER_ACTIVITY_CONFIG_KEYS.selfTopWorldsSortBy;
export const ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY =
    USER_ACTIVITY_CONFIG_KEYS.selfExcludeHomeWorld;
export const OVERLAP_EXCLUDE_ENABLED_KEY =
    USER_ACTIVITY_CONFIG_KEYS.overlapExcludeEnabled;
export const OVERLAP_EXCLUDE_START_KEY =
    USER_ACTIVITY_CONFIG_KEYS.overlapExcludeStart;
export const OVERLAP_EXCLUDE_END_KEY =
    USER_ACTIVITY_CONFIG_KEYS.overlapExcludeEnd;

export const VALID_ACTIVITY_PERIODS = new Set(['7', '30', '90']);
export const USER_ACTIVITY_HOUR_LABELS = Array.from(
    { length: 24 },
    (_: any, index: any) => `${String(index).padStart(2, '0')}:00`
);
export const TOP_WORLDS_LOADING_DELAY_MS = 150;
export const OVERLAP_LOADING_DELAY_MS = 120;
export const OVERLAP_RENDER_DELAY_MS = 80;

export function getRangeDays(period: any) {
    return Number.parseInt(period, 10) || 30;
}

export function getDisplayDayLabels(dayLabels: any, weekStartsOn: any) {
    return Array.from(
        { length: 7 },
        (_: any, index: any) => dayLabels[(weekStartsOn + index) % 7]
    );
}

export function normalizeActivityPeriod(period: any) {
    return VALID_ACTIVITY_PERIODS.has(period) ? period : '30';
}

export function normalizeTopWorldsSort(sortBy: any) {
    return ['time', 'count'].includes(sortBy) ? sortBy : 'time';
}

export function getWorldThumbnailUrl(world: any) {
    const url = world?.thumbnailImageUrl || world?.imageUrl || '';
    return url ? url.replace('256', '128') : '';
}
