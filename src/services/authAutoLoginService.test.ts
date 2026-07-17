import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastDismiss: vi.fn(),
    appFlashWindow: vi.fn(),
    appAuthFailureNotificationShow: vi.fn(),
    autoLoginStart: vi.fn(),
    cancelLoginSession: vi.fn(),
    startLoginSession: vi.fn(),
    resolveLoginSessionState: vi.fn(),
    finalizeSuccessfulLogin: vi.fn(),
    toAuthUserRecord: vi.fn(),
    applySavedAuthSnapshot: vi.fn(),
    refreshSavedAuthSnapshot: vi.fn(),
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

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: {
        autoLoginStart: mocks.autoLoginStart,
        cancelLoginSession: mocks.cancelLoginSession,
        startLoginSession: mocks.startLoginSession
    }
}));

vi.mock('./authExecutionService', () => ({
    resolveLoginSessionState: mocks.resolveLoginSessionState,
    finalizeSuccessfulLogin: mocks.finalizeSuccessfulLogin,
    toAuthUserRecord: mocks.toAuthUserRecord
}));

vi.mock('./authSnapshotService', () => ({
    applySavedAuthSnapshot: mocks.applySavedAuthSnapshot,
    refreshSavedAuthSnapshot: mocks.refreshSavedAuthSnapshot
}));

vi.mock('./i18nService', () => ({
    default: {
        t: mocks.t
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { executeReactAutoLogin } from './authAutoLoginService';

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
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        ...patch
    };
}

function authenticatedSession() {
    return {
        userId: 'usr_1',
        displayName: 'User One',
        endpoint: '',
        websocket: '',
        currentUser: { id: 'usr_1', displayName: 'User One' }
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('authAutoLoginService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        mocks.autoLoginStart.mockResolvedValue({
            status: 'authenticated',
            session: authenticatedSession()
        });
        mocks.resolveLoginSessionState.mockImplementation(
            async (outcome: { status: string; session?: unknown }) =>
                outcome.status === 'authenticated'
                    ? outcome.session
                    : authenticatedSession()
        );
        mocks.toAuthUserRecord.mockImplementation(
            (session: { currentUser: unknown }) => session.currentUser
        );
        mocks.refreshSavedAuthSnapshot.mockResolvedValue(
            snapshot({ status: 'refreshed' })
        );
        mocks.finalizeSuccessfulLogin.mockResolvedValue(
            snapshot({ status: 'finalized' })
        );
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
                    savedCredentialFallbackAvailable: false
                })
            )
        ).resolves.toMatchObject({
            status: 'skipped'
        });

        expect(mocks.autoLoginStart).not.toHaveBeenCalled();
    });

    it('reports success once the backend orchestration authenticates (cookie restore or saved-credential fallback)', async () => {
        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'success',
            snapshot: expect.objectContaining({ status: 'finalized' })
        });

        expect(mocks.autoLoginStart).toHaveBeenCalledWith({
            endpoint: '',
            userId: 'usr_1'
        });
        expect(mocks.finalizeSuccessfulLogin).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'refreshed' }),
            'Authenticated automatically.',
            authenticatedSession().currentUser,
            { endpoint: '', websocket: '' }
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            'message.auth.auto_login_success'
        );
    });

    it('prompts for a two-factor code when the saved-credential fallback requires it', async () => {
        mocks.autoLoginStart.mockResolvedValueOnce({
            status: 'challenge',
            methods: ['totp', 'otp'],
            mode: 'totp',
            error: null
        });

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'success'
        });

        expect(mocks.resolveLoginSessionState).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'challenge', mode: 'totp' }),
            expect.any(Function)
        );
    });

    it('clears the auto-login target and notifies when attempts are throttled', async () => {
        mocks.autoLoginStart.mockResolvedValueOnce({
            status: 'throttled',
            snapshot: snapshot({ lastUserLoggedIn: null })
        });

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'throttled'
        });

        expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ lastUserLoggedIn: null })
        );
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

    it('reports expired when there is no cookie session and no saved-credential fallback', async () => {
        mocks.autoLoginStart.mockResolvedValueOnce({
            status: 'expired',
            snapshot: snapshot()
        });

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'expired'
        });

        expect(mocks.appAuthFailureNotificationShow).toHaveBeenCalledWith(
            'frontend-auto-login-expired'
        );
        expect(mocks.toastError).not.toHaveBeenCalled();
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

        expect(mocks.autoLoginStart).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().startup.auth).toMatchObject({
            status: 'completed',
            detail: 'Automatic login countdown was cancelled.'
        });
    });

    it('ignores a backend outcome that arrives after the auto-login signal is aborted', async () => {
        const deferred = createDeferred<{
            status: 'authenticated';
            session: ReturnType<typeof authenticatedSession>;
        }>();
        mocks.autoLoginStart.mockReturnValueOnce(deferred.promise);
        const controller = new AbortController();

        const resultPromise = executeReactAutoLogin(snapshot(), {
            signal: controller.signal
        });
        await vi.waitFor(() => {
            expect(mocks.autoLoginStart).toHaveBeenCalledTimes(1);
        });

        controller.abort();
        deferred.resolve({
            status: 'authenticated',
            session: authenticatedSession()
        });

        await expect(resultPromise).resolves.toMatchObject({
            status: 'cancelled'
        });
        expect(mocks.resolveLoginSessionState).not.toHaveBeenCalled();
        expect(mocks.finalizeSuccessfulLogin).not.toHaveBeenCalled();
    });

    it('does not show a system auth notification when auto-login fails offline', async () => {
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false
        });
        mocks.autoLoginStart.mockResolvedValueOnce({
            status: 'failed',
            reason: 'Network unavailable',
            kind: 'network',
            snapshot: snapshot()
        });

        await expect(executeReactAutoLogin(snapshot())).resolves.toMatchObject({
            status: 'failed'
        });

        expect(mocks.toastError).toHaveBeenCalledWith('message.auth.offline');
        expect(mocks.appAuthFailureNotificationShow).not.toHaveBeenCalled();
    });

    it('shows a system auth notification when saved credentials require manual login', async () => {
        mocks.autoLoginStart.mockResolvedValueOnce({
            status: 'failed',
            reason: 'Saved credentials are no longer valid.',
            kind: 'invalidCredentials',
            snapshot: snapshot({ lastUserLoggedIn: null })
        });

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
        expect(mocks.applySavedAuthSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ lastUserLoggedIn: null })
        );
    });
});
