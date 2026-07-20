import { toast } from 'sonner';

import type { RuntimeVrchatAuthFailurePayload } from '@/platform/tauri/bindings';
import authRepository from '@/repositories/authRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    beginAuthAttempt,
    isCurrentAuthAttempt,
    type AuthAttempt
} from './authAttempt';
import {
    resetCurrentUserRuntimeAuth,
    setSignedOutSessionState
} from './authExecutionService';
import { applySavedAuthSnapshot } from './authSnapshotService';
import i18n from './i18nService';

let recoveryRun: {
    attempt: AuthAttempt;
    key: string;
    promise: Promise<void>;
} | null = null;

type AuthSessionEndInput = Parameters<typeof authRepository.endSession>[0];

function recoveryKey(input: AuthSessionEndInput): string {
    if (input.kind !== 'invalidated') {
        return input.kind;
    }
    const scopeKey = `${input.expectedUserId}:${input.expectedAuthScopeGeneration}`;
    const transport = input.expectedRealtimeTransport;
    return transport
        ? `${scopeKey}:${transport.clientRunId}:${transport.generation}:${transport.sessionGeneration}`
        : `${scopeKey}:session`;
}

function currentRecoveryInput(
    failure: RuntimeVrchatAuthFailurePayload
): AuthSessionEndInput | null {
    const realtimeTransport = failure.realtimeTransport ?? null;
    if (
        failure.statusCode !== 401 &&
        !(failure.statusCode === 403 && realtimeTransport)
    ) {
        return null;
    }

    const sessionState = useSessionStore.getState();
    const runtimeState = useRuntimeStore.getState();
    const userId = runtimeState.auth.currentUserId;
    if (
        sessionState.sessionPhase !== 'ready' ||
        !sessionState.isLoggedIn ||
        !userId ||
        failure.ownerUserId !== userId
    ) {
        return null;
    }
    return {
        kind: 'invalidated',
        expectedUserId: userId,
        expectedAuthScopeGeneration: failure.authScopeGeneration,
        expectedRealtimeTransport: realtimeTransport
    };
}

async function runRuntimeAuthRecovery(
    endInput: AuthSessionEndInput,
    attempt: AuthAttempt
): Promise<void> {
    if (endInput.kind !== 'invalidated') {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    if (
        runtimeStore.auth.currentUserId !== endInput.expectedUserId ||
        !isCurrentAuthAttempt(attempt)
    ) {
        return;
    }
    const [title, description] = await Promise.all([
        i18n.t('message.auth.session_expired'),
        i18n.t('message.auth.session_restore_available')
    ]);
    if (!isCurrentAuthAttempt(attempt)) {
        return;
    }

    runtimeStore.setStartupTask('auth', 'running', title);
    toast.warning(title, {
        description
    });

    let snapshot: Awaited<ReturnType<typeof authRepository.endSession>>;
    try {
        snapshot = await authRepository.endSession(endInput);
    } catch (endError) {
        console.warn('Failed to end the invalid VRChat session:', endError);
        return;
    }
    if (!isCurrentAuthAttempt(attempt)) {
        return;
    }
    if (!snapshot) {
        return;
    }
    resetCurrentUserRuntimeAuth();
    setSignedOutSessionState();
    applySavedAuthSnapshot(snapshot);
}

export function handleRuntimeAuthFailure(
    failure: RuntimeVrchatAuthFailurePayload
): Promise<void> | undefined {
    const endInput = currentRecoveryInput(failure);
    if (!endInput) {
        return;
    }

    const key = recoveryKey(endInput);
    if (recoveryRun?.key === key && isCurrentAuthAttempt(recoveryRun.attempt)) {
        return recoveryRun.promise;
    }

    const attempt = beginAuthAttempt();
    const promise = runRuntimeAuthRecovery(endInput, attempt).finally(() => {
        if (recoveryRun?.promise === promise) {
            recoveryRun = null;
        }
    });
    recoveryRun = { attempt, key, promise };
    return promise;
}
