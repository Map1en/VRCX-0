import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appRuntimeAuthScopeSet: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    recordLogout: vi.fn(),
    deleteSavedCredential: vi.fn(),
    getSavedAuthSnapshot: vi.fn(),
    clearCookies: vi.fn(),
    clearAuthCookies: vi.fn(),
    startLoginSession: vi.fn(),
    respondLoginSession: vi.fn(),
    cancelLoginSession: vi.fn(),
    resetAutoLoginThrottle: vi.fn(),
    clearEntityQueryCache: vi.fn(),
    clearAvatarNameCache: vi.fn(),
    runWithRuntimeAuthFailureRecoverySuppressed: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    refreshSavedAuthSnapshot: vi.fn(),
    buildAvatarWearSnapshotUpdate: vi.fn(),
    recordCurrentUserSnapshot: vi.fn(),
    resetDomainFacts: vi.fn(),
    t: vi.fn(),
    bootstrapAuthenticatedSession: vi.fn(),
    confirm: vi.fn(),
    otpPrompt: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appRuntimeAuthScopeSet: mocks.appRuntimeAuthScopeSet
    }
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
        recordLogout: mocks.recordLogout,
        deleteSavedCredential: mocks.deleteSavedCredential,
        getSavedAuthSnapshot: mocks.getSavedAuthSnapshot
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
        cancelLoginSession: mocks.cancelLoginSession,
        resetAutoLoginThrottle: mocks.resetAutoLoginThrottle
    }
}));

vi.mock('@/repositories/webRepository', () => ({
    default: {
        clearCookies: mocks.clearCookies,
        clearAuthCookies: mocks.clearAuthCookies
    }
}));

vi.mock('./authSessionRecoveryService', () => ({
    runWithRuntimeAuthFailureRecoverySuppressed:
        mocks.runWithRuntimeAuthFailureRecoverySuppressed
}));

vi.mock('./authSnapshotService', () => ({
    applySavedAuthSnapshot: mocks.applySavedAuthSnapshot,
    refreshSavedAuthSnapshot: mocks.refreshSavedAuthSnapshot
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
    LoginSessionState
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    executeManualLogin,
    executeSavedCredentialLogin,
    logoutFromReactShell
} from './authExecutionService';

function savedSnapshot(patch: Record<string, unknown> = {}) {
    return {
        lastUserLoggedIn: 'usr_self',
        savedCredentialCount: 1,
        autoLoginStatus: 'available',
        autoLoginReason: 'available',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        ...patch
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
        session: {
            userId: record.id,
            displayName: record.displayName,
            endpoint: '',
            websocket: '',
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
        methods,
        mode,
        error
    };
}

function failedState(
    reason: string,
    kind: LoginFailureKind
): LoginSessionState {
    return {
        status: 'failed',
        reason,
        kind
    };
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

        mocks.appRuntimeAuthScopeSet.mockResolvedValue(undefined);
        mocks.recordLogout.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null, savedCredentialCount: 0 })
        );
        mocks.deleteSavedCredential.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null, savedCredentialCount: 0 })
        );
        mocks.getSavedAuthSnapshot.mockResolvedValue(savedSnapshot());
        mocks.clearCookies.mockResolvedValue(undefined);
        mocks.clearAuthCookies.mockResolvedValue(undefined);
        mocks.startLoginSession.mockResolvedValue(authenticatedState());
        mocks.respondLoginSession.mockResolvedValue(authenticatedState());
        mocks.cancelLoginSession.mockResolvedValue({ status: 'cancelled' });
        mocks.resetAutoLoginThrottle.mockResolvedValue(undefined);
        mocks.runWithRuntimeAuthFailureRecoverySuppressed.mockImplementation(
            async (task: () => Promise<unknown>) => task()
        );
        mocks.applySavedAuthSnapshot.mockImplementation(
            (snapshot: unknown) => snapshot
        );
        mocks.refreshSavedAuthSnapshot.mockResolvedValue(savedSnapshot());
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
        expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
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

        expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
        expect(mocks.startLoginSession).toHaveBeenCalledWith({
            mode: 'basic',
            endpoint: '',
            username: 'self@example.test',
            password: 'secret',
            saveCredentials: true
        });
        expect(mocks.refreshSavedAuthSnapshot).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().auth).toMatchObject({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self',
            currentUserEndpoint: '',
            currentUserWebsocket: ''
        });
        expect(useSessionStore.getState().sessionPhase).toBe('bootstrapping');
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledWith(
            user()
        );
        expect(mocks.appRuntimeAuthScopeSet).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: ''
        });
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
            method: 'emailOtp',
            code: '123456'
        });
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledWith(
            user()
        );
    });

    it('deletes saved credentials when VRChat rejects them', async () => {
        mocks.startLoginSession.mockResolvedValueOnce(
            failedState(
                'Invalid Username/Email or Password',
                'invalidCredentials'
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
                hasLoginCredentials: true
            })
        ).rejects.toMatchObject({
            code: 'AUTH_SAVED_CREDENTIALS_INVALID',
            authSnapshot: savedSnapshot({
                lastUserLoggedIn: null,
                savedCredentialCount: 0
            })
        });

        expect(mocks.clearCookies).toHaveBeenCalledTimes(1);
        expect(mocks.deleteSavedCredential).toHaveBeenCalledWith('usr_saved');
        expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
            savedSnapshot({
                lastUserLoggedIn: null,
                savedCredentialCount: 0
            })
        );
        expect(useSessionStore.getState().sessionPhase).toBe('signed_out');
    });

    it('keeps saved credentials when a generic 401 interrupts login', async () => {
        mocks.startLoginSession.mockResolvedValueOnce(
            failedState('Unauthorized', 'sessionInvalidated')
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
                hasLoginCredentials: true
            })
        ).rejects.toMatchObject({
            message: 'Unauthorized',
            kind: 'sessionInvalidated'
        });

        expect(mocks.deleteSavedCredential).not.toHaveBeenCalled();
        expect(mocks.clearCookies).not.toHaveBeenCalled();
        expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
    });

    it('rejects saved credentials that do not contain stored login data', async () => {
        await expect(
            executeSavedCredentialLogin({
                user: { id: 'usr_saved' },
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

        expect(mocks.recordLogout).not.toHaveBeenCalled();
        expect(mocks.resetAutoLoginThrottle).not.toHaveBeenCalled();
        expect(mocks.clearCookies).not.toHaveBeenCalled();
    });

    it('records logout and returns to a signed-out session', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });

        await expect(logoutFromReactShell()).resolves.toBe(true);

        expect(mocks.recordLogout).toHaveBeenCalledWith('usr_self', {
            clearLastUserLoggedIn: true
        });
        expect(mocks.clearCookies).toHaveBeenCalledTimes(1);
        expect(mocks.resetAutoLoginThrottle).toHaveBeenCalledTimes(1);
        expect(mocks.clearCookies.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.resetAutoLoginThrottle.mock.invocationCallOrder[0]
        );
        expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
            savedSnapshot({
                lastUserLoggedIn: null,
                savedCredentialCount: 0
            })
        );
        expect(useRuntimeStore.getState().auth.currentUserId).toBe(null);
        expect(useSessionStore.getState().sessionPhase).toBe('signed_out');
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            'message.auth.logout_greeting:Self'
        );
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
            expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(2);
            expect(mocks.otpPrompt).toHaveBeenCalledTimes(2);
            expect(
                mocks.otpPrompt.mock.calls.map(([prompt]) => prompt.mode)
            ).toEqual(['emailOtp', 'emailOtp']);
            expect(mocks.respondLoginSession).toHaveBeenCalledWith({
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
                hasLoginCredentials: true
            });

            expect(mocks.startLoginSession).toHaveBeenCalledWith({
                mode: 'savedCredential',
                endpoint: '',
                userId: 'usr_saved'
            });
            expect(mocks.appRuntimeAuthScopeSet).toHaveBeenCalledWith({
                userId: 'usr_saved',
                endpoint: ''
            });
        });

        it('clears the last-logged-in target for a session-recovery failure while keeping the saved credential', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                failedState('Unauthorized', 'sessionInvalidated')
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
                    hasLoginCredentials: true
                })
            ).rejects.toMatchObject({
                message: 'Unauthorized',
                kind: 'sessionInvalidated'
            });

            expect(mocks.deleteSavedCredential).not.toHaveBeenCalled();
            expect(mocks.clearCookies).not.toHaveBeenCalled();
            expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
            expect(mocks.recordLogout).toHaveBeenCalledWith('', {
                clearLastUserLoggedIn: true,
                cookies: null
            });
            expect(mocks.resetAutoLoginThrottle).not.toHaveBeenCalled();
            expect(mocks.refreshSavedAuthSnapshot).not.toHaveBeenCalled();
        });
    });

    describe('manual login failure cleanup granularity', () => {
        it('treats any 401 during manual login as unrecoverable: full cookie clear and cleared last-logged-in target', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                failedState('Unauthorized', 'invalidCredentials')
            );

            await expect(
                executeManualLogin({
                    username: 'self@example.test',
                    password: 'secret'
                })
            ).rejects.toMatchObject({
                message: 'Unauthorized',
                kind: 'invalidCredentials'
            });

            expect(mocks.clearCookies).toHaveBeenCalledTimes(1);
            expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
            expect(mocks.recordLogout).toHaveBeenCalledWith('', {
                clearLastUserLoggedIn: true,
                cookies: null
            });
            expect(mocks.refreshSavedAuthSnapshot).not.toHaveBeenCalled();
        });

        it('clears only auth cookies and the last-logged-in target for a 403 session-recovery failure', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                failedState('Forbidden', 'sessionInvalidated')
            );

            await expect(
                executeManualLogin({
                    username: 'self@example.test',
                    password: 'secret'
                })
            ).rejects.toMatchObject({
                message: 'Forbidden',
                kind: 'sessionInvalidated'
            });

            expect(mocks.clearCookies).not.toHaveBeenCalled();
            expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(2);
            expect(mocks.recordLogout).toHaveBeenCalledWith('', {
                clearLastUserLoggedIn: true,
                cookies: null
            });
            expect(mocks.refreshSavedAuthSnapshot).not.toHaveBeenCalled();
        });

        it('preserves the last-logged-in target for a non-recovery network failure', async () => {
            mocks.startLoginSession.mockResolvedValueOnce(
                failedState('Network timeout', 'network')
            );

            await expect(
                executeManualLogin({
                    username: 'self@example.test',
                    password: 'secret'
                })
            ).rejects.toMatchObject({
                message: 'Network timeout',
                kind: 'network'
            });

            expect(mocks.clearCookies).not.toHaveBeenCalled();
            expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(2);
            expect(mocks.recordLogout).not.toHaveBeenCalled();
            expect(mocks.refreshSavedAuthSnapshot).toHaveBeenCalledTimes(1);
        });
    });
});
