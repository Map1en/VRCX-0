import { formatDateFilter } from '@/lib/dateTime';
import { normalizeString } from '@/shared/utils/string';

export const MAX_WIDGET_ROWS = 50;

export function buildFavoriteIdSet(
    remoteFavoriteIds: any,
    localFriendFavorites: any
) {
    const ids = new Set();

    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeString(id);
        if (normalized) {
            ids.add(normalized);
        }
    }

    for (const values of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(values)) {
            continue;
        }

        for (const id of values) {
            const normalized = normalizeString(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }

    return ids;
}

export function formatWidgetTime(value: any) {
    if (!value) {
        return '--';
    }

    try {
        return formatDateFilter(value, 'short');
    } catch {
        return String(value);
    }
}

export function formatWidgetExactTime(value: any) {
    if (!value) {
        return '';
    }

    try {
        return formatDateFilter(value, 'long');
    } catch {
        return String(value);
    }
}

export function joinCompactParts(values: unknown[] = []) {
    return values.filter(Boolean).join(' • ');
}

export function isDashboardWidgetFilterActive(config: any, filterType: any) {
    const filters = Array.isArray(config?.filters) ? config.filters : [];
    return filters.length === 0 || filters.includes(filterType);
}

export function getNextDashboardWidgetFilterConfig(
    config: any,
    filterType: any,
    filterTypes: any
) {
    const currentFilters = Array.isArray(config?.filters) ? config.filters : [];
    let filters;

    if (currentFilters.length === 0) {
        filters = filterTypes.filter((entry: any) => entry !== filterType);
    } else if (currentFilters.includes(filterType)) {
        filters = currentFilters.filter((entry: any) => entry !== filterType);
        if (filters.length === 0) {
            filters = [];
        }
    } else {
        filters = [...currentFilters, filterType];
        if (filters.length === filterTypes.length) {
            filters = [];
        }
    }

    return {
        ...config,
        filters
    };
}
