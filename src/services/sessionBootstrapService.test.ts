import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appCheckGameRunning: vi.fn(),
    appRuntimeGroupInstancesRefresh: vi.fn(),
    appSyncFrontendAuthenticatedSession: vi.fn(),
    ensureUserTables: vi.fn(),
    purgeAvatarFeedData: vi.fn(),
    getConfigString: vi.fn(),
    setConfigString: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    showSQLiteErrorDialog: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appCheckGameRunning: mocks.appCheckGameRunning,
        appRuntimeGroupInstancesRefresh: mocks.appRuntimeGroupInstancesRefresh,
        appSyncFrontendAuthenticatedSession:
            mocks.appSyncFrontendAuthenticatedSession
    }
}));

vi.mock('@/repositories/userSessionRepository', () => ({
    default: {
        ensureUserTables: mocks.ensureUserTables,
        purgeAvatarFeedData: mocks.purgeAvatarFeedData
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.getConfigString,
        setString: mocks.setConfigString
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
        mocks.purgeAvatarFeedData.mockResolvedValue(undefined);
        mocks.getConfigString.mockResolvedValue('Off');
        mocks.setConfigString.mockResolvedValue(undefined);
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.appCheckGameRunning.mockResolvedValue(null);
        mocks.appRuntimeGroupInstancesRefresh.mockResolvedValue(null);
        mocks.appSyncFrontendAuthenticatedSession.mockResolvedValue(null);
    });

    it('syncs the backend frontend session before friend bootstrap is loaded', async () => {
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');

        await bootstrapAuthenticatedSession({
            id: 'usr_self',
            displayName: 'Self'
        });

        expect(mocks.appSyncFrontendAuthenticatedSession).toHaveBeenCalledWith(
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
            mocks.appSyncFrontendAuthenticatedSession.mock
                .invocationCallOrder[0]
        ).toBeLessThan(
            mocks.appRuntimeGroupInstancesRefresh.mock.invocationCallOrder[0]
        );
        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
    });
});
