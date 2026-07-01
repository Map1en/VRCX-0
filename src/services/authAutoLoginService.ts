import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import authRepository, {
    type SavedAuthSnapshot,
    type SavedCredentialRecord
} from '@/repositories/authRepository';
import webRepository from '@/repositories/webRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { resetActivityCacheState } from './activityCacheService';
import {
    AUTO_LOGIN_MAX_ATTEMPTS,
    canAttemptReactAutoLogin,
    recordReactAutoLoginAttempt
} from './authAutoLoginState';
import {
    executeCookieSessionRestore,
    executeSavedCredentialLogin
} from './authExecutionService';
import { applySavedAuthSnapshot } from './authSnapshotService';
import i18n from './i18nService';

const MAX_AUTO_LOGIN_DELAY_SECONDS = 10;

type AutoLoginDelayOptions = {
    signal?: AbortSignal;
    onCountdown?: (seconds: number) => void;
};

type AuthAutoLoginError = Error & {
    code?: string;
    authSnapshot?: SavedAuthSnapshot;
};

function createAutoLoginAbortError() {
    const error: AuthAutoLoginError = new Error(
        'Automatic login was cancelled.'
    );
    error.code = 'AUTH_AUTO_LOGIN_CANCELLED';
    return error;
}

function isMissingCredentialsError(error: unknown) {
    return Boolean(
        isRecord(error) &&
        error.status === 401 &&
        typeof error.message === 'string' &&
        error.message.includes('Missing Credentials')
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallbackMessage;
}

function normalizeAutoLoginDelaySeconds(seconds: unknown) {
    const parsed =
        typeof seconds === 'number'
            ? seconds
            : Number.parseInt(String(seconds ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.min(
        MAX_AUTO_LOGIN_DELAY_SECONDS,
        Math.max(0, Math.trunc(parsed))
    );
}

function waitForAutoLoginDelay(
    seconds: unknown,
    { signal, onCountdown }: AutoLoginDelayOptions = {}
) {
    const delaySeconds = normalizeAutoLoginDelaySeconds(seconds);
    if (delaySeconds <= 0) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAutoLoginAbortError());
            return;
        }

        const deadline = Date.now() + delaySeconds * 1000;
        let timeoutId: ReturnType<typeof window.setTimeout> | null = null;
        let lastRemainingSeconds: number | null = null;
        let settled = false;

        function cleanup() {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
            signal?.removeEventListener('abort', onAbort);
        }

        function markSettled(): boolean {
            if (settled) {
                return false;
            }
            settled = true;
            cleanup();
            return true;
        }

        function settleResolve() {
            if (markSettled()) {
                resolve();
            }
        }

        function settleReject(reason: unknown) {
            if (markSettled()) {
                reject(reason);
            }
        }

        function onAbort() {
            settleReject(createAutoLoginAbortError());
        }

        function tick() {
            if (signal?.aborted) {
                onAbort();
                return;
            }

            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                settleResolve();
                return;
            }

            const remainingSeconds = Math.ceil(remainingMs / 1000);
            if (remainingSeconds !== lastRemainingSeconds) {
                lastRemainingSeconds = remainingSeconds;
                onCountdown?.(remainingSeconds);
            }

            timeoutId = window.setTimeout(
                tick,
                Math.min(1000, Math.max(1, remainingMs))
            );
        }

        signal?.addEventListener('abort', onAbort, { once: true });
        tick();
    });
}

async function applyAutoLoginDelay(
    seconds: unknown,
    { signal, onCountdown }: AutoLoginDelayOptions = {}
) {
    const delaySeconds = normalizeAutoLoginDelaySeconds(seconds);
    if (delaySeconds <= 0) {
        onCountdown?.(0);
        return;
    }

    const message = await i18n.t('message.auto_login_delay_countdown', {
        seconds: delaySeconds
    });
    if (signal?.aborted) {
        throw createAutoLoginAbortError();
    }

    const toastId = toast.info(message, {
        duration: delaySeconds * 1000
    });
    try {
        await waitForAutoLoginDelay(delaySeconds, { signal, onCountdown });
    } finally {
        toast.dismiss(toastId);
        onCountdown?.(0);
    }
}

async function flashWindowSafely() {
    try {
        await commands.appFlashWindow();
    } catch {
        // no-op
    }
}

async function showAuthFailureNotificationSafely(reason: string) {
    try {
        await commands.appAuthFailureNotificationShow(reason);
    } catch (error) {
        console.warn('Failed to show auth failure notification:', error);
    }
}

function setSignedOutSessionState() {
    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'signed_out'
    });
    resetActivityCacheState();
}

export async function executeReactAutoLogin(
    snapshot: SavedAuthSnapshot,
    { signal, onCountdown }: AutoLoginDelayOptions = {}
) {
    const runtimeStore = useRuntimeStore.getState();
    const savedCredential: SavedCredentialRecord | null = isRecord(
        snapshot?.autoLoginTarget
    )
        ? (snapshot.autoLoginTarget as SavedCredentialRecord)
        : null;
    const displayName =
        String(snapshot?.autoLoginDisplayName || '').trim() ||
        snapshot?.lastUserLoggedIn ||
        'saved account';
    const lastUserLoggedIn = String(snapshot?.lastUserLoggedIn || '').trim();
    const throttleKey =
        String(snapshot?.autoLoginThrottleKey || '').trim() || lastUserLoggedIn;

    const cookieRestoreEligible = Boolean(snapshot?.cookieRestoreEligible);
    const savedCredentialFallbackAvailable = Boolean(
        snapshot?.savedCredentialFallbackAvailable && savedCredential
    );

    if (!cookieRestoreEligible && !savedCredentialFallbackAvailable) {
        return {
            status: 'skipped',
            snapshot
        };
    }

    let didRecordAutoLoginAttempt = false;
    function recordAutoLoginAttemptBeforeRequest() {
        if (didRecordAutoLoginAttempt) {
            return;
        }
        recordReactAutoLoginAttempt(throttleKey);
        didRecordAutoLoginAttempt = true;
    }

    try {
        if (!canAttemptReactAutoLogin(throttleKey)) {
            try {
                await webRepository.clearAuthCookies();
            } catch {
                // no-op
            }
            setSignedOutSessionState();
            const throttledSnapshot = applySavedAuthSnapshot(
                await authRepository.recordLogout(lastUserLoggedIn, {
                    clearLastUserLoggedIn: true,
                    cookies: null
                })
            );
            runtimeStore.setStartupTask(
                'auth',
                'completed',
                `Automatic login paused for ${displayName} after ${AUTO_LOGIN_MAX_ATTEMPTS} attempts in the last hour.`
            );
            await flashWindowSafely();
            await showAuthFailureNotificationSafely(
                'frontend-auto-login-throttled'
            );
            toast.error(await i18n.t('message.auth.auto_login_failed'));
            return {
                status: 'throttled',
                snapshot: throttledSnapshot
            };
        }

        if (cookieRestoreEligible) {
            runtimeStore.setStartupTask(
                'auth',
                'running',
                `Restoring an existing browser session for ${displayName}.`
            );

            await applyAutoLoginDelay(
                snapshot.autoLoginDelayEnabled
                    ? snapshot.autoLoginDelaySeconds
                    : 0,
                {
                    signal,
                    onCountdown
                }
            );

            if (signal?.aborted) {
                throw createAutoLoginAbortError();
            }

            try {
                recordAutoLoginAttemptBeforeRequest();
                const restoredSnapshot = await executeCookieSessionRestore();
                toast.success(await i18n.t('message.auth.auto_login_success'));
                return {
                    status: 'success',
                    snapshot: restoredSnapshot
                };
            } catch (error) {
                if (!isMissingCredentialsError(error)) {
                    throw error;
                }
            }

            await webRepository.clearAuthCookies();
        }

        if (!savedCredentialFallbackAvailable || !savedCredential) {
            setSignedOutSessionState();
            applySavedAuthSnapshot(snapshot);
            runtimeStore.setStartupTask(
                'auth',
                'completed',
                'The previous browser session expired and no saved credentials are available for fallback auto-login.'
            );
            await showAuthFailureNotificationSafely(
                'frontend-auto-login-expired'
            );
            return {
                status: 'expired',
                snapshot
            };
        }

        runtimeStore.setStartupTask(
            'auth',
            'running',
            `Attempting saved-credential login for ${displayName}.`
        );
        recordAutoLoginAttemptBeforeRequest();
        const nextSnapshot = await executeSavedCredentialLogin(savedCredential);

        toast.success(await i18n.t('message.auth.auto_login_success'));
        return {
            status: 'success',
            snapshot: nextSnapshot
        };
    } catch (error) {
        const authError = error as AuthAutoLoginError;
        if (authError?.code === 'AUTH_AUTO_LOGIN_CANCELLED') {
            runtimeStore.setStartupTask(
                'auth',
                'completed',
                'Automatic login countdown was cancelled.'
            );
            return {
                status: 'cancelled',
                snapshot
            };
        }

        if (authError?.authSnapshot) {
            applySavedAuthSnapshot(authError.authSnapshot);
        }

        runtimeStore.setStartupTask(
            'auth',
            'error',
            error instanceof Error ? error.message : String(error)
        );
        toast.error(
            getErrorMessage(
                error,
                await i18n.t('message.auth.auto_login_failed')
            )
        );
        await showAuthFailureNotificationSafely('frontend-auto-login-failed');

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            toast.error(await i18n.t('message.auth.offline'));
        }

        return {
            status: 'failed',
            snapshot: authError?.authSnapshot ?? snapshot,
            error
        };
    }
}
