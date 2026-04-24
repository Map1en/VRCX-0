import { formatDateFilter } from '@/lib/dateTime.js';

export const MAX_WIDGET_ROWS = 50;

export function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function buildFavoriteIdSet(remoteFavoriteIds, localFriendFavorites) {
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

export function formatWidgetTime(value) {
    if (!value) {
        return '--';
    }

    try {
        return formatDateFilter(value, 'short');
    } catch {
        return String(value);
    }
}

export function formatWidgetExactTime(value) {
    if (!value) {
        return '';
    }

    try {
        return formatDateFilter(value, 'long');
    } catch {
        return String(value);
    }
}

export function joinCompactParts(values = []) {
    return values.filter(Boolean).join(' • ');
}

export function isDashboardWidgetFilterActive(config, filterType) {
    const filters = Array.isArray(config?.filters) ? config.filters : [];
    return filters.length === 0 || filters.includes(filterType);
}

export function getNextDashboardWidgetFilterConfig(
    config,
    filterType,
    filterTypes
) {
    const currentFilters = Array.isArray(config?.filters) ? config.filters : [];
    let filters;

    if (currentFilters.length === 0) {
        filters = filterTypes.filter((entry) => entry !== filterType);
    } else if (currentFilters.includes(filterType)) {
        filters = currentFilters.filter((entry) => entry !== filterType);
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
