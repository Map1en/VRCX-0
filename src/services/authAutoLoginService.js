import { toast } from 'sonner';

import { backend } from '@/platform/index.js';
import { webRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { resetActivityCacheState } from './activityCacheService.js';
import {
    AUTO_LOGIN_MAX_ATTEMPTS,
    canAttemptReactAutoLogin,
    recordReactAutoLoginAttempt
} from './authAutoLoginState.js';
import {
    executeCookieSessionRestore,
    executeSavedCredentialLogin
} from './authExecutionService.js';
import { applySavedAuthSnapshot } from './authSnapshotService.js';
import i18n from './i18nService.js';

function createAutoLoginAbortError() {
    const error = new Error('Automatic login was cancelled.');
    error.code = 'AUTH_AUTO_LOGIN_CANCELLED';
    return error;
}

function getAutoLoginTarget(snapshot) {
    const userId = snapshot?.lastUserLoggedIn;
    if (!userId) {
        return null;
    }

    return snapshot?.savedCredentials?.[userId] ?? null;
}

function shouldAttemptCookieRestore(snapshot) {
    return Boolean(snapshot?.lastUserLoggedIn);
}

function getAutoLoginThrottleKey(savedCredential) {
    const userId = savedCredential?.user?.id || '';
    const endpoint = savedCredential?.loginParams?.endpoint || '';
    return `${userId}\u0000${endpoint}`;
}

function isMissingCredentialsError(error) {
    return Boolean(
        error?.status === 401 &&
        typeof error?.message === 'string' &&
        error.message.includes('Missing Credentials')
    );
}

function waitWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAutoLoginAbortError());
            return;
        }

        const timeoutId = window.setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        function onAbort() {
            window.clearTimeout(timeoutId);
            cleanup();
            reject(createAutoLoginAbortError());
        }

        function cleanup() {
            signal?.removeEventListener('abort', onAbort);
        }

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function applyAutoLoginDelay(seconds, { signal, onCountdown } = {}) {
    if (!seconds || seconds <= 0) {
        onCountdown?.(0);
        return;
    }

    let toastId = null;

    try {
        for (let remaining = seconds; remaining > 0; remaining -= 1) {
            const message = await i18n.t(
                'message.auto_login_delay_countdown',
                {
                    seconds: remaining
                }
            );
            if (toastId) {
                toast.dismiss(toastId);
            }
            toastId = toast.info(message, { duration: Infinity });
            onCountdown?.(remaining);
            await waitWithAbort(1000, signal);
        }
    } finally {
        if (toastId) {
            toast.dismiss(toastId);
        }
        onCountdown?.(0);
    }
}

async function flashWindowSafely() {
    try {
        await backend.app.FlashWindow();
    } catch {
        // ignore host gaps during auth bootstrap
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
    snapshot,
    { signal, onCountdown } = {}
) {
    const runtimeStore = useRuntimeStore.getState();
    const savedCredential = getAutoLoginTarget(snapshot);
    const displayName =
        savedCredential?.user?.displayName ||
        savedCredential?.user?.username ||
        savedCredential?.user?.id ||
        snapshot?.lastUserLoggedIn ||
        'saved account';

    const cookieRestoreEligible = shouldAttemptCookieRestore(snapshot);
    const restoreEndpoint = savedCredential?.loginParams?.endpoint || '';
    const savedCredentialFallbackAvailable =
        snapshot?.autoLoginStatus === 'available' && Boolean(savedCredential);

    if (!cookieRestoreEligible && !savedCredentialFallbackAvailable) {
        return {
            status: 'skipped',
            snapshot
        };
    }

    try {
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
                const restoredSnapshot = await executeCookieSessionRestore({
                    endpoint: restoreEndpoint
                });
                toast.success(
                    await i18n.t(
                        'message.auth.auto_login_success'
                    )
                );
                return {
                    status: 'success',
                    snapshot: restoredSnapshot
                };
            } catch (error) {
                if (!isMissingCredentialsError(error)) {
                    throw error;
                }
            }

            await webRepository.clearCookies();
        }

        if (!savedCredentialFallbackAvailable || !savedCredential) {
            setSignedOutSessionState();
            applySavedAuthSnapshot(snapshot);
            runtimeStore.setStartupTask(
                'auth',
                'completed',
                'The previous browser session expired and no saved credentials are available for fallback auto-login.'
            );
            return {
                status: 'expired',
                snapshot
            };
        }

        const throttleKey = getAutoLoginThrottleKey(savedCredential);
        if (!canAttemptReactAutoLogin(throttleKey)) {
            await webRepository.clearCookies();
            setSignedOutSessionState();
            applySavedAuthSnapshot(snapshot);
            runtimeStore.setStartupTask(
                'auth',
                'completed',
                `Automatic login paused for ${displayName} after ${AUTO_LOGIN_MAX_ATTEMPTS} attempts in the last hour.`
            );
            await flashWindowSafely();
            toast.error(
                await i18n.t('message.auth.auto_login_failed')
            );
            return {
                status: 'throttled',
                snapshot
            };
        }

        runtimeStore.setStartupTask(
            'auth',
            'running',
            `Attempting saved-credential login for ${displayName}.`
        );
        recordReactAutoLoginAttempt(throttleKey);
        const nextSnapshot = await executeSavedCredentialLogin(savedCredential);

        toast.success(
            await i18n.t('message.auth.auto_login_success')
        );
        return {
            status: 'success',
            snapshot: nextSnapshot
        };
    } catch (error) {
        if (error?.code === 'AUTH_AUTO_LOGIN_CANCELLED') {
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

        if (error?.authSnapshot) {
            applySavedAuthSnapshot(error.authSnapshot);
        }

        runtimeStore.setStartupTask(
            'auth',
            'error',
            error instanceof Error ? error.message : String(error)
        );
        toast.error(
            await i18n.t('message.auth.auto_login_failed')
        );

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            toast.error(await i18n.t('message.auth.offline'));
        }

        return {
            status: 'failed',
            snapshot: error?.authSnapshot ?? snapshot,
            error
        };
    }
}
