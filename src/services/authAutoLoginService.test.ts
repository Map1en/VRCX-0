import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastDismiss: vi.fn(),
    appFlashWindow: vi.fn(),
    appAuthFailureNotificationShow: vi.fn(),
    recordLogout: vi.fn(),
    clearAuthCookies: vi.fn(),
    resetActivityCacheState: vi.fn(),
    canAttemptReactAutoLogin: vi.fn(),
    recordReactAutoLoginAttempt: vi.fn(),
    executeCookieSessionRestore: vi.fn(),
    executeSavedCredentialLogin: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    t: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError,
        info: mocks.toastInfo,
        dismiss: mocks.toastDismiss
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFlashWindow: mocks.appFlashWindow,
        appAuthFailureNotificationShow: mocks.appAuthFailureNotificationShow
    }
}));

vi.mock('@/repositories/authRepository', () => ({
    default: {
        recordLogout: mocks.recordLogout
    }
}));

vi.mock('@/repositories/webRepository', () => ({
    default: {
        clearAuthCookies: mocks.clearAuthCookies
    }
}));

vi.mock('./activityCacheService', () => ({
    resetActivityCacheState: mocks.resetActivityCacheState
}));

vi.mock('./authAutoLoginState', () => ({
    AUTO_LOGIN_MAX_ATTEMPTS: 3,
    canAttemptReactAutoLogin: mocks.canAttemptReactAutoLogin,
    recordReactAutoLoginAttempt: mocks.recordReactAutoLoginAttempt
}));

vi.mock('./authExecutionService', () => ({
    executeCookieSessionRestore: mocks.executeCookieSessionRestore,
    executeSavedCredentialLogin: mocks.executeSavedCredentialLogin
}));

vi.mock('./authSnapshotService', () => ({
    applySavedAuthSnapshot: mocks.applySavedAuthSnapshot
}));

vi.mock('./i18nService', () => ({
    default: {
        t: mocks.t
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { executeReactAutoLogin } from './authAutoLoginService';

function savedCredential() {
    return {
        user: {
            id: 'usr_1',
            displayName: 'User One'
        },
        loginParams: {
            username: 'user@example.test'
        },
        hasLoginCredentials: true
    };
}

function snapshot(patch: Record<string, unknown> = {}) {
    return {
        lastUserLoggedIn: 'usr_1',
        savedCredentialCount: 1,
        autoLoginStatus: 'available',
        autoLoginReason: 'Saved credentials are available.',
        autoLoginDisplayName: 'User One',
        autoLoginThrottleKey: 'usr_1',
        cookieRestoreEligible: true,
        savedCredentialFallbackAvailable: true,
        autoLoginTarget: savedCredential(),
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        ...patch
    };
}

describe('authAutoLoginService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        mocks.canAttemptReactAutoLogin.mockReturnValue(true);
        mocks.executeCookieSessionRestore.mockResolvedValue(
            snapshot({
                status: 'restored'
            })
        );
        mocks.executeSavedCredentialLogin.mockResolvedValue(
            snapshot({
                status: 'saved'
            })
        );
        mocks.recordLogout.mockResolvedValue(
            snapshot({
                lastUserLoggedIn: null,
                autoLoginTarget: null
            })
        );
        mocks.clearAuthCookies.mockResolvedValue(undefined);
        mocks.appFlashWindow.mockResolvedValue(undefined);
        mocks.appAuthFailureNotificationShow.mockResolvedValue(undefined);
        mocks.applySavedAuthSnapshot.mockImplementation(
            (value: unknown) => value
        );
        mocks.t.mockImplementation(
            (key: string, params?: Record<string, unknown>) =>
                params?.seconds ? `${key}:${params.seconds}` : key
        );
        mocks.toastInfo.mockReturnValue('toast-id');
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: true
        });
    });

    it('skips when neither cookie restore nor saved credential fallback is eligible', async () => {
        await expect(
            executeReactAutoLogin(
                snapshot({
                    cookieRestoreEligible: false,
                    savedCredentialFallbackAvailable: false,
                    autoLoginTarget: null
                })
            )
        ).resolves.toMatchObject({
            status: 'skipped'
        });

        expect(mocks.executeCookieSessionRestore).not.toHaveBeenCalled();
        expect(mocks.executeSavedCredentialLogin).not.toHaveBeenCalled();
    });

    it('restores an eligible cookie session and reports success', async () => {
        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'success',
            snapshot: expect.objectContaining({
                status: 'restored'
            })
        });

        expect(mocks.recordReactAutoLoginAttempt).toHaveBeenCalledWith('usr_1');
        expect(mocks.executeCookieSessionRestore).toHaveBeenCalledTimes(1);
        expect(mocks.executeSavedCredentialLogin).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            'message.auth.auto_login_success'
        );
    });

    it('falls back to saved credentials after a missing-cookie session', async () => {
        mocks.executeCookieSessionRestore.mockRejectedValueOnce(
            Object.assign(new Error('Missing Credentials'), {
                status: 401
            })
        );

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'success',
            snapshot: expect.objectContaining({
                status: 'saved'
            })
        });

        expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
        expect(mocks.executeSavedCredentialLogin).toHaveBeenCalledWith(
            savedCredential()
        );
    });

    it('clears the auto-login target and notifies when attempts are throttled', async () => {
        mocks.canAttemptReactAutoLogin.mockReturnValueOnce(false);

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'throttled'
        });

        expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
        expect(mocks.recordLogout).toHaveBeenCalledWith('usr_1', {
            clearLastUserLoggedIn: true,
            cookies: null
        });
        expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.appFlashWindow).toHaveBeenCalledTimes(1);
        expect(mocks.appAuthFailureNotificationShow).toHaveBeenCalledWith(
            'frontend-auto-login-throttled'
        );
        expect(mocks.toastError).toHaveBeenCalledWith(
            'message.auth.auto_login_failed'
        );
        expect(useSessionStore.getState()).toMatchObject({
            sessionPhase: 'signed_out',
            isLoggedIn: false
        });
    });

    it('returns a cancelled result when the auto-login delay is aborted before waiting', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            executeReactAutoLogin(
                snapshot({
                    autoLoginDelayEnabled: true,
                    autoLoginDelaySeconds: 5
                }),
                { signal: controller.signal }
            )
        ).resolves.toMatchObject({
            status: 'cancelled'
        });

        expect(mocks.executeCookieSessionRestore).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().startup.auth).toMatchObject({
            status: 'completed',
            detail: 'Automatic login countdown was cancelled.'
        });
    });

    it('does not show a system auth notification when auto-login fails offline', async () => {
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false
        });
        mocks.executeCookieSessionRestore.mockRejectedValueOnce(
            new Error('Network unavailable')
        );

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'failed'
        });

        expect(mocks.toastError).toHaveBeenCalledWith('message.auth.offline');
        expect(mocks.appAuthFailureNotificationShow).not.toHaveBeenCalled();
    });

    it('shows a system auth notification when saved credentials require manual login', async () => {
        mocks.executeSavedCredentialLogin.mockRejectedValueOnce(
            Object.assign(new Error('Saved credentials are no longer valid.'), {
                code: 'AUTH_SAVED_CREDENTIALS_INVALID'
            })
        );

        await expect(
            executeReactAutoLogin(
                snapshot({
                    cookieRestoreEligible: false
                })
            )
        ).resolves.toMatchObject({
            status: 'failed'
        });

        expect(mocks.appAuthFailureNotificationShow).toHaveBeenCalledWith(
            'frontend-auto-login-failed'
        );
    });
});
