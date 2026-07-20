import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appCheckGameRunning: vi.fn(),
    appRuntimeGroupInstancesRefresh: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appCheckGameRunning: mocks.appCheckGameRunning,
        appRuntimeGroupInstancesRefresh: mocks.appRuntimeGroupInstancesRefresh
    }
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
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
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.appCheckGameRunning.mockResolvedValue(null);
        mocks.appRuntimeGroupInstancesRefresh.mockResolvedValue(null);
    });

    it('hydrates the frontend after the backend session is committed', async () => {
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
