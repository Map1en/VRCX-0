import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS,
    DASHBOARD_SELECTABLE_PAGE_DEFINITIONS,
    DASHBOARD_WIDGET_DEFINITIONS,
    getDashboardPanelDefinition,
    getDashboardPanelLabel
} from '@/components/dashboard/dashboardRegistry';
import {
    cloneRows as cloneRepositoryDashboardRows,
    type DashboardPanel,
    type DashboardRow
} from '@/repositories/dashboardRepository';

const DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS = new Set(
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => column.key)
);

type DashboardWidgetPanel = Exclude<DashboardPanel, string>;

type DashboardConfig = DashboardWidgetPanel['config'];

type DashboardTranslate = (
    key: string,
    options?: Record<string, unknown>
) => string;

type DashboardPanelSelectOption = {
    value: string;
    label: string;
};

function isDashboardConfig(value: unknown): value is DashboardConfig {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function cloneDashboardRows(rows: unknown): DashboardRow[] {
    return cloneRepositoryDashboardRows(rows, { generateMissingRowIds: false });
}

export function getDashboardRowKey(row: Partial<DashboardRow> | null) {
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

export function createDashboardPanelSelectOptions(
    currentPanelKey: unknown,
    t: DashboardTranslate
): DashboardPanelSelectOption[] {
    const options = [
        ...DASHBOARD_WIDGET_DEFINITIONS.map((definition) => ({
            value: definition.key,
            label: t('view.dashboard.dynamic.widget_value', {
                value: getDashboardPanelLabel(definition, t)
            })
        })),
        ...DASHBOARD_SELECTABLE_PAGE_DEFINITIONS.map((definition) => ({
            value: definition.key,
            label: t('view.dashboard.dynamic.page_value', {
                value: getDashboardPanelLabel(definition, t)
            })
        }))
    ];

    if (
        currentPanelKey &&
        currentPanelKey !== '__none__' &&
        !options.some((option) => option.value === currentPanelKey)
    ) {
        options.unshift({
            value: String(currentPanelKey),
            label: t('view.dashboard.dynamic.existing_value', {
                value:
                    getDashboardPanelLabel(
                        getDashboardPanelDefinition(currentPanelKey),
                        t
                    ) || currentPanelKey
            })
        });
    }

    return options;
}

export function getDashboardPanelConfig(panel: unknown): DashboardConfig {
    if (!isDashboardConfig(panel)) {
        return {};
    }

    return isDashboardConfig(panel.config) ? panel.config : {};
}

export function cloneDashboardConfig(value: unknown): DashboardConfig {
    if (!isDashboardConfig(value)) {
        return {};
    }

    const cloned: unknown = JSON.parse(JSON.stringify(value));
    return isDashboardConfig(cloned) ? cloned : {};
}

export function createDashboardWidgetPanelValue(
    panelKey: string,
    config: unknown
): DashboardWidgetPanel {
    return {
        key: panelKey,
        config: cloneDashboardConfig(config)
    };
}

export function getDashboardFilterList(
    config: DashboardConfig | null | undefined
): unknown[] {
    return Array.isArray(config?.filters) ? config.filters : [];
}

export function isDashboardFilterActive(
    config: DashboardConfig | null | undefined,
    filterType: string
): boolean {
    const filters = getDashboardFilterList(config);
    return filters.length === 0 || filters.includes(filterType);
}

export function getNextDashboardFilterConfig(
    config: DashboardConfig,
    filterType: string,
    filterTypes: readonly string[]
): DashboardConfig & { filters: unknown[] } {
    const currentFilters = getDashboardFilterList(config);
    let filters: unknown[];

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

export function getDashboardInstanceWidgetColumns(
    config: DashboardConfig | null | undefined
): string[] {
    const source: readonly unknown[] = Array.isArray(config?.columns)
        ? config.columns
        : DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;
    const columns = source.filter(
        (column, index, values): column is string =>
            typeof column === 'string' &&
            column.length > 0 &&
            values.indexOf(column) === index
    );

    if (!columns.includes('displayName')) {
        columns.unshift('displayName');
    }

    return columns.length
        ? columns
        : [...DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS];
}

export function getKnownDashboardInstanceWidgetColumns(
    config: DashboardConfig | null | undefined
): string[] {
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

export function getNextDashboardInstanceColumnConfig(
    config: DashboardConfig,
    columnKey: string
): DashboardConfig & { columns?: string[] } {
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
