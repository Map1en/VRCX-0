import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeVrchatAuthFailurePayload } from '@/platform/tauri/bindings';
import type { AppToastOptions } from '@/services/toastService';

const recoveryMocks = vi.hoisted(() => ({
    toastWarning: vi.fn(),
    endSession: vi.fn(),
    resetCurrentUserRuntimeAuth: vi.fn(),
    setSignedOutSessionState: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    getCachedAuthSnapshot: vi.fn(),
    t: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'warning':
                    return recoveryMocks.toastWarning(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/repositories/authRepository', () => ({
    default: {
        endSession: recoveryMocks.endSession
    }
}));

vi.mock('./authExecutionService', () => ({
    resetCurrentUserRuntimeAuth: recoveryMocks.resetCurrentUserRuntimeAuth,
    setSignedOutSessionState: recoveryMocks.setSignedOutSessionState
}));

vi.mock('./authSnapshotService', () => ({
    applySavedAuthSnapshot: recoveryMocks.applySavedAuthSnapshot,
    getCachedAuthSnapshot: recoveryMocks.getCachedAuthSnapshot
}));

vi.mock('./i18nService', () => ({
    default: {
        t: recoveryMocks.t
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { beginAuthAttempt } from './authAttempt';
import { handleRuntimeAuthFailure } from './authSessionRecoveryService';

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error('Deferred promise was not initialized.');
    };
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function failure(
    overrides: Partial<RuntimeVrchatAuthFailurePayload> = {}
): RuntimeVrchatAuthFailurePayload {
    return {
        ownerUserId: 'usr_1',
        endpoint: 'https://api.vrchat.cloud/api/1',
        path: 'auth',
        reason: 'Missing Credentials',
        statusCode: 401,
        authScopeGeneration: 7,
        realtimeTransport: null,
        ...overrides
    };
}

function savedSnapshot(userId: string) {
    return {
        lastUserLoggedIn: userId,
        savedCredentialsList: [
            {
                user: { id: userId },
                loginParams: { username: `${userId}@example.test` },
                hasLoginCredentials: true,
                hasCookies: true
            }
        ],
        autoLoginStatus: 'available',
        autoLoginReason: 'available',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0
    };
}

describe('authSessionRecoveryService public guardrails', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        recoveryMocks.endSession.mockResolvedValue(savedSnapshot('usr_1'));
        recoveryMocks.resetCurrentUserRuntimeAuth.mockResolvedValue(undefined);
        recoveryMocks.applySavedAuthSnapshot.mockImplementation(
            (snapshot: unknown) => snapshot
        );
        recoveryMocks.t.mockImplementation((key: string) =>
            Promise.resolve(key)
        );
    });

    it('tells a passwordless account that it will not sign in again by itself', async () => {
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });
        recoveryMocks.getCachedAuthSnapshot.mockReturnValue({
            ...savedSnapshot('usr_1'),
            savedCredentialsList: [
                {
                    user: { id: 'usr_1' },
                    loginParams: { username: '' },
                    hasLoginCredentials: false,
                    hasCookies: false
                }
            ]
        });

        await handleRuntimeAuthFailure(failure());

        expect(recoveryMocks.toastWarning).toHaveBeenCalledWith(
            expect.objectContaining({
                description: 'message.auth.session_requires_login'
            })
        );
    });

    it('handles typed failures only for ready signed-in sessions with the current owner', async () => {
        const currentFailure = failure();

        expect(handleRuntimeAuthFailure(currentFailure)).toBeUndefined();

        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });

        await expect(
            handleRuntimeAuthFailure(currentFailure)
        ).resolves.toBeUndefined();

        expect(
            handleRuntimeAuthFailure(failure({ ownerUserId: 'usr_previous' }))
        ).toBeUndefined();
        expect(recoveryMocks.endSession).toHaveBeenCalledTimes(1);
    });

    it('ignores a typed REST 403 that is not a realtime invalidation', () => {
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });
        expect(
            handleRuntimeAuthFailure(
                failure({ reason: 'Forbidden', statusCode: 403 })
            )
        ).toBeUndefined();
        expect(recoveryMocks.endSession).not.toHaveBeenCalled();
    });

    it('ends the invalidated session with the typed scope and applies the returned snapshot', async () => {
        const returnedSnapshot = savedSnapshot('usr_1');
        recoveryMocks.endSession.mockResolvedValueOnce(returnedSnapshot);
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });

        const recovery = handleRuntimeAuthFailure(failure());

        await expect(recovery).resolves.toBeUndefined();

        expect(recoveryMocks.endSession).toHaveBeenCalledWith({
            kind: 'invalidated',
            expectedUserId: 'usr_1',
            expectedAuthScopeGeneration: 7,
            expectedRealtimeTransport: null
        });
        expect(recoveryMocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
            returnedSnapshot
        );
    });

    it('uses the typed transport epoch when invalidating a realtime auth failure', async () => {
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });

        await handleRuntimeAuthFailure(
            failure({
                reason: 'Forbidden',
                statusCode: 403,
                authScopeGeneration: 9,
                realtimeTransport: {
                    clientRunId: 4,
                    generation: 5,
                    sessionGeneration: 6
                }
            })
        );

        expect(recoveryMocks.endSession).toHaveBeenCalledWith({
            kind: 'invalidated',
            expectedUserId: 'usr_1',
            expectedAuthScopeGeneration: 9,
            expectedRealtimeTransport: {
                clientRunId: 4,
                generation: 5,
                sessionGeneration: 6
            }
        });
    });

    it('keeps the frontend session when the backend rejects a stale invalidation', async () => {
        recoveryMocks.endSession.mockResolvedValueOnce(null);
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });

        await handleRuntimeAuthFailure(failure({ authScopeGeneration: 9 }));

        expect(
            recoveryMocks.resetCurrentUserRuntimeAuth
        ).not.toHaveBeenCalled();
        expect(recoveryMocks.setSignedOutSessionState).not.toHaveBeenCalled();
    });

    it('does not let a delayed recovery clear a newer auth attempt', async () => {
        const finishTranslations: Array<(value: string) => void> = [];
        recoveryMocks.t.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    finishTranslations.push(resolve);
                })
        );
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });

        const recovery = handleRuntimeAuthFailure(failure());
        beginAuthAttempt();
        for (const finishTranslation of finishTranslations) {
            finishTranslation('translated');
        }

        await expect(recovery).resolves.toBeUndefined();
        expect(recoveryMocks.endSession).not.toHaveBeenCalled();
        expect(
            recoveryMocks.resetCurrentUserRuntimeAuth
        ).not.toHaveBeenCalled();
    });

    it('does not let an old recovery swallow a new user session failure', async () => {
        const oldEnd = deferred<null>();
        recoveryMocks.endSession
            .mockImplementationOnce(() => oldEnd.promise)
            .mockResolvedValueOnce(savedSnapshot('usr_2'));
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });

        const oldRecovery = handleRuntimeAuthFailure(failure());
        await vi.waitFor(() => {
            expect(recoveryMocks.endSession).toHaveBeenCalledTimes(1);
        });

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_2'
        });
        const newRecovery = handleRuntimeAuthFailure(
            failure({
                ownerUserId: 'usr_2',
                authScopeGeneration: 8
            })
        );

        await expect(newRecovery).resolves.toBeUndefined();
        oldEnd.resolve(null);
        await expect(oldRecovery).resolves.toBeUndefined();
        expect(recoveryMocks.endSession).toHaveBeenCalledTimes(2);
        expect(recoveryMocks.endSession).toHaveBeenLastCalledWith({
            kind: 'invalidated',
            expectedUserId: 'usr_2',
            expectedAuthScopeGeneration: 8,
            expectedRealtimeTransport: null
        });
        expect(recoveryMocks.applySavedAuthSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does not let an old transport recovery swallow a newer epoch', async () => {
        const oldEnd = deferred<null>();
        recoveryMocks.endSession
            .mockImplementationOnce(() => oldEnd.promise)
            .mockResolvedValueOnce(savedSnapshot('usr_1'));
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1'
        });
        const transportFailure = (generation: number) =>
            failure({
                reason: 'Forbidden',
                statusCode: 403,
                authScopeGeneration: 9,
                realtimeTransport: {
                    clientRunId: 4,
                    generation,
                    sessionGeneration: generation + 1
                }
            });

        const oldRecovery = handleRuntimeAuthFailure(transportFailure(5));
        await vi.waitFor(() => {
            expect(recoveryMocks.endSession).toHaveBeenCalledTimes(1);
        });
        const newRecovery = handleRuntimeAuthFailure(transportFailure(6));

        await expect(newRecovery).resolves.toBeUndefined();
        oldEnd.resolve(null);
        await expect(oldRecovery).resolves.toBeUndefined();
        expect(recoveryMocks.endSession).toHaveBeenCalledTimes(2);
        expect(recoveryMocks.endSession).toHaveBeenLastCalledWith({
            kind: 'invalidated',
            expectedUserId: 'usr_1',
            expectedAuthScopeGeneration: 9,
            expectedRealtimeTransport: {
                clientRunId: 4,
                generation: 6,
                sessionGeneration: 7
            }
        });
    });
});
