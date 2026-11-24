import { create } from 'zustand';

import type { LoadStatus } from '@/domain/shared/types';
import type { Dashboard } from '@/repositories/dashboardRepository';

type DashboardLoadStatus = LoadStatus;

interface DashboardStateSnapshot {
    dashboards: Dashboard[];
    loaded: boolean;
    loadStatus: DashboardLoadStatus;
    detail: string;
    editingDashboardId: string | null;
}

export interface DashboardStoreState extends DashboardStateSnapshot {
    getDashboard: (id: string) => Dashboard | null;
    setLoading: () => void;
    setDashboards: (dashboards: Dashboard[]) => void;
    setLoadFailed: (detail: string) => void;
    setDashboardsAfterDelete: (id: string, dashboards: Dashboard[]) => void;
    setEditingDashboardId: (id: string | null) => void;
    consumeEditingDashboardId: (id: string) => boolean;
    reset: () => void;
}

const initialState: DashboardStateSnapshot = {
    dashboards: [],
    loaded: false,
    loadStatus: 'idle',
    detail: '',
    editingDashboardId: null
};

export const useDashboardStore = create<DashboardStoreState>((set, get) => ({
    ...initialState,
    getDashboard(id) {
        const normalizedId = id.trim();
        if (!normalizedId) {
            return null;
        }

        return (
            get().dashboards.find(
                (dashboard) => dashboard.id === normalizedId
            ) || null
        );
    },
    setLoading() {
        set({
            loadStatus: 'running',
            detail: ''
        });
    },
    setDashboards(dashboards) {
        set({
            dashboards,
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
    },
    setLoadFailed(detail) {
        set({
            dashboards: [],
            loaded: false,
            loadStatus: 'error',
            detail
        });
    },
    setDashboardsAfterDelete(id, dashboards) {
        set((state) => ({
            dashboards,
            loaded: true,
            loadStatus: 'ready',
            detail: '',
            editingDashboardId:
                state.editingDashboardId === id
                    ? null
                    : state.editingDashboardId
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
    reset() {
        set(initialState);
    }
}));
