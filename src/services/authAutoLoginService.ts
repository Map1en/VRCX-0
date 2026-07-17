import { toast } from 'sonner';

import {
    commands,
    type AutoLoginOutcome,
    type LoginFailureKind
} from '@/platform/tauri/bindings';
import type { SavedAuthSnapshot } from '@/repositories/authRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    finalizeSuccessfulLogin,
    resolveLoginSessionState,
    toAuthUserRecord
} from './authExecutionService';
import {
    applySavedAuthSnapshot,
    refreshSavedAuthSnapshot
} from './authSnapshotService';
import i18n from './i18nService';

const MAX_AUTO_LOGIN_DELAY_SECONDS = 10;
const NOTIFY_ON_FAILURE_KINDS = new Set<LoginFailureKind>([
    'invalidCredentials',
    'twoFactorUnavailable'
]);

type AutoLoginDelayOptions = {
    signal?: AbortSignal;
    onCountdown?: (seconds: number) => void;
};

type AuthAutoLoginError = Error & {
    code?: string;
    kind?: LoginFailureKind;
    authSnapshot?: SavedAuthSnapshot;
};

function createAutoLoginAbortError() {
    const error: AuthAutoLoginError = new Error(
        'Automatic login was cancelled.'
    );
    error.code = 'AUTH_AUTO_LOGIN_CANCELLED';
    return error;
}

function autoLoginOutcomeFailureError(
    outcome: AutoLoginOutcome & { status: 'failed' }
): AuthAutoLoginError {
    const error: AuthAutoLoginError = new Error(
        outcome.reason || 'Automatic login failed.'
    );
    error.kind = outcome.kind;
    error.authSnapshot = outcome.snapshot as SavedAuthSnapshot;
    return error;
}

function shouldShowManualAuthFailureNotification(
    error: AuthAutoLoginError
): boolean {
    return (
        typeof error.kind === 'string' &&
        NOTIFY_ON_FAILURE_KINDS.has(error.kind)
    );
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
}

export async function executeReactAutoLogin(
    snapshot: SavedAuthSnapshot,
    { signal, onCountdown }: AutoLoginDelayOptions = {}
) {
    const runtimeStore = useRuntimeStore.getState();
    const displayName =
        String(snapshot?.autoLoginDisplayName || '').trim() ||
        snapshot?.lastUserLoggedIn ||
        'saved account';
    const lastUserLoggedIn = String(snapshot?.lastUserLoggedIn || '').trim();
    const throttleKey =
        String(snapshot?.autoLoginThrottleKey || '').trim() || lastUserLoggedIn;

    const cookieRestoreEligible = Boolean(snapshot?.cookieRestoreEligible);
    const savedCredentialFallbackAvailable = Boolean(
        snapshot?.savedCredentialFallbackAvailable
    );

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
        } else {
            runtimeStore.setStartupTask(
                'auth',
                'running',
                `Attempting saved-credential login for ${displayName}.`
            );
        }

        const outcome = await vrchatAuthRepository.autoLoginStart({
            endpoint: '',
            userId: throttleKey
        });
        if (signal?.aborted) {
            throw createAutoLoginAbortError();
        }

        if (outcome.status === 'throttled') {
            applySavedAuthSnapshot(outcome.snapshot as SavedAuthSnapshot);
            setSignedOutSessionState();
            runtimeStore.setStartupTask(
                'auth',
                'completed',
                `Automatic login paused for ${displayName} after too many attempts in the last hour.`
            );
            await flashWindowSafely();
            await showAuthFailureNotificationSafely(
                'frontend-auto-login-throttled'
            );
            toast.error(await i18n.t('message.auth.auto_login_failed'));
            return {
                status: 'throttled',
                snapshot: outcome.snapshot
            };
        }

        if (outcome.status === 'expired') {
            setSignedOutSessionState();
            applySavedAuthSnapshot(outcome.snapshot as SavedAuthSnapshot);
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
                snapshot: outcome.snapshot
            };
        }

        if (outcome.status === 'failed') {
            throw autoLoginOutcomeFailureError(outcome);
        }

        async function restartChallenge() {
            await vrchatAuthRepository.cancelLoginSession();
            return vrchatAuthRepository.startLoginSession({
                mode: 'savedCredential',
                endpoint: '',
                userId: throttleKey
            });
        }

        const session = await resolveLoginSessionState(
            outcome,
            restartChallenge
        );
        const refreshedSnapshot = await refreshSavedAuthSnapshot();
        const finalSnapshot = await finalizeSuccessfulLogin(
            refreshedSnapshot,
            'Authenticated automatically.',
            toAuthUserRecord(session),
            {
                endpoint: session.endpoint,
                websocket: session.websocket
            }
        );

        toast.success(await i18n.t('message.auth.auto_login_success'));
        return {
            status: 'success',
            snapshot: finalSnapshot
        };
    } catch (error) {
        const authError = error as AuthAutoLoginError;
        if (
            signal?.aborted ||
            authError?.code === 'AUTH_AUTO_LOGIN_CANCELLED'
        ) {
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
        if (shouldShowManualAuthFailureNotification(authError)) {
            await showAuthFailureNotificationSafely(
                'frontend-auto-login-failed'
            );
        }

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
