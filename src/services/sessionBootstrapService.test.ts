import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appCheckGameRunning: vi.fn(),
    appRuntimeGroupInstancesRefresh: vi.fn(),
    getInstanceJoinHistory: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    restoreRuntimeGameLogProjectionFromPersistence: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appCheckGameRunning: mocks.appCheckGameRunning,
        appRuntimeGroupInstancesRefresh: mocks.appRuntimeGroupInstancesRefresh
    }
}));

vi.mock('@/repositories/gameLogPersistenceRepository', () => ({
    default: {
        getInstanceJoinHistory: mocks.getInstanceJoinHistory
    }
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
}));

vi.mock('./gameLogIngestService', () => ({
    restoreRuntimeGameLogProjectionFromPersistence:
        mocks.restoreRuntimeGameLogProjectionFromPersistence
}));

vi.mock('./startupServicesStatus', () => ({
    syncStartupServicesTask: mocks.syncStartupServicesTask
}));

describe('sessionBootstrapService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        const { useInstanceJoinHistoryStore } =
            await import('@/state/instanceJoinHistoryStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');

        useInstanceJoinHistoryStore.getState().resetInstanceJoinHistory();
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
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.appCheckGameRunning.mockResolvedValue(null);
        mocks.appRuntimeGroupInstancesRefresh.mockResolvedValue(null);
        mocks.getInstanceJoinHistory.mockResolvedValue(
            new Map([['wrld_test:123', 123456]])
        );
        mocks.restoreRuntimeGameLogProjectionFromPersistence.mockResolvedValue(
            false
        );
    });

    it('restores the persisted GameLog roster after game detection', async () => {
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');

        await bootstrapAuthenticatedSession(
            { id: 'usr_self', displayName: 'Self' },
            beginAuthAttempt()
        );

        expect(mocks.appCheckGameRunning).toHaveBeenCalledTimes(2);
        expect(
            mocks.restoreRuntimeGameLogProjectionFromPersistence
        ).toHaveBeenCalledTimes(1);
    });

    it('hydrates the frontend after the backend session is committed', async () => {
        const { useInstanceJoinHistoryStore } =
            await import('@/state/instanceJoinHistoryStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');

        await bootstrapAuthenticatedSession(
            {
                id: 'usr_self',
                displayName: 'Self'
            },
            beginAuthAttempt()
        );

        expect(mocks.appRuntimeGroupInstancesRefresh).toHaveBeenCalledTimes(1);
        expect(mocks.getInstanceJoinHistory).toHaveBeenCalledWith('usr_self');
        expect(
            useInstanceJoinHistoryStore.getState().joinedAtByLocation
        ).toEqual({
            'wrld_test:123': 123456
        });
        expect(useSessionStore.getState().isLoggedIn).toBe(true);
        expect(useSessionStore.getState().sessionPhase).toBe('ready');
        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
    });

    it('does not mark an old bootstrap ready after a newer auth action starts', async () => {
        let finishGameCheck: () => void = () => {
            throw new Error('Game check was not initialized.');
        };
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        mocks.appCheckGameRunning.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishGameCheck = resolve;
                })
        );
        const { useSessionStore } = await import('@/state/sessionStore');
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');
        const oldAttempt = beginAuthAttempt();
        const oldBootstrap = bootstrapAuthenticatedSession(
            { id: 'usr_self', displayName: 'Self' },
            oldAttempt
        );
        await vi.waitFor(() => {
            expect(mocks.appCheckGameRunning).toHaveBeenCalledTimes(1);
        });
        expect(useSessionStore.getState().sessionPhase).toBe('bootstrapping');

        beginAuthAttempt();
        useSessionStore.getState().setSessionState({
            isLoggedIn: false,
            sessionPhase: 'authenticating'
        });
        finishGameCheck();

        await expect(oldBootstrap).rejects.toMatchObject({
            code: 'AUTH_ATTEMPT_SUPERSEDED'
        });
        expect(useSessionStore.getState().isLoggedIn).toBe(false);
        expect(useSessionStore.getState().sessionPhase).toBe('authenticating');
    });
});
