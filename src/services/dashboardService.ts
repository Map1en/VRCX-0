import dashboardRepository, {
    sanitizeDashboard,
    type Dashboard
} from '@/repositories/dashboardRepository';
import { DEFAULT_DASHBOARD_ICON } from '@/shared/constants/dashboard';
import { useDashboardStore } from '@/state/dashboardStore';

let loadPromise: Promise<Dashboard[]> | null = null;

async function loadDashboards(): Promise<Dashboard[]> {
    const store = useDashboardStore.getState();
    store.setLoading();

    try {
        const dashboards = await dashboardRepository.getDashboards();
        store.setDashboards(dashboards);
        return dashboards;
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to load dashboard configurations.';
        store.setLoadFailed(message);
        throw error;
    }
}

export async function ensureDashboardsLoaded(): Promise<Dashboard[]> {
    const { loaded, dashboards } = useDashboardStore.getState();
    if (loaded) {
        return dashboards;
    }

    if (!loadPromise) {
        loadPromise = loadDashboards().finally(() => {
            loadPromise = null;
        });
    }

    return loadPromise;
}

export async function createDashboard(
    baseName = 'Dashboard'
): Promise<Dashboard> {
    await ensureDashboardsLoaded();

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
            'Dashboard creation produced an invalid configuration.'
        );
    }

    const dashboards = await dashboardRepository.saveDashboards([
        ...useDashboardStore.getState().dashboards,
        nextDashboard
    ]);
    useDashboardStore.getState().setDashboards(dashboards);

    return nextDashboard;
}

export async function updateDashboard(
    id: string,
    updates: Record<string, unknown> = {}
): Promise<Dashboard> {
    await ensureDashboardsLoaded();

    const dashboards = useDashboardStore.getState().dashboards;
    const index = dashboards.findIndex((dashboard) => dashboard.id === id);
    if (index < 0) {
        throw new Error('Dashboard not found.');
    }

    const nextDashboard = sanitizeDashboard({
        ...dashboards[index],
        ...updates,
        id
    });
    if (!nextDashboard) {
        throw new Error('Dashboard update produced an invalid configuration.');
    }

    const nextDashboards = dashboards.slice();
    nextDashboards[index] = nextDashboard;
    const savedDashboards =
        await dashboardRepository.saveDashboards(nextDashboards);

    useDashboardStore.getState().setDashboards(savedDashboards);

    return nextDashboard;
}

export async function deleteDashboard(id: string): Promise<void> {
    await ensureDashboardsLoaded();

    const nextDashboards = useDashboardStore
        .getState()
        .dashboards.filter((dashboard) => dashboard.id !== id);
    const savedDashboards =
        await dashboardRepository.saveDashboards(nextDashboards);

    useDashboardStore.getState().setDashboardsAfterDelete(id, savedDashboards);
}

export function resetDashboardState(): void {
    loadPromise = null;
    useDashboardStore.getState().reset();
}
