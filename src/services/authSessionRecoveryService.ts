import { toast } from 'sonner';

import { webRepository } from '@/repositories/index.js';
import {
    isVrchatMissingCredentialsError,
    setVrchatAuthFailureHandler
} from '@/repositories/vrchatRequest.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { refreshSavedAuthSnapshot } from './authSnapshotService.js';
import i18n from './i18nService.js';

type AuthExecutionServiceModule = {
    resetCurrentUserRuntimeAuth: () => void;
    setSignedOutSessionState: () => void;
};

const authExecutionServiceLoaders =
    import.meta.glob<AuthExecutionServiceModule>('./authExecutionService.js');

let recoveryPromise: Promise<void> | null = null;

function shouldHandleRuntimeAuthFailure(error: unknown): boolean {
    if (!isVrchatMissingCredentialsError(error)) {
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
    const [title, description] = await Promise.all([
        i18n.t('message.auth.session_expired'),
        i18n.t('message.auth.session_restore_available')
    ]);

    runtimeStore.setStartupTask('auth', 'running', title);
    toast.warning(title, {
        description
    });

    try {
        await webRepository.clearCookies();
    } catch (clearError) {
        console.warn(
            'Failed to clear cookies after VRChat session expired:',
            clearError
        );
    }

    const loadAuthExecutionService =
        authExecutionServiceLoaders['./authExecutionService.js'];
    if (typeof loadAuthExecutionService !== 'function') {
        throw new Error('Auth execution service is unavailable.');
    }
    const { resetCurrentUserRuntimeAuth, setSignedOutSessionState } =
        await loadAuthExecutionService();
    setSignedOutSessionState();
    resetCurrentUserRuntimeAuth();

    try {
        await refreshSavedAuthSnapshot();
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

export function startRuntimeAuthFailureRecovery(): () => void {
    const unsubscribe = setVrchatAuthFailureHandler(handleRuntimeAuthFailure);

    return () => {
        unsubscribe();
    };
}
