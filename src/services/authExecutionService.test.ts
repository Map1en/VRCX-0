import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appRuntimeAuthScopeSet: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    recordLoginSuccess: vi.fn(),
    recordLogout: vi.fn(),
    deleteSavedCredential: vi.fn(),
    getSavedAuthSnapshot: vi.fn(),
    clearCookies: vi.fn(),
    clearAuthCookies: vi.fn(),
    restoreCookieSession: vi.fn(),
    loginWithBasicAuth: vi.fn(),
    loginWithSavedCredential: vi.fn(),
    verifyEmailOTP: vi.fn(),
    verifyOTP: vi.fn(),
    verifyTOTP: vi.fn(),
    getCurrentUser: vi.fn(),
    clearEntityQueryCache: vi.fn(),
    clearAvatarNameCache: vi.fn(),
    resetActivityCacheState: vi.fn(),
    resetReactAutoLoginThrottle: vi.fn(),
    runWithRuntimeAuthFailureRecoverySuppressed: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    refreshSavedAuthSnapshot: vi.fn(),
    buildAvatarWearSnapshotUpdate: vi.fn(),
    recordCurrentUserSnapshot: vi.fn(),
    resetDomainFacts: vi.fn(),
    t: vi.fn(),
    stopRealtimeTransport: vi.fn(),
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
        recordLoginSuccess: mocks.recordLoginSuccess,
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
        restoreCookieSession: mocks.restoreCookieSession,
        loginWithBasicAuth: mocks.loginWithBasicAuth,
        loginWithSavedCredential: mocks.loginWithSavedCredential,
        verifyEmailOTP: mocks.verifyEmailOTP,
        verifyOTP: mocks.verifyOTP,
        verifyTOTP: mocks.verifyTOTP,
        getCurrentUser: mocks.getCurrentUser
    }
}));

vi.mock('@/repositories/webRepository', () => ({
    default: {
        clearCookies: mocks.clearCookies,
        clearAuthCookies: mocks.clearAuthCookies
    }
}));

vi.mock('./activityCacheService', () => ({
    resetActivityCacheState: mocks.resetActivityCacheState
}));

vi.mock('./authAutoLoginState', () => ({
    resetReactAutoLoginThrottle: mocks.resetReactAutoLoginThrottle
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

vi.mock('./realtimeTransportService', () => ({
    stopRealtimeTransport: mocks.stopRealtimeTransport
}));

vi.mock('./sessionBootstrapService', () => ({
    bootstrapAuthenticatedSession: mocks.bootstrapAuthenticatedSession
}));

import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    executeCookieSessionRestore,
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

describe('authExecutionService characterization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useModalStore.getState().resetModalState();
        useModalStore.setState({
            confirm: mocks.confirm,
            otpPrompt: mocks.otpPrompt
        } as any);

        mocks.appRuntimeAuthScopeSet.mockResolvedValue(undefined);
        mocks.recordLoginSuccess.mockResolvedValue(savedSnapshot());
        mocks.recordLogout.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null, savedCredentialCount: 0 })
        );
        mocks.deleteSavedCredential.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null, savedCredentialCount: 0 })
        );
        mocks.getSavedAuthSnapshot.mockResolvedValue(savedSnapshot());
        mocks.clearCookies.mockResolvedValue(undefined);
        mocks.clearAuthCookies.mockResolvedValue(undefined);
        mocks.restoreCookieSession.mockResolvedValue({ json: user() });
        mocks.loginWithBasicAuth.mockResolvedValue({ json: user() });
        mocks.loginWithSavedCredential.mockResolvedValue({
            json: user('usr_saved')
        });
        mocks.verifyEmailOTP.mockResolvedValue({ json: {} });
        mocks.verifyOTP.mockResolvedValue({ json: {} });
        mocks.verifyTOTP.mockResolvedValue({ json: {} });
        mocks.getCurrentUser.mockResolvedValue({ json: user() });
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
        expect(mocks.loginWithBasicAuth).not.toHaveBeenCalled();
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
        expect(mocks.loginWithBasicAuth).toHaveBeenCalledWith({
            username: 'self@example.test',
            password: 'secret',
            endpoint: '',
            websocket: ''
        });
        expect(mocks.recordLoginSuccess).toHaveBeenCalledWith({
            user: user(),
            loginParams: {
                username: 'self@example.test',
                password: 'secret',
                endpoint: '',
                websocket: ''
            },
            saveCredentials: true
        });
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

    it('prefers email OTP and finishes login after fetching the current user', async () => {
        mocks.loginWithBasicAuth.mockResolvedValueOnce({
            json: {
                requiresTwoFactorAuth: ['emailOtp', 'totp']
            }
        });
        mocks.getCurrentUser.mockResolvedValueOnce({ json: user() });

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
        expect(mocks.verifyEmailOTP).toHaveBeenCalledWith({
            code: '123456',
            endpoint: ''
        });
        expect(mocks.getCurrentUser).toHaveBeenCalledWith({ endpoint: '' });
        expect(mocks.recordLoginSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                user: user(),
                saveCredentials: false
            })
        );
    });

    it('restores authenticated cookie sessions without clearing auth state', async () => {
        await expect(
            executeCookieSessionRestore({
                endpoint: 'https://api.example.test'
            })
        ).resolves.toMatchObject(savedSnapshot());

        expect(mocks.restoreCookieSession).toHaveBeenCalledWith({
            endpoint: 'https://api.example.test'
        });
        expect(mocks.refreshSavedAuthSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
        expect(mocks.clearCookies).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().auth).toMatchObject({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test'
        });
    });

    it('surfaces missing cookie credentials without recovery cleanup', async () => {
        const error = Object.assign(new Error('Missing Credentials'), {
            status: 401
        });
        mocks.restoreCookieSession.mockRejectedValueOnce(error);

        await expect(executeCookieSessionRestore()).rejects.toBe(error);

        expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
        expect(mocks.clearCookies).not.toHaveBeenCalled();
        expect(mocks.refreshSavedAuthSnapshot).not.toHaveBeenCalled();
    });

    it('deletes saved credentials when VRChat rejects them', async () => {
        const error = Object.assign(
            new Error('Invalid Username/Email or Password'),
            { status: 401 }
        );
        mocks.loginWithSavedCredential.mockRejectedValueOnce(error);

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
            } as any)
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
        const error = Object.assign(new Error('Unauthorized'), { status: 401 });
        mocks.loginWithSavedCredential.mockRejectedValueOnce(error);

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
            } as any)
        ).rejects.toBe(error);

        expect(mocks.deleteSavedCredential).not.toHaveBeenCalled();
        expect(mocks.clearCookies).not.toHaveBeenCalled();
        expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
    });

    it('rejects saved credentials that do not contain stored login data', async () => {
        await expect(
            executeSavedCredentialLogin({
                user: { id: 'usr_saved' },
                hasLoginCredentials: false
            } as any)
        ).rejects.toMatchObject({
            code: 'AUTH_SAVED_CREDENTIALS_INVALID'
        });
        expect(mocks.loginWithSavedCredential).not.toHaveBeenCalled();
    });

    it('does not persist logout when the confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValueOnce({ ok: false });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self'
        });

        await expect(logoutFromReactShell()).resolves.toBe(false);

        expect(mocks.recordLogout).not.toHaveBeenCalled();
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
        expect(mocks.resetReactAutoLoginThrottle).toHaveBeenCalledTimes(1);
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
});
