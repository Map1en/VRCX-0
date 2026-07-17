import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appCheckGameRunning: vi.fn(),
    appAuthenticatedSessionMaintenanceRun: vi.fn(),
    appAuthenticatedRuntimeSessionStart: vi.fn(),
    appRuntimeGroupInstancesRefresh: vi.fn(),
    applyAuthenticatedRuntimePhaseSnapshot: vi.fn(),
    ensureUserTables: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    showSQLiteErrorDialog: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appCheckGameRunning: mocks.appCheckGameRunning,
        appAuthenticatedSessionMaintenanceRun:
            mocks.appAuthenticatedSessionMaintenanceRun,
        appAuthenticatedRuntimeSessionStart:
            mocks.appAuthenticatedRuntimeSessionStart,
        appRuntimeGroupInstancesRefresh: mocks.appRuntimeGroupInstancesRefresh
    }
}));

vi.mock('./authenticatedRuntimeService', () => ({
    applyAuthenticatedRuntimePhaseSnapshot:
        mocks.applyAuthenticatedRuntimePhaseSnapshot
}));

vi.mock('@/repositories/userSessionRepository', () => ({
    default: {
        ensureUserTables: mocks.ensureUserTables
    }
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
}));

vi.mock('./sqliteErrorDialogService', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

vi.mock('./startupServicesStatus', () => ({
    syncStartupServicesTask: mocks.syncStartupServicesTask
}));

describe('sessionBootstrapService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');

        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test/api/1',
            currentUserWebsocket: 'wss://pipeline.example.test',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            }
        });
        mocks.ensureUserTables.mockResolvedValue(undefined);
        mocks.appAuthenticatedSessionMaintenanceRun.mockResolvedValue({
            userId: 'usr_self',
            avatarCleanup: {
                state: 'disabled',
                retentionDays: null,
                removedCount: 0,
                cutoff: null,
                completedAt: null
            }
        });
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.appCheckGameRunning.mockResolvedValue(null);
        mocks.appRuntimeGroupInstancesRefresh.mockResolvedValue(null);
        mocks.appAuthenticatedRuntimeSessionStart.mockResolvedValue({
            runId: 1,
            userId: 'usr_self',
            phase: 'starting'
        });
    });

    it('syncs the backend frontend session before friend bootstrap is loaded', async () => {
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');

        await bootstrapAuthenticatedSession({
            id: 'usr_self',
            displayName: 'Self'
        });

        expect(
            mocks.appAuthenticatedSessionMaintenanceRun
        ).toHaveBeenCalledWith();
        expect(mocks.appAuthenticatedRuntimeSessionStart).toHaveBeenCalledWith(
            'usr_self',
            'https://api.example.test/api/1',
            'wss://pipeline.example.test',
            {
                id: 'usr_self',
                displayName: 'Self'
            }
        );
        expect(mocks.appRuntimeGroupInstancesRefresh).toHaveBeenCalledTimes(1);
        expect(
            mocks.appAuthenticatedRuntimeSessionStart.mock
                .invocationCallOrder[0]
        ).toBeLessThan(
            mocks.appRuntimeGroupInstancesRefresh.mock.invocationCallOrder[0]
        );
        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
    });
});
