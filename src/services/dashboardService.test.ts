import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDashboards: vi.fn(),
    saveDashboards: vi.fn()
}));

vi.mock('@/repositories/dashboardRepository', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/repositories/dashboardRepository')
        >();
    return {
        ...actual,
        default: {
            ...actual.default,
            getDashboards: mocks.getDashboards,
            saveDashboards: mocks.saveDashboards
        }
    };
});

import i18n from '@/services/i18nService';
import { DEFAULT_DASHBOARD_ICON } from '@/shared/constants/dashboard';
import { useDashboardStore } from '@/state/dashboardStore';

import {
    createDashboard,
    deleteDashboard,
    ensureDashboardsLoaded,
    resetDashboardState,
    updateDashboard
} from './dashboardService';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

const existingDashboard = {
    id: 'dashboard-main',
    name: 'Main',
    icon: 'lucide:LayoutDashboard',
    rows: []
};

describe('dashboardStore persistence ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetDashboardState();
    });

    it('coalesces concurrent initial loads through one repository request', async () => {
        const load = deferred<(typeof existingDashboard)[]>();
        mocks.getDashboards.mockReturnValue(load.promise);

        const first = ensureDashboardsLoaded();
        const second = ensureDashboardsLoaded();

        expect(mocks.getDashboards).toHaveBeenCalledTimes(1);
        expect(useDashboardStore.getState().loadStatus).toBe('running');

        load.resolve([existingDashboard]);

        await expect(first).resolves.toEqual([existingDashboard]);
        await expect(second).resolves.toEqual([existingDashboard]);
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
    });

    it('keeps the previous mirror until a dashboard update is persisted', async () => {
        useDashboardStore.setState({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
        const save = deferred<(typeof existingDashboard)[]>();
        mocks.saveDashboards.mockReturnValue(save.promise);

        const update = updateDashboard(existingDashboard.id, {
            name: 'Renamed'
        });

        expect(useDashboardStore.getState().dashboards).toEqual([
            existingDashboard
        ]);
        await vi.waitFor(() =>
            expect(mocks.saveDashboards).toHaveBeenCalledWith([
                { ...existingDashboard, name: 'Renamed' }
            ])
        );

        const persisted = [{ ...existingDashboard, name: 'Renamed' }];
        save.resolve(persisted);

        await expect(update).resolves.toEqual(persisted[0]);
        expect(useDashboardStore.getState().dashboards).toEqual(persisted);
    });

    it('retries an initial load after a transient repository failure', async () => {
        mocks.getDashboards
            .mockRejectedValueOnce(new Error('storage unavailable'))
            .mockResolvedValueOnce([existingDashboard]);

        await expect(ensureDashboardsLoaded()).rejects.toThrow(
            'storage unavailable'
        );
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [],
            loaded: false,
            loadStatus: 'error',
            detail: 'storage unavailable'
        });

        await expect(ensureDashboardsLoaded()).resolves.toEqual([
            existingDashboard
        ]);
        expect(mocks.getDashboards).toHaveBeenCalledTimes(2);
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
    });

    it('clears the editing target only after its dashboard is deleted', async () => {
        useDashboardStore.setState({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready',
            editingDashboardId: existingDashboard.id
        });
        mocks.saveDashboards.mockResolvedValue([]);

        await deleteDashboard(existingDashboard.id);

        expect(mocks.saveDashboards).toHaveBeenCalledWith([]);
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [],
            editingDashboardId: null
        });
    });

    it('serves an already loaded mirror without asking the repository', async () => {
        useDashboardStore.setState({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready'
        });

        await expect(ensureDashboardsLoaded()).resolves.toEqual([
            existingDashboard
        ]);
        expect(mocks.getDashboards).not.toHaveBeenCalled();
    });

    it('loads first, then appends a new dashboard and mirrors the persisted list', async () => {
        mocks.getDashboards.mockResolvedValue([existingDashboard]);
        mocks.saveDashboards.mockImplementation(
            async (dashboards) => dashboards
        );

        const created = await createDashboard('Dashboard');

        expect(mocks.getDashboards).toHaveBeenCalledOnce();
        expect(created).toMatchObject({
            id: expect.any(String),
            name: expect.any(String),
            icon: DEFAULT_DASHBOARD_ICON,
            rows: []
        });
        expect(created.name).not.toBe(existingDashboard.name);
        expect(mocks.saveDashboards).toHaveBeenCalledWith([
            existingDashboard,
            created
        ]);
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [existingDashboard, created],
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
    });

    it('rejects an update for an unknown dashboard without saving', async () => {
        useDashboardStore.setState({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready'
        });

        await expect(updateDashboard('missing', {})).rejects.toThrow(
            i18n.t('view.dashboard.error.dashboard_not_found')
        );
        expect(mocks.saveDashboards).not.toHaveBeenCalled();
    });

    it('keeps the mirror when persisting an update fails', async () => {
        useDashboardStore.setState({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
        mocks.saveDashboards.mockRejectedValue(new Error('disk full'));

        await expect(
            updateDashboard(existingDashboard.id, { name: 'Renamed' })
        ).rejects.toThrow('disk full');
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [existingDashboard],
            loadStatus: 'ready'
        });
    });

    it('keeps editing another dashboard when a different one is deleted', async () => {
        const other = { ...existingDashboard, id: 'dashboard-other' };
        useDashboardStore.setState({
            dashboards: [existingDashboard, other],
            loaded: true,
            loadStatus: 'ready',
            editingDashboardId: other.id
        });
        mocks.saveDashboards.mockResolvedValue([other]);

        await deleteDashboard(existingDashboard.id);

        expect(mocks.saveDashboards).toHaveBeenCalledWith([other]);
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [other],
            editingDashboardId: other.id
        });
    });

    it('ignores a load that lands after a reset and keeps the fresh shared load', async () => {
        const stale = deferred<(typeof existingDashboard)[]>();
        const fresh = deferred<(typeof existingDashboard)[]>();
        mocks.getDashboards
            .mockReturnValueOnce(stale.promise)
            .mockReturnValueOnce(fresh.promise);

        const first = ensureDashboardsLoaded();
        resetDashboardState();
        const second = ensureDashboardsLoaded();
        stale.resolve([existingDashboard]);
        await expect(first).resolves.toEqual([existingDashboard]);

        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [],
            loaded: false,
            loadStatus: 'running'
        });
        const third = ensureDashboardsLoaded();
        expect(mocks.getDashboards).toHaveBeenCalledTimes(2);

        fresh.resolve([]);
        await expect(second).resolves.toEqual([]);
        await expect(third).resolves.toEqual([]);
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [],
            loaded: true,
            loadStatus: 'ready'
        });
    });

    it('ignores a load failure that lands after a reset', async () => {
        const stale = deferred<(typeof existingDashboard)[]>();
        mocks.getDashboards.mockReturnValueOnce(stale.promise);

        const first = ensureDashboardsLoaded();
        resetDashboardState();
        stale.reject(new Error('storage unavailable'));

        await expect(first).rejects.toThrow('storage unavailable');
        expect(useDashboardStore.getState()).toMatchObject({
            loaded: false,
            loadStatus: 'idle',
            detail: ''
        });
    });

    it('does not save a change that was waiting on a load from before a reset', async () => {
        const stale = deferred<(typeof existingDashboard)[]>();
        mocks.getDashboards.mockReturnValueOnce(stale.promise);

        const creating = createDashboard('Dashboard');
        resetDashboardState();
        stale.resolve([existingDashboard]);

        await expect(creating).rejects.toThrow(
            i18n.t('view.dashboard.error.changes_not_saved_after_reset')
        );
        expect(mocks.saveDashboards).not.toHaveBeenCalled();
    });

    it('does not mirror a save that lands after a reset', async () => {
        useDashboardStore.setState({
            dashboards: [existingDashboard],
            loaded: true,
            loadStatus: 'ready',
            detail: ''
        });
        const save = deferred<(typeof existingDashboard)[]>();
        mocks.saveDashboards.mockReturnValue(save.promise);

        const update = updateDashboard(existingDashboard.id, {
            name: 'Renamed'
        });
        await vi.waitFor(() => expect(mocks.saveDashboards).toHaveBeenCalled());
        resetDashboardState();
        save.resolve([{ ...existingDashboard, name: 'Renamed' }]);

        await expect(update).resolves.toMatchObject({ name: 'Renamed' });
        expect(useDashboardStore.getState()).toMatchObject({
            dashboards: [],
            loaded: false,
            loadStatus: 'idle'
        });
    });

    it('shows the localized load failure when the repository rejects with a non-error', async () => {
        mocks.getDashboards.mockRejectedValue('storage unavailable');

        await expect(ensureDashboardsLoaded()).rejects.toBe(
            'storage unavailable'
        );
        expect(useDashboardStore.getState()).toMatchObject({
            loaded: false,
            loadStatus: 'error',
            detail: i18n.t(
                'view.dashboard.toast.failed_to_load_dashboard_configuration'
            )
        });
    });
});
