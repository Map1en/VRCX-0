import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    endSession: vi.fn(),
    startLoginSession: vi.fn(),
    respondLoginSession: vi.fn(),
    cancelLoginSession: vi.fn(),
    clearEntityQueryCache: vi.fn(),
    clearAvatarNameCache: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    buildAvatarWearSnapshotUpdate: vi.fn(),
    recordCurrentUserSnapshot: vi.fn(),
    resetDomainFacts: vi.fn(),
    t: vi.fn(),
    bootstrapAuthenticatedSession: vi.fn(),
    confirm: vi.fn(),
    otpPrompt: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError
    }
}));

vi.mock('@/lib/entityQueryCache', () => ({
    clearEntityQueryCache: mocks.clearEntityQueryCache
}));

vi.mock('@/repositories/authRepository', () => ({
    default: {
        endSession: mocks.endSession
    }
}));

vi.mock('@/repositories/avatarProfileRepository', () => ({
    default: {
        clearAvatarNameCache: mocks.clearAvatarNameCache
    }
}));

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: {
        startLoginSession: mocks.startLoginSession,
        respondLoginSession: mocks.respondLoginSession,
        cancelLoginSession: mocks.cancelLoginSession
    }
}));

vi.mock('./authSnapshotService', () => ({
    applySavedAuthSnapshot: mocks.applySavedAuthSnapshot
}));

vi.mock('./avatarWearTimeService', () => ({
    buildAvatarWearSnapshotUpdate: mocks.buildAvatarWearSnapshotUpdate
}));

vi.mock('./domainIngestionService', () => ({
    recordCurrentUserSnapshot: mocks.recordCurrentUserSnapshot,
    resetDomainFacts: mocks.resetDomainFacts
}));

vi.mock('./i18nService', () => ({
    default: {
        t: mocks.t
    }
}));

vi.mock('./sessionBootstrapService', () => ({
    bootstrapAuthenticatedSession: mocks.bootstrapAuthenticatedSession
}));

import type {
    LoginFailureKind,
    LoginSessionState,
    SavedAuthSnapshot,
    SavedCredentialSnapshot
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    executeManualLogin,
    executeSavedCredentialLogin,
    logoutFromReactShell
} from './authExecutionService';

function savedCredential(id: string): SavedCredentialSnapshot {
    const record = user(id);
    return {
        user: record,
        loginParams: {
            username:
                id === 'usr_self' ? 'self@example.test' : 'saved@example.test'
        },
        hasLoginCredentials: true,
        hasCookies: false
    };
}

function savedSnapshot({
    credentialId = 'usr_self',
    includeCredential = true,
    lastUserLoggedIn = credentialId
}: {
    credentialId?: string;
    includeCredential?: boolean;
    lastUserLoggedIn?: string | null;
} = {}): SavedAuthSnapshot {
    const credential = savedCredential(credentialId);
    const hasTarget = includeCredential && lastUserLoggedIn === credentialId;
    return {
        lastUserLoggedIn,
        autoLoginStatus: hasTarget
            ? 'available'
            : lastUserLoggedIn
              ? 'missing-last-user'
              : 'not-configured',
        autoLoginReason: hasTarget
            ? 'Saved credentials are available.'
            : lastUserLoggedIn
              ? 'The last logged-in account is missing.'
              : 'No previous login was recorded.',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        savedCredentialsList: includeCredential ? [credential] : []
    };
}

function user(id = 'usr_self') {
    return {
        id,
        displayName: id === 'usr_self' ? 'Self' : 'Saved User',
        username: 'self_user'
    };
}

function authenticatedState(id = 'usr_self'): LoginSessionState {
    const record = user(id);
    return {
        status: 'authenticated',
        snapshot: savedSnapshot({ credentialId: id }),
        session: {
            userId: record.id,
            displayName: record.displayName,
            endpoint: 'https://api.vrchat.cloud/api/1',
            websocket: 'wss://pipeline.vrchat.cloud',
            currentUser: record
        }
    };
}

function challengeState(
    methods: string[],
    mode: string,
    error: string | null = null
): LoginSessionState {
    return {
        status: 'challenge',
        attemptId: 'attempt-1',
        methods,
        mode,
        error
    };
}

function failedState(
    reason: string,
    kind: LoginFailureKind,
    snapshot = savedSnapshot()
): LoginSessionState {
    return {
        status: 'failed',
        reason,
        kind,
        snapshot
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error('Deferred promise was not initialized.');
    };
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe('authExecutionService characterization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useModalStore.getState().resetModalState();
        useModalStore.setState({
            confirm: mocks.confirm,
            otpPrompt: mocks.otpPrompt
        });

        mocks.endSession.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null })
        );
        mocks.startLoginSession.mockResolvedValue(authenticatedState());
        mocks.respondLoginSession.mockResolvedValue(authenticatedState());
        mocks.cancelLoginSession.mockResolvedValue({ status: 'cancelled' });
        mocks.applySavedAuthSnapshot.mockImplementation(
            (snapshot: unknown) => snapshot
        );
        mocks.buildAvatarWearSnapshotUpdate.mockImplementation(
            ({ nextSnapshot }: { nextSnapshot: unknown }) => ({
                snapshot: nextSnapshot
            })
        );
        mocks.t.mockImplementation(
            (key: string, values?: Record<string, unknown>) =>
                Promise.resolve(values?.name ? `${key}:${values.name}` : key)
        );
        mocks.bootstrapAuthenticatedSession.mockResolvedValue(undefined);
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.otpPrompt.mockResolvedValue({ ok: true, value: '123456' });
    });

    it('rejects manual login without username or password', async () => {
        await expect(
            executeManualLogin({ username: ' ', password: 'secret' })
        ).rejects.toMatchObject({
            code: 'AUTH_FORM_INVALID'
        });
        expect(mocks.startLoginSession).not.toHaveBeenCalled();
    });

    it('records and bootstraps a successful manual login', async () => {
        await expect(
            executeManualLogin({
                username: ' self@example.test ',
                password: 'secret',
                saveCredentials: true
            })
        ).resolves.toMatchObject(savedSnapshot());

        expect(mocks.startLoginSession).toHaveBeenCalledWith({
            mode: 'basic',
            username: 'self@example.test',
            password: 'secret',
            saveCredentials: true
        });
        expect(useRuntimeStore.getState().auth).toMatchObject({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self',
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
            currentUserWebsocket: 'wss://pipeline.vrchat.cloud'
        });
        expect(useSessionStore.getState().sessionPhase).toBe('authenticating');
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledWith(
            user(),
            expect.any(Number)
        );
    });

    it('does not expose an authenticated frontend session when the backend commit fails', async () => {
        mocks.startLoginSession.mockResolvedValueOnce(
            failedState('session commit failed', 'other')
        );

        await expect(
            executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            })
        ).rejects.toThrow('session commit failed');

        expect(useRuntimeStore.getState().auth.currentUserId).toBe(null);
        expect(mocks.bootstrapAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('does not let a superseded login failure clear the newer account', async () => {
        const oldLogin = deferred<LoginSessionState>();
        mocks.startLoginSession
            .mockImplementationOnce(() => oldLogin.promise)
            .mockResolvedValueOnce(authenticatedState('usr_saved'));

        const oldResult = executeManualLogin({
            username: 'old@example.test',
            password: 'secret'
        });
        await executeSavedCredentialLogin({
            user: {
                id: 'usr_saved',
                displayName: 'Saved User'
            },
            loginParams: {
                username: 'saved@example.test'
            },
            hasCookies: false,
            hasLoginCredentials: true
        });

        oldLogin.resolve(failedState('superseded', 'other'));
        await expect(oldResult).rejects.toThrow('superseded');

        expect(useRuntimeStore.getState().auth.currentUserId).toBe('usr_saved');
        expect(useSessionStore.getState().sessionPhase).toBe('authenticating');
    });

    it('prefers email OTP and finishes login after the challenge resolves', async () => {
        mocks.startLoginSession.mockResolvedValueOnce(
            challengeState(['emailOtp'], 'emailOtp')
        );

        await executeManualLogin({
            username: 'self@example.test',
            password: 'secret'
        });

        expect(mocks.otpPrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: 'emailOtp',
                title: 'prompt.email_otp.header',
                cancelText: 'prompt.email_otp.resend'
            })
        );
        expect(mocks.respondLoginSession).toHaveBeenCalledWith({
            attemptId: 'attempt-1',
            method: 'emailOtp',
            code: '123456'
        });
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledWith(
            user(),
            expect.any(Number)
        );
    });

    it('deletes saved credentials when VRChat rejects them', async () => {
        mocks.startLoginSession.mockResolvedValueOnce(
            failedState(
                'Invalid Username/Email or Password',
                'invalidCredentials',
                savedSnapshot({
                    includeCredential: false,
                    lastUserLoggedIn: null
                })
            )
        );
        await expect(
            executeSavedCredentialLogin({
                user: {
                    id: 'usr_saved',
                    displayName: 'Saved User'
                },
                loginParams: {
                    username: 'saved@example.test'
                },
                hasCookies: false,
                hasLoginCredentials: true
            })
        ).rejects.toMatchObject({
            code: 'AUTH_SAVED_CREDENTIALS_INVALID',
            authSnapshot: savedSnapshot({
                includeCredential: false,
                lastUserLoggedIn: null
            })
        });

        expect(useSessionStore.getState().sessionPhase).toBe('signed_out');
    });

    it('rejects saved credentials that do not contain stored login data', async () => {
        await expect(
            executeSavedCredentialLogin({
                user: { id: 'usr_saved' },
                loginParams: { username: '' },
                hasCookies: false,
                hasLoginCredentials: false
            })
        ).rejects.toMatchObject({
            code: 'AUTH_SAVED_CREDENTIALS_INVALID'
        });
        expect(mocks.startLoginSession).not.toHaveBeenCalled();
    });

    it('does not persist logout when the confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValueOnce({ ok: false });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });

        await expect(logoutFromReactShell()).resolves.toBe(false);

        expect(mocks.endSession).not.toHaveBeenCalled();
    });

    it('records logout and returns to a signed-out session', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });

        await expect(logoutFromReactShell()).resolves.toBe(true);

        expect(mocks.endSession).toHaveBeenCalledWith({ kind: 'logout' });
        expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
            savedSnapshot({
                lastUserLoggedIn: null
            })
        );
        expect(useRuntimeStore.getState().auth.currentUserId).toBe(null);
        expect(useSessionStore.getState().sessionPhase).toBe('signed_out');
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            'message.auth.logout_greeting:Self'
        );
    });

    it('ends the backend session when logout supersedes an in-flight login', async () => {
        const login = deferred<LoginSessionState>();
        mocks.startLoginSession.mockImplementationOnce(() => login.promise);

        const loginResult = executeManualLogin({
            username: 'self@example.test',
            password: 'secret'
        });
        await vi.waitFor(() => {
            expect(mocks.startLoginSession).toHaveBeenCalledTimes(1);
        });
        expect(useRuntimeStore.getState().auth.currentUserId).toBeNull();
        expect(useSessionStore.getState().sessionPhase).toBe('authenticating');

        await expect(logoutFromReactShell()).resolves.toBe(true);

        expect(mocks.endSession).toHaveBeenCalledWith({ kind: 'logout' });
        login.resolve(authenticatedState());
        await expect(loginResult).rejects.toMatchObject({
            code: 'AUTH_ATTEMPT_SUPERSEDED'
        });
        expect(useRuntimeStore.getState().auth.currentUserId).toBeNull();
        expect(useSessionStore.getState().sessionPhase).toBe('signed_out');
    });

    it('does not report logout success when the backend end operation fails', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });
        mocks.endSession.mockRejectedValueOnce(new Error('logout failed'));

        await expect(logoutFromReactShell()).rejects.toThrow('logout failed');

        expect(mocks.endSession).toHaveBeenCalledWith({ kind: 'logout' });
        expect(useRuntimeStore.getState().auth.currentUserId).toBe(null);
        expect(useSessionStore.getState().sessionPhase).toBe('signed_out');
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('keeps the current mirror when a stale logout becomes a backend no-op', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });
        mocks.endSession.mockResolvedValueOnce(null);

        await expect(logoutFromReactShell()).resolves.toBe(false);

        expect(useRuntimeStore.getState().auth.currentUserId).toBe('usr_self');
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('does not let a stale logout response clear a newer login', async () => {
        const logout = deferred<ReturnType<typeof savedSnapshot>>();
        mocks.endSession.mockImplementationOnce(() => logout.promise);
        mocks.startLoginSession.mockResolvedValueOnce(
            authenticatedState('usr_saved')
        );
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });

        const logoutResult = logoutFromReactShell();
        await vi.waitFor(() => {
            expect(mocks.endSession).toHaveBeenCalledTimes(1);
        });
        await executeSavedCredentialLogin({
            user: {
                id: 'usr_saved',
                displayName: 'Saved User'
            },
            loginParams: {
                username: 'saved@example.test'
            },
            hasCookies: false,
            hasLoginCredentials: true
        });
        logout.resolve(savedSnapshot({ lastUserLoggedIn: null }));

        await expect(logoutResult).rejects.toMatchObject({
            code: 'AUTH_ATTEMPT_SUPERSEDED'
        });
        expect(useRuntimeStore.getState().auth.currentUserId).toBe('usr_saved');
    });

    describe('two-factor challenge golden contract', () => {
        it('prompts with the totp mode selected for a real totp payload', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                challengeState(['totp', 'otp'], 'totp')
            );

            await executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            });

            expect(mocks.otpPrompt).toHaveBeenCalledTimes(1);
            expect(mocks.otpPrompt).toHaveBeenCalledWith(
                expect.objectContaining({
                    mode: 'totp',
                    title: 'prompt.totp.header'
                })
            );
            expect(mocks.respondLoginSession).toHaveBeenCalledWith({
                attemptId: 'attempt-1',
                method: 'totp',
                code: '123456'
            });
        });

        it('cancelling totp falls back to the recovery-code (otp) prompt, and cancelling that returns to totp', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                challengeState(['totp', 'otp'], 'totp')
            );
            mocks.otpPrompt
                .mockResolvedValueOnce({ ok: false, reason: 'cancel' })
                .mockResolvedValueOnce({ ok: false, reason: 'cancel' })
                .mockResolvedValueOnce({ ok: true, value: '999999' });

            await executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            });

            expect(mocks.otpPrompt).toHaveBeenCalledTimes(3);
            expect(
                mocks.otpPrompt.mock.calls.map(([prompt]) => prompt.mode)
            ).toEqual(['totp', 'otp', 'totp']);
            expect(mocks.cancelLoginSession).not.toHaveBeenCalled();
            expect(mocks.respondLoginSession).toHaveBeenCalledTimes(1);
            expect(mocks.respondLoginSession).toHaveBeenCalledWith({
                attemptId: 'attempt-1',
                method: 'totp',
                code: '999999'
            });
        });

        it('cancelling the email OTP prompt restarts the login challenge instead of switching modes', async () => {
            mocks.startLoginSession
                .mockResolvedValueOnce(challengeState(['emailOtp'], 'emailOtp'))
                .mockResolvedValueOnce(
                    challengeState(['emailOtp'], 'emailOtp')
                );
            mocks.otpPrompt
                .mockResolvedValueOnce({ ok: false, reason: 'cancel' })
                .mockResolvedValueOnce({ ok: true, value: '000000' });

            await executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            });

            expect(mocks.startLoginSession).toHaveBeenCalledTimes(2);
            expect(mocks.cancelLoginSession).toHaveBeenCalledTimes(1);
            expect(mocks.cancelLoginSession).toHaveBeenCalledWith('attempt-1');
            expect(mocks.otpPrompt).toHaveBeenCalledTimes(2);
            expect(
                mocks.otpPrompt.mock.calls.map(([prompt]) => prompt.mode)
            ).toEqual(['emailOtp', 'emailOtp']);
            expect(mocks.respondLoginSession).toHaveBeenCalledWith({
                attemptId: 'attempt-1',
                method: 'emailOtp',
                code: '000000'
            });
        });

        it('re-prompts with the same mode when a wrong code keeps the challenge open', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                challengeState(['totp', 'otp'], 'totp')
            );
            mocks.respondLoginSession
                .mockResolvedValueOnce(
                    challengeState(
                        ['totp', 'otp'],
                        'totp',
                        '2FA verification failed with HTTP 400'
                    )
                )
                .mockResolvedValueOnce(authenticatedState());
            mocks.otpPrompt
                .mockResolvedValueOnce({ ok: true, value: 'AAAAAA' })
                .mockResolvedValueOnce({ ok: true, value: 'BBBBBB' });

            await executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            });

            expect(
                mocks.otpPrompt.mock.calls.map(([prompt]) => prompt.mode)
            ).toEqual(['totp', 'totp']);
            expect(mocks.toastError).toHaveBeenCalledWith(
                'prompt.totp.input_error'
            );
            expect(mocks.respondLoginSession).toHaveBeenCalledTimes(2);
        });

        it('adopts the recomputed default mode when a follow-up challenge arrives', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                challengeState(['totp', 'otp'], 'totp')
            );
            mocks.respondLoginSession
                .mockResolvedValueOnce(challengeState(['otp'], 'otp'))
                .mockResolvedValueOnce(authenticatedState());
            mocks.otpPrompt
                .mockResolvedValueOnce({ ok: true, value: 'AAAAAA' })
                .mockResolvedValueOnce({ ok: true, value: 'BBBBBB' });

            await executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            });

            expect(
                mocks.otpPrompt.mock.calls.map(([prompt]) => prompt.mode)
            ).toEqual(['totp', 'otp']);
            expect(
                mocks.respondLoginSession.mock.calls.map(
                    ([input]) => input.method
                )
            ).toEqual(['totp', 'otp']);
        });

        it('cancels the backend session when the prompt is dismissed outright', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                challengeState(['totp', 'otp'], 'totp')
            );
            mocks.otpPrompt.mockResolvedValueOnce({
                ok: false,
                reason: 'dismiss'
            });

            await expect(
                executeManualLogin({
                    username: 'self@example.test',
                    password: 'secret'
                })
            ).rejects.toMatchObject({
                code: 'AUTH_2FA_CANCELLED'
            });

            expect(mocks.cancelLoginSession).toHaveBeenCalledTimes(1);
            expect(mocks.cancelLoginSession).toHaveBeenCalledWith('attempt-1');
            expect(mocks.respondLoginSession).not.toHaveBeenCalled();
        });
    });

    describe('saved-credential login always disables credential saving', () => {
        it('starts the saved-credential session without any client-side credential persistence', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                authenticatedState('usr_saved')
            );

            await executeSavedCredentialLogin({
                user: {
                    id: 'usr_saved',
                    displayName: 'Saved User'
                },
                loginParams: {
                    username: 'saved@example.test'
                },
                hasCookies: false,
                hasLoginCredentials: true
            });

            expect(mocks.startLoginSession).toHaveBeenCalledWith({
                mode: 'savedCredential',
                userId: 'usr_saved'
            });
            expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
                savedSnapshot({ credentialId: 'usr_saved' })
            );
            expect(useRuntimeStore.getState().auth).toMatchObject({
                currentUserId: 'usr_saved',
                currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
                currentUserWebsocket: 'wss://pipeline.vrchat.cloud'
            });
        });

        it('clears the last-logged-in target for a session-recovery failure while keeping the saved credential', async () => {
            const nextSnapshot = savedSnapshot({
                credentialId: 'usr_saved',
                lastUserLoggedIn: null
            });
            mocks.startLoginSession.mockResolvedValueOnce(
                failedState('Unauthorized', 'sessionInvalidated', nextSnapshot)
            );

            await expect(
                executeSavedCredentialLogin({
                    user: {
                        id: 'usr_saved',
                        displayName: 'Saved User'
                    },
                    loginParams: {
                        username: 'saved@example.test'
                    },
                    hasCookies: false,
                    hasLoginCredentials: true
                })
            ).rejects.toMatchObject({
                message: 'Unauthorized',
                kind: 'sessionInvalidated',
                authSnapshot: nextSnapshot
            });

            expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
                nextSnapshot
            );
        });
    });
});
