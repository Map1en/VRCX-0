import dashboardRepository, {
    sanitizeDashboard,
    type Dashboard
} from '@/repositories/dashboardRepository';
import i18n from '@/services/i18nService';
import { DEFAULT_DASHBOARD_ICON } from '@/shared/constants/dashboard';
import { useDashboardStore } from '@/state/dashboardStore';

let loadPromise: Promise<Dashboard[]> | null = null;
let dashboardGeneration = 0;

async function loadDashboards(): Promise<Dashboard[]> {
    const generation = dashboardGeneration;
    const store = useDashboardStore.getState();
    store.setLoading();

    try {
        const dashboards = await dashboardRepository.getDashboards();
        if (generation === dashboardGeneration) {
            store.setDashboards(dashboards);
        }
        return dashboards;
    } catch (error) {
        if (generation === dashboardGeneration) {
            const message =
                error instanceof Error
                    ? error.message
                    : i18n.t(
                          'view.dashboard.toast.failed_to_load_dashboard_configuration'
                      );
            store.setLoadFailed(message);
        }
        throw error;
    }
}

async function ensureLoadedForMutation(): Promise<number> {
    const generation = dashboardGeneration;
    await ensureDashboardsLoaded();
    if (generation !== dashboardGeneration) {
        throw new Error(
            i18n.t('view.dashboard.error.changes_not_saved_after_reset')
        );
    }
    return generation;
}

export async function ensureDashboardsLoaded(): Promise<Dashboard[]> {
    const { loaded, dashboards } = useDashboardStore.getState();
    if (loaded) {
        return dashboards;
    }

    if (!loadPromise) {
        const pending = loadDashboards().finally(() => {
            if (loadPromise === pending) {
                loadPromise = null;
            }
        });
        loadPromise = pending;
    }

    return loadPromise;
}

export async function createDashboard(
    baseName = 'Dashboard'
): Promise<Dashboard> {
    const generation = await ensureLoadedForMutation();

    const nextDashboard = sanitizeDashboard({
        id: dashboardRepository.generateDashboardId(),
        name: dashboardRepository.generateNextDashboardName(
            useDashboardStore.getState().dashboards,
            baseName
        ),
        icon: DEFAULT_DASHBOARD_ICON,
        rows: []
    });
    if (!nextDashboard) {
        throw new Error(
            i18n.t('view.dashboard.error.create_produced_invalid_config')
        );
    }

    const dashboards = await dashboardRepository.saveDashboards([
        ...useDashboardStore.getState().dashboards,
        nextDashboard
    ]);
    if (generation === dashboardGeneration) {
        useDashboardStore.getState().setDashboards(dashboards);
    }

    return nextDashboard;
}

export async function updateDashboard(
    id: string,
    updates: Record<string, unknown> = {}
): Promise<Dashboard> {
    const generation = await ensureLoadedForMutation();

    const dashboards = useDashboardStore.getState().dashboards;
    const index = dashboards.findIndex((dashboard) => dashboard.id === id);
    if (index < 0) {
        throw new Error(i18n.t('view.dashboard.error.dashboard_not_found'));
    }

    const nextDashboard = sanitizeDashboard({
        ...dashboards[index],
        ...updates,
        id
    });
    if (!nextDashboard) {
        throw new Error(
            i18n.t('view.dashboard.error.update_produced_invalid_config')
        );
    }

    const nextDashboards = dashboards.slice();
    nextDashboards[index] = nextDashboard;
    const savedDashboards =
        await dashboardRepository.saveDashboards(nextDashboards);

    if (generation === dashboardGeneration) {
        useDashboardStore.getState().setDashboards(savedDashboards);
    }

    return nextDashboard;
}

export async function deleteDashboard(id: string): Promise<void> {
    const generation = await ensureLoadedForMutation();

    const nextDashboards = useDashboardStore
        .getState()
        .dashboards.filter((dashboard) => dashboard.id !== id);
    const savedDashboards =
        await dashboardRepository.saveDashboards(nextDashboards);

    if (generation === dashboardGeneration) {
        useDashboardStore
            .getState()
            .setDashboardsAfterDelete(id, savedDashboards);
    }
}

export function resetDashboardState(): void {
    dashboardGeneration += 1;
    loadPromise = null;
    useDashboardStore.getState().reset();
}
