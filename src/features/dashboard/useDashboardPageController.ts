import { useMemo } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import { getDashboardRowKey } from './dashboardConfig';
import { useDashboardActions } from './useDashboardActions';
import { useDashboardEditorState } from './useDashboardEditorState';
import { useDashboardStoreState } from './useDashboardStoreState';

export function useDashboardPageController() {
    const store = useDashboardStoreState();
    const actions = useDashboardActions({
        dashboard: store.dashboard,
        dashboards: store.dashboards
    });
    const editor = useDashboardEditorState({
        consumeEditingDashboardId: store.consumeEditingDashboardId,
        dashboard: store.dashboard,
        loaded: store.loaded,
        saveDashboard: actions.saveDashboard
    });
    const dashboardRowPanelIds = useMemo(
        () =>
            (Array.isArray(store.dashboard?.rows)
                ? store.dashboard.rows
                : []
            ).map(
                (row: any) =>
                    `dashboard-${store.id}-row-panel-${getDashboardRowKey(row)}`
            ),
        [store.dashboard?.rows, store.id]
    );
    const dashboardLayout = useDefaultLayout({
        id: `dashboard-${store.id || 'empty'}`,
        panelIds: dashboardRowPanelIds
    });

    return {
        actions,
        dashboard: store.dashboard,
        dashboardLayout,
        dashboards: store.dashboards,
        detail: store.detail,
        editor,
        id: store.id,
        loaded: store.loaded,
        loadStatus: store.loadStatus
    };
}
