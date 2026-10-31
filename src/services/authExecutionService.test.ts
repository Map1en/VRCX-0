import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    clearSavedPassword: vi.fn(),
    toastClose: vi.fn(),
    endSession: vi.fn(),
    startLoginSession: vi.fn(),
    respondLoginSession: vi.fn(),
    cancelLoginSession: vi.fn(),
    clearEntityQueryCache: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    recordCurrentUserSnapshot: vi.fn(),
    resetDomainFacts: vi.fn(),
    loadVrchatConfigSnapshot: vi.fn(),
    resetVrchatConfigSnapshot: vi.fn(),
    t: vi.fn(),
    bootstrapAuthenticatedSession: vi.fn(),
    confirm: vi.fn(),
    otpPrompt: vi.fn(),
    flashWindow: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'success':
                    return mocks.toastSuccess(options);
                case 'error':
                    return mocks.toastError(options);
                case 'info':
                    return mocks.toastInfo(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        },
        close: mocks.toastClose
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

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatAuthSessionStart: mocks.startLoginSession,
        appVrchatAuthSessionRespond: mocks.respondLoginSession,
        appVrchatAuthSessionCancel: mocks.cancelLoginSession
    }
}));

vi.mock('@/platform/tauri/webview', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/platform/tauri/webview')>()),
    flashWindow: mocks.flashWindow
}));

vi.mock('./authSnapshotService', () => ({
    applySavedAuthSnapshot: mocks.applySavedAuthSnapshot,
    clearSavedPassword: mocks.clearSavedPassword
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

vi.mock('./vrchatConfigService', () => ({
    loadVrchatConfigSnapshot: mocks.loadVrchatConfigSnapshot,
    resetVrchatConfigSnapshot: mocks.resetVrchatConfigSnapshot
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
import {
    cachePreviousInstances,
    cacheUserStats,
    dialogTargetKey,
    readCachedPreviousInstances,
    readCachedUserStats
} from '@/services/userDialogSessionCacheService';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    executeDeviceLogin,
    executeManualLogin,
    executeSavedCredentialLogin,
    logoutFromReactShell,
    showAuthFailureToast
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
        useAssistantChatStore.getState().resetAssistantChatState();
        useFriendLocationTimeStore.getState().reset();
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
            (snapshot: SavedAuthSnapshot) => snapshot
        );
        mocks.t.mockImplementation((key: string, values?: { name?: string }) =>
            Promise.resolve(values?.name ? `${key}:${values.name}` : key)
        );
        mocks.bootstrapAuthenticatedSession.mockResolvedValue(undefined);
        mocks.loadVrchatConfigSnapshot.mockResolvedValue({});
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.otpPrompt.mockResolvedValue({ ok: true, value: '123456' });
        mocks.flashWindow.mockResolvedValue(undefined);
    });

    it('offers to clear the saved password after a QR login on an account that has one', async () => {
        mocks.clearSavedPassword.mockResolvedValue(savedSnapshot());

        await executeDeviceLogin();

        expect(mocks.startLoginSession).toHaveBeenCalledWith({
            mode: 'device'
        });
        expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
        const [offer] = mocks.toastInfo.mock.calls[0] as [AppToastOptions];
        offer.actionProps?.onClick?.(
            {} as Parameters<
                NonNullable<
                    NonNullable<AppToastOptions['actionProps']>['onClick']
                >
            >[0]
        );
        await vi.waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
        });
        expect(mocks.clearSavedPassword).toHaveBeenCalledWith('usr_self');
    });

    it('does not offer to clear a password after a QR login on a passwordless account', async () => {
        const state = authenticatedState();
        if (state.status === 'authenticated' && state.snapshot) {
            state.snapshot.savedCredentialsList[0].hasLoginCredentials = false;
        }
        mocks.startLoginSession.mockResolvedValue(state);

        await executeDeviceLogin();

        expect(mocks.toastInfo).not.toHaveBeenCalled();
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
        useAssistantChatStore.setState({
            open: true,
            activeSessionId: 'session-from-previous-account',
            messagesBySession: { 'session-from-previous-account': [] }
        });

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
        expect(mocks.loadVrchatConfigSnapshot).toHaveBeenCalledTimes(1);
        expect(useAssistantChatStore.getState()).toMatchObject({
            open: false,
            activeSessionId: null
        });
        expect(useAssistantChatStore.getState().messagesBySession).toEqual({});
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledWith(
            user(),
            expect.any(Number)
        );
    });

    it('closes persistent auth failure toasts once a login succeeds', async () => {
        mocks.toastError
            .mockReturnValueOnce('failure-1')
            .mockReturnValueOnce('failure-2');
        showAuthFailureToast('Network unavailable');
        showAuthFailureToast('message.auth.offline');
        expect(mocks.toastError).toHaveBeenCalledWith({
            type: 'error',
            title: 'Network unavailable',
            timeout: 0,
            data: { closeButton: true }
        });
        expect(mocks.toastClose).not.toHaveBeenCalled();

        await executeManualLogin({
            username: 'self@example.test',
            password: 'secret'
        });

        expect(mocks.toastClose).toHaveBeenCalledTimes(2);
        expect(mocks.toastClose).toHaveBeenCalledWith('failure-1');
        expect(mocks.toastClose).toHaveBeenCalledWith('failure-2');
    });

    it('keeps auth failure toasts open when the post-login bootstrap fails', async () => {
        mocks.toastError.mockReturnValueOnce('failure-1');
        showAuthFailureToast('Network unavailable');
        mocks.bootstrapAuthenticatedSession.mockRejectedValueOnce(
            new Error('bootstrap failed')
        );

        await expect(
            executeManualLogin({
                username: 'self@example.test',
                password: 'secret'
            })
        ).rejects.toThrow('bootstrap failed');

        expect(mocks.toastClose).not.toHaveBeenCalled();
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

    it('prompts with the email OTP copy and finishes login after the challenge resolves', async () => {
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

    it('maps rejected saved credentials to AUTH_SAVED_CREDENTIALS_INVALID and signs out with the backend snapshot', async () => {
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
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_test:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        ]);
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
        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({});
        expect(mocks.resetVrchatConfigSnapshot).toHaveBeenCalled();
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'message.auth.logout_greeting:Self'
            })
        );
    });

    it('drops per-account user dialog caches on logout', async () => {
        const targetKey = dialogTargetKey(
            'https://api.vrchat.cloud/api/1',
            'usr_friend'
        );
        cacheUserStats(targetKey, {
            timeSpent: 1234,
            lastSeen: '2026-08-18T00:00:00Z',
            joinCount: 7
        });
        cachePreviousInstances(targetKey, [
            { location: 'wrld_stale:123' } as never
        ]);
        expect(readCachedUserStats(targetKey).joinCount).toBe(7);
        expect(readCachedPreviousInstances(targetKey)).toHaveLength(1);

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });

        await expect(logoutFromReactShell()).resolves.toBe(true);

        expect(readCachedUserStats(targetKey).joinCount).toBe(0);
        expect(readCachedPreviousInstances(targetKey)).toEqual([]);
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
            expect(mocks.flashWindow).toHaveBeenCalledTimes(1);
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
            expect(mocks.cancelLoginSession).toHaveBeenCalledWith({
                attemptId: 'attempt-1'
            });
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
                expect.objectContaining({
                    type: 'error',
                    title: 'prompt.totp.input_error'
                })
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
            expect(mocks.cancelLoginSession).toHaveBeenCalledWith({
                attemptId: 'attempt-1'
            });
            expect(mocks.respondLoginSession).not.toHaveBeenCalled();
        });
    });

    describe('saved-credential login', () => {
        it('starts a saved-credential session by user id and applies the returned snapshot', async () => {
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

        it('rejects with the typed failure and applies the backend snapshot for a session-invalidated failure', async () => {
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
