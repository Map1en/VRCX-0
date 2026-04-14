import { create } from 'zustand';

import dashboardRepository, { sanitizeDashboard } from '@/repositories/dashboardRepository.js';
import { DEFAULT_DASHBOARD_ICON } from '@/shared/constants/dashboard.js';

const initialState = {
    dashboards: [],
    loaded: false,
    loadStatus: 'idle',
    detail: '',
    editingDashboardId: null
};

let loadPromise = null;

export const useDashboardStore = create((set, get) => ({
    ...initialState,
    async loadDashboards() {
        set({
            loadStatus: 'running',
            detail: ''
        });

        try {
            const dashboards = await dashboardRepository.getDashboards();
            set({
                dashboards,
                loaded: true,
                loadStatus: 'ready',
                detail: ''
            });
            return dashboards;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Failed to load dashboard configurations.';
            set({
                dashboards: [],
                loaded: true,
                loadStatus: 'error',
                detail: message
            });
            throw error;
        }
    },
    async ensureLoaded() {
        if (get().loaded) {
            return get().dashboards;
        }

        if (!loadPromise) {
            loadPromise = get()
                .loadDashboards()
                .finally(() => {
                    loadPromise = null;
                });
        }

        return loadPromise;
    },
    getDashboard(id) {
        const normalizedId = String(id || '').trim();
        if (!normalizedId) {
            return null;
        }

        return get().dashboards.find((dashboard) => dashboard.id === normalizedId) || null;
    },
    async createDashboard(baseName = 'Dashboard') {
        await get().ensureLoaded();

        const nextDashboard = sanitizeDashboard({
            id: dashboardRepository.generateDashboardId(),
            name: dashboardRepository.generateNextDashboardName(get().dashboards, baseName),
            icon: DEFAULT_DASHBOARD_ICON,
            rows: []
        });

        const dashboards = await dashboardRepository.saveDashboards([
            ...get().dashboards,
            nextDashboard
        ]);
        set({
            dashboards,
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });

        return nextDashboard;
    },
    async updateDashboard(id, updates = {}) {
        await get().ensureLoaded();

        const dashboards = get().dashboards;
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
        const savedDashboards = await dashboardRepository.saveDashboards(nextDashboards);

        set({
            dashboards: savedDashboards,
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });

        return nextDashboard;
    },
    async deleteDashboard(id) {
        await get().ensureLoaded();

        const nextDashboards = get().dashboards.filter((dashboard) => dashboard.id !== id);
        const savedDashboards = await dashboardRepository.saveDashboards(nextDashboards);

        set((state) => ({
            dashboards: savedDashboards,
            loaded: true,
            loadStatus: 'ready',
            detail: '',
            editingDashboardId:
                state.editingDashboardId === id ? null : state.editingDashboardId
        }));
    },
    setEditingDashboardId(id) {
        set({
            editingDashboardId: id || null
        });
    },
    consumeEditingDashboardId(id) {
        if (get().editingDashboardId !== id) {
            return false;
        }

        set({
            editingDashboardId: null
        });
        return true;
    },
    resetDashboardState() {
        loadPromise = null;
        set(initialState);
    }
}));
