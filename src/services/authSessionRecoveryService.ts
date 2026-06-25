import { toast } from 'sonner';

import authRepository from '@/repositories/authRepository';
import {
    isVrchatSessionRecoveryError,
    setVrchatAuthFailureHandler
} from '@/repositories/vrchatRequest';
import webRepository from '@/repositories/webRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    applySavedAuthSnapshot,
    refreshSavedAuthSnapshot
} from './authSnapshotService';
import i18n from './i18nService';

type AuthExecutionServiceModule = {
    resetCurrentUserRuntimeAuth: () => void | Promise<unknown>;
    setSignedOutSessionState: () => void;
};

const authExecutionServiceLoaders =
    import.meta.glob<AuthExecutionServiceModule>('./authExecutionService.ts');

let recoveryPromise: Promise<void> | null = null;
let runtimeAuthFailureRecoverySuppressionCount = 0;

export function shouldHandleRuntimeAuthFailure(error: unknown): boolean {
    if (isRuntimeAuthFailureRecoverySuppressed()) {
        return false;
    }

    if (!isVrchatSessionRecoveryError(error)) {
        return false;
    }

    const sessionState = useSessionStore.getState();
    const runtimeState = useRuntimeStore.getState();
    return Boolean(
        sessionState.sessionPhase === 'ready' &&
        sessionState.isLoggedIn &&
        runtimeState.auth.currentUserId
    );
}

async function runRuntimeAuthRecovery(error: unknown): Promise<void> {
    if (!shouldHandleRuntimeAuthFailure(error)) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const shouldClearAutoLoginTarget = isVrchatSessionRecoveryError(error);
    const failedUserId = String(
        runtimeStore.auth.currentUserId ||
            runtimeStore.auth.lastUserLoggedIn ||
            ''
    );
    const [title, description] = await Promise.all([
        i18n.t('message.auth.session_expired'),
        i18n.t('message.auth.session_restore_available')
    ]);

    runtimeStore.setStartupTask('auth', 'running', title);
    toast.warning(title, {
        description
    });

    try {
        await webRepository.clearAuthCookies();
    } catch (clearError) {
        console.warn(
            'Failed to clear cookies after VRChat session expired:',
            clearError
        );
    }

    const loadAuthExecutionService =
        authExecutionServiceLoaders['./authExecutionService.ts'];
    if (typeof loadAuthExecutionService !== 'function') {
        throw new Error('Auth execution service is unavailable.');
    }
    const { resetCurrentUserRuntimeAuth, setSignedOutSessionState } =
        await loadAuthExecutionService();
    await resetCurrentUserRuntimeAuth();
    setSignedOutSessionState();

    try {
        if (shouldClearAutoLoginTarget) {
            applySavedAuthSnapshot(
                await authRepository.recordLogout(failedUserId, {
                    clearLastUserLoggedIn: true,
                    cookies: null
                })
            );
        } else {
            await refreshSavedAuthSnapshot();
        }
    } catch (snapshotError) {
        console.warn(
            'Failed to refresh saved auth snapshot after VRChat session expired:',
            snapshotError
        );
    }
}

export function handleRuntimeAuthFailure(
    error: unknown
): Promise<void> | undefined {
    if (!shouldHandleRuntimeAuthFailure(error)) {
        return;
    }

    if (!recoveryPromise) {
        recoveryPromise = runRuntimeAuthRecovery(error).finally(() => {
            recoveryPromise = null;
        });
    }

    return recoveryPromise;
}

function isRuntimeAuthFailureRecoverySuppressed(): boolean {
    return runtimeAuthFailureRecoverySuppressionCount > 0;
}

export async function runWithRuntimeAuthFailureRecoverySuppressed<T>(
    task: () => Promise<T>
): Promise<T> {
    runtimeAuthFailureRecoverySuppressionCount += 1;
    try {
        return await task();
    } finally {
        runtimeAuthFailureRecoverySuppressionCount = Math.max(
            0,
            runtimeAuthFailureRecoverySuppressionCount - 1
        );
    }
}

export function startRuntimeAuthFailureRecovery(): () => void {
    const unsubscribe = setVrchatAuthFailureHandler(handleRuntimeAuthFailure);

    return () => {
        unsubscribe();
    };
}
