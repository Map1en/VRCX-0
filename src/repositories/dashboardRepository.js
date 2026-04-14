import configRepository from './configRepository.js';

import {
    DASHBOARD_STORAGE_KEY,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';

function generateDashboardRowId() {
    if (
        typeof crypto !== 'undefined' &&
        crypto &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }

    return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clonePanel(panel) {
    if (typeof panel === 'string' && panel) {
        return panel;
    }

    if (
        panel &&
        typeof panel === 'object' &&
        typeof panel.key === 'string' &&
        panel.key
    ) {
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

function cloneRows(rows, { generateMissingRowIds = true } = {}) {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map((row) => {
            const sourcePanels = Array.isArray(row?.panels)
                ? row.panels.slice(0, 2)
                : [];
            if (!sourcePanels.length) {
                return null;
            }

            const rowId =
                typeof row?.id === 'string' && row.id.trim()
                    ? row.id.trim()
                    : generateMissingRowIds
                        ? generateDashboardRowId()
                        : '';
            return {
                ...(rowId ? { id: rowId } : {}),
                panels: sourcePanels.map(clonePanel),
                direction: row?.direction === 'vertical' ? 'vertical' : 'horizontal'
            };
        })
        .filter(Boolean);
}

function sanitizeDashboard(dashboard, { generateMissingRowIds = true } = {}) {
    if (!dashboard || typeof dashboard !== 'object') {
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
    const icon =
        typeof dashboard.icon === 'string' && dashboard.icon.trim()
            ? dashboard.icon.trim()
            : DEFAULT_DASHBOARD_ICON;

    return {
        id,
        name,
        icon,
        rows: cloneRows(dashboard.rows, { generateMissingRowIds })
    };
}

class DashboardRepository {
    async getDashboards() {
        const stored = await configRepository.getString(DASHBOARD_STORAGE_KEY, null);
        if (!stored) {
            return [];
        }

        try {
            const parsed = JSON.parse(stored);
            const source = Array.isArray(parsed?.dashboards) ? parsed.dashboards : [];
            return source
                .map((dashboard) => sanitizeDashboard(dashboard, { generateMissingRowIds: false }))
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    async saveDashboards(dashboards = []) {
        const sanitizedDashboards = (Array.isArray(dashboards) ? dashboards : [])
            .map(sanitizeDashboard)
            .filter(Boolean);

        await configRepository.setString(
            DASHBOARD_STORAGE_KEY,
            JSON.stringify({ dashboards: sanitizedDashboards })
        );

        return sanitizedDashboards;
    }

    generateDashboardId() {
        if (
            typeof crypto !== 'undefined' &&
            crypto &&
            typeof crypto.randomUUID === 'function'
        ) {
            return crypto.randomUUID();
        }

        return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    generateNextDashboardName(dashboards = [], baseName = 'Dashboard') {
        const normalizedBaseName =
            typeof baseName === 'string' && baseName.trim() ? baseName.trim() : 'Dashboard';
        const existingNames = new Set(
            (Array.isArray(dashboards) ? dashboards : [])
                .map((dashboard) => dashboard?.name)
                .filter((name) => typeof name === 'string' && name)
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
}

const dashboardRepository = new DashboardRepository();

export { cloneRows, generateDashboardRowId, sanitizeDashboard, DashboardRepository };
export default dashboardRepository;
