import {
    DASHBOARD_STORAGE_KEY,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard';
import { normalizeNavIconKey } from '@/shared/constants/navIcons';

import configRepository from './configRepository';

export type DashboardDirection = 'horizontal' | 'vertical';
export type DashboardPanel =
    | string
    | {
          key: string;
          config: Record<string, unknown>;
      };

export interface DashboardRow {
    id?: string;
    panels: Array<DashboardPanel | null>;
    direction: DashboardDirection;
}

export interface Dashboard {
    id: string;
    name: string;
    icon: string;
    rows: DashboardRow[];
}

interface CloneRowsOptions {
    generateMissingRowIds?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function generateDashboardRowId(): string {
    if (
        typeof crypto !== 'undefined' &&
        crypto &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }

    return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clonePanel(panel: unknown): DashboardPanel | null {
    if (typeof panel === 'string' && panel) {
        return panel;
    }

    if (isRecord(panel) && typeof panel.key === 'string' && panel.key) {
        return {
            key: panel.key,
            config:
                panel.config && typeof panel.config === 'object'
                    ? JSON.parse(JSON.stringify(panel.config))
                    : {}
        };
    }

    return null;
}

function cloneRows(
    rows: unknown,
    { generateMissingRowIds = true }: CloneRowsOptions = {}
): DashboardRow[] {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map((row) => {
            const sourceRow = isRecord(row) ? row : null;
            const sourcePanels = Array.isArray(sourceRow?.panels)
                ? sourceRow.panels.slice(0, 2)
                : [];
            if (!sourcePanels.length) {
                return null;
            }

            const rowId =
                typeof sourceRow?.id === 'string' && sourceRow.id.trim()
                    ? sourceRow.id.trim()
                    : generateMissingRowIds
                      ? generateDashboardRowId()
                      : '';
            return {
                ...(rowId ? { id: rowId } : {}),
                panels: sourcePanels.map(clonePanel),
                direction:
                    sourceRow?.direction === 'vertical'
                        ? 'vertical'
                        : 'horizontal'
            };
        })
        .filter((row): row is DashboardRow => Boolean(row));
}

function sanitizeDashboard(
    dashboard: unknown,
    { generateMissingRowIds = true }: CloneRowsOptions = {}
): Dashboard | null {
    if (!isRecord(dashboard)) {
        return null;
    }

    const id =
        typeof dashboard.id === 'string' && dashboard.id.trim()
            ? dashboard.id.trim()
            : '';
    if (!id) {
        return null;
    }

    const name =
        typeof dashboard.name === 'string' && dashboard.name.trim()
            ? dashboard.name.trim()
            : 'Dashboard';
    const icon = normalizeNavIconKey(dashboard.icon, DEFAULT_DASHBOARD_ICON);

    return {
        id,
        name,
        icon,
        rows: cloneRows(dashboard.rows, { generateMissingRowIds })
    };
}

async function getDashboards(): Promise<Dashboard[]> {
    const stored = await configRepository.getString(
        DASHBOARD_STORAGE_KEY,
        null
    );
    if (!stored) {
        return [];
    }

    try {
        const parsed = JSON.parse(String(stored));
        const source = Array.isArray(parsed?.dashboards)
            ? parsed.dashboards
            : [];
        return (source as unknown[])
            .map((dashboard) =>
                sanitizeDashboard(dashboard, { generateMissingRowIds: false })
            )
            .filter((dashboard): dashboard is Dashboard => Boolean(dashboard));
    } catch {
        return [];
    }
}

async function saveDashboards(
    dashboards: unknown[] = []
): Promise<Dashboard[]> {
    const sanitizedDashboards = (Array.isArray(dashboards) ? dashboards : [])
        .map((dashboard) => sanitizeDashboard(dashboard))
        .filter((dashboard): dashboard is Dashboard => Boolean(dashboard));

    await configRepository.setString(
        DASHBOARD_STORAGE_KEY,
        JSON.stringify({ dashboards: sanitizedDashboards })
    );

    return sanitizedDashboards;
}

function generateDashboardId(): string {
    if (
        typeof crypto !== 'undefined' &&
        crypto &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }

    return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateNextDashboardName(
    dashboards: unknown[] = [],
    baseName: unknown = 'Dashboard'
): string {
    const normalizedBaseName =
        typeof baseName === 'string' && baseName.trim()
            ? baseName.trim()
            : 'Dashboard';
    const existingNames = new Set(
        (Array.isArray(dashboards) ? dashboards : [])
            .map((dashboard) => (isRecord(dashboard) ? dashboard.name : ''))
            .filter(
                (name): name is string =>
                    typeof name === 'string' && Boolean(name)
            )
    );

    if (!existingNames.has(normalizedBaseName)) {
        return normalizedBaseName;
    }

    let index = 1;
    while (existingNames.has(`${normalizedBaseName} ${index}`)) {
        index += 1;
    }

    return `${normalizedBaseName} ${index}`;
}

const dashboardRepository = Object.freeze({
    getDashboards,
    saveDashboards,
    generateDashboardId,
    generateNextDashboardName
});

export {
    cloneRows,
    generateDashboardRowId,
    sanitizeDashboard,
    getDashboards,
    saveDashboards,
    generateDashboardId,
    generateNextDashboardName
};
export default dashboardRepository;
