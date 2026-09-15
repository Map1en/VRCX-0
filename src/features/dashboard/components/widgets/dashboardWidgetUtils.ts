import type { DashboardConfig } from '@/features/dashboard/dashboardConfig';
import { formatDateFilter } from '@/lib/dateTime';

type WidgetTimestamp = string | null | undefined;

export function formatWidgetTime(value: WidgetTimestamp) {
    if (!value) {
        return '--';
    }

    try {
        return formatDateFilter(value, 'time');
    } catch {
        return value;
    }
}

export function formatWidgetDate(value: WidgetTimestamp) {
    if (!value) {
        return '--';
    }

    try {
        return formatDateFilter(value, 'date');
    } catch {
        return value;
    }
}

export function getWidgetDayKey(value: WidgetTimestamp) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) {
        return (value || '').slice(0, 10);
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

export function formatWidgetExactTime(value: WidgetTimestamp) {
    if (!value) {
        return '';
    }

    try {
        return formatDateFilter(value, 'long');
    } catch {
        return value;
    }
}

export function joinCompactParts(values: readonly string[] = []) {
    return values.filter(Boolean).join(' • ');
}

export function isDashboardWidgetFilterActive(
    config: DashboardConfig,
    filterType: string
) {
    const filters = Array.isArray(config?.filters) ? config.filters : [];
    return filters.length === 0 || filters.includes(filterType);
}

export function getNextDashboardWidgetFilterConfig(
    config: DashboardConfig,
    filterType: string,
    filterTypes: readonly string[]
) {
    const currentFilters = Array.isArray(config.filters)
        ? config.filters.filter(
              (entry): entry is string => typeof entry === 'string'
          )
        : [];
    let filters: string[];

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
