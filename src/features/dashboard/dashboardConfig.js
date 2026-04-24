import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS,
    DASHBOARD_SELECTABLE_PAGE_DEFINITIONS,
    DASHBOARD_WIDGET_DEFINITIONS,
    getDashboardPanelDefinition,
    getDashboardPanelLabel
} from '@/components/dashboard/dashboardRegistry.js';

const DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS = new Set(
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => column.key)
);

export function cloneDashboardRows(rows) {
    return JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []));
}

export function getDashboardRowKey(row) {
    if (typeof row?.id === 'string' && row.id.trim()) {
        return row.id.trim();
    }

    const source = JSON.stringify({
        direction: row?.direction === 'vertical' ? 'vertical' : 'horizontal',
        panels: Array.isArray(row?.panels)
            ? row.panels.map((panel) =>
                  typeof panel === 'string' ? panel : panel?.key || ''
              )
            : []
    });
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    }
    return `legacy-${hash.toString(36)}`;
}

export function createDashboardPanelSelectOptions(currentPanelKey, t) {
    const options = [
        ...DASHBOARD_WIDGET_DEFINITIONS.map((definition) => ({
            value: definition.key,
            label: t('view.dashboard.generated_dynamic.widget_value', { value: getDashboardPanelLabel(definition, t) })
        })),
        ...DASHBOARD_SELECTABLE_PAGE_DEFINITIONS.map((definition) => ({
            value: definition.key,
            label: t('view.dashboard.generated_dynamic.page_value', { value: getDashboardPanelLabel(definition, t) })
        }))
    ];

    if (
        currentPanelKey &&
        currentPanelKey !== '__none__' &&
        !options.some((option) => option.value === currentPanelKey)
    ) {
        options.unshift({
            value: currentPanelKey,
            label: t('view.dashboard.generated_dynamic.existing_value', { value: getDashboardPanelLabel(getDashboardPanelDefinition(currentPanelKey), t) || currentPanelKey })
        });
    }

    return options;
}

export function getDashboardPanelConfig(panel) {
    if (!panel || typeof panel !== 'object') {
        return {};
    }

    return panel.config && typeof panel.config === 'object' ? panel.config : {};
}

export function cloneDashboardConfig(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    return JSON.parse(JSON.stringify(value));
}

export function createDashboardWidgetPanelValue(panelKey, config) {
    return {
        key: panelKey,
        config: cloneDashboardConfig(config)
    };
}

export function getDashboardFilterList(config) {
    return Array.isArray(config?.filters) ? config.filters : [];
}

export function isDashboardFilterActive(config, filterType) {
    const filters = getDashboardFilterList(config);
    return filters.length === 0 || filters.includes(filterType);
}

export function getNextDashboardFilterConfig(config, filterType, filterTypes) {
    const currentFilters = getDashboardFilterList(config);
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

export function getDashboardInstanceWidgetColumns(config) {
    const source = Array.isArray(config?.columns)
        ? config.columns
        : DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;
    const columns = source.filter(
        (column, index, values) =>
            typeof column === 'string' &&
            column &&
            values.indexOf(column) === index
    );

    if (!columns.includes('displayName')) {
        columns.unshift('displayName');
    }

    return columns.length
        ? columns
        : [...DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS];
}

export function getKnownDashboardInstanceWidgetColumns(config) {
    const columns = getDashboardInstanceWidgetColumns(config).filter((column) =>
        DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS.has(column)
    );

    if (!columns.includes('displayName')) {
        columns.unshift('displayName');
    }

    return columns.length
        ? columns
        : [...DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS];
}

export function getNextDashboardInstanceColumnConfig(config, columnKey) {
    if (columnKey === 'displayName') {
        return config;
    }

    const sourceColumns = getDashboardInstanceWidgetColumns(config);
    const unknownColumns = sourceColumns.filter(
        (column) => !DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS.has(column)
    );
    const knownColumns = getKnownDashboardInstanceWidgetColumns(config);
    const nextKnownColumns = knownColumns.includes(columnKey)
        ? knownColumns.filter((column) => column !== columnKey)
        : [...knownColumns, columnKey];

    if (!nextKnownColumns.includes('displayName')) {
        nextKnownColumns.unshift('displayName');
    }

    return {
        ...config,
        columns: [...nextKnownColumns, ...unknownColumns]
    };
}
