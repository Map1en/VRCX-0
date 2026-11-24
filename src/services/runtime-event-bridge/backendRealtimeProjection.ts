import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { currentRealtimeTransportGeneration } from '../authenticatedRuntimeService';
import i18n from '../i18nService';
import { handleRealtimeInstanceQueueProjection } from '../realtimeInstanceQueueService';
import {
    handleRealtimeCurrentUserProjection,
    handleRealtimeFeedProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection,
    handleRealtimeUserCacheProjection
} from '../realtimePresenceService';
import { resetRealtimeRosterUpdates } from '../realtimeRosterUpdateQueue';
import { showSQLiteErrorDialog } from '../sqliteErrorDialogService';
import { toast } from '../toastService';
import type { RuntimeEvent } from './types';

type BackendRealtimeProjectionScope = {
    authScopeGeneration: number;
    userId: string;
    realtimeGeneration: number;
};

type BackendRealtimeProjectionEvent = RuntimeEvent<
    | 'realtimeFriendProjection'
    | 'realtimeFeedProjection'
    | 'realtimeUserProjection'
    | 'realtimeNotificationProjection'
    | 'realtimeCurrentUserProjection'
    | 'realtimeInstanceClosedProjection'
    | 'realtimeInstanceQueueProjection'
>;

let pendingBackendRealtimeProjectionEvents: Array<{
    event: BackendRealtimeProjectionEvent;
    scope: BackendRealtimeProjectionScope;
}> = [];

function isBackendRuntimeRealtimeOwner(): boolean {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();
    const snapshot = runtimeState.backendRuntime;
    const authenticatedSession = runtimeState.authenticatedSession.session;
    return Boolean(
        snapshot?.phase === 'running' &&
        snapshot.wsStatus !== 'authFailure' &&
        snapshot.mode !== 'headless' &&
        authenticatedSession &&
        runtimeState.auth.currentUserId === authenticatedSession.userId &&
        sessionState.sessionPhase === 'ready'
    );
}

function isBackendRuntimeRealtimeCandidate(): boolean {
    const runtimeState = useRuntimeStore.getState();
    const snapshot = runtimeState.backendRuntime;
    return Boolean(
        snapshot?.phase === 'running' &&
        snapshot.wsStatus !== 'authFailure' &&
        snapshot.mode !== 'headless' &&
        runtimeState.authenticatedSession.session
    );
}

function currentAuthenticatedSessionScope(): {
    authScopeGeneration: number;
    userId: string;
} | null {
    const session = useRuntimeStore.getState().authenticatedSession.session;
    const userId = normalizeString(session?.userId);
    const authScopeGeneration = Number(session?.authScopeGeneration);
    if (
        !userId ||
        !Number.isFinite(authScopeGeneration) ||
        authScopeGeneration <= 0
    ) {
        return null;
    }
    return { authScopeGeneration, userId };
}

function projectionGeneration(
    payload: BackendRealtimeProjectionEvent['payload']
): number {
    const generation = Number(
        'generation' in payload ? payload.generation : null
    );
    return Number.isFinite(generation) && generation > 0 ? generation : 0;
}

function currentBackendRealtimeProjectionScope(
    payload: BackendRealtimeProjectionEvent['payload']
): BackendRealtimeProjectionScope | null {
    const authenticatedSession = currentAuthenticatedSessionScope();
    const realtimeGeneration = projectionGeneration(payload);
    if (!authenticatedSession || !realtimeGeneration) {
        return null;
    }
    return { ...authenticatedSession, realtimeGeneration };
}

function sameBackendRealtimeProjectionScope(
    left: BackendRealtimeProjectionScope | null,
    right: BackendRealtimeProjectionScope | null
): boolean {
    return Boolean(
        left &&
        right &&
        left.authScopeGeneration === right.authScopeGeneration &&
        left.userId === right.userId &&
        left.realtimeGeneration === right.realtimeGeneration
    );
}

function isRealtimeProjectionEvent(
    event: RuntimeEvent
): event is BackendRealtimeProjectionEvent {
    switch (event.name) {
        case 'realtimeFriendProjection':
        case 'realtimeFeedProjection':
        case 'realtimeUserProjection':
        case 'realtimeNotificationProjection':
        case 'realtimeCurrentUserProjection':
        case 'realtimeInstanceClosedProjection':
        case 'realtimeInstanceQueueProjection':
            return true;
        default:
            return false;
    }
}

function handleBackendRealtimeProjectionFailure(error: unknown): void {
    showSQLiteErrorDialog(error).catch((dialogError: unknown) => {
        console.warn('Realtime SQLite error dialog failed:', dialogError);
    });
    toast.add({
        type: 'warning',
        title: i18n.t('common.error.realtime_event_failed'),
        description: error instanceof Error ? error.message : String(error)
    });
}

function deliverBackendRealtimeProjectionEvent(
    event: BackendRealtimeProjectionEvent
): void {
    useRuntimeStore.getState().recordRuntimeEvent(event.name, event.payload);
    if (event.name === 'realtimeFriendProjection') {
        handleRealtimeFriendProjection(event.payload);
    } else if (event.name === 'realtimeFeedProjection') {
        handleRealtimeFeedProjection(event.payload);
    } else if (event.name === 'realtimeUserProjection') {
        handleRealtimeUserCacheProjection(event.payload);
    } else if (event.name === 'realtimeNotificationProjection') {
        Promise.resolve(
            handleRealtimeNotificationProjection(event.payload)
        ).catch(handleBackendRealtimeProjectionFailure);
    } else if (event.name === 'realtimeCurrentUserProjection') {
        handleRealtimeCurrentUserProjection(event.payload);
    } else if (event.name === 'realtimeInstanceClosedProjection') {
        Promise.resolve(
            handleRealtimeInstanceClosedProjection(event.payload)
        ).catch(handleBackendRealtimeProjectionFailure);
    } else if (event.name === 'realtimeInstanceQueueProjection') {
        handleRealtimeInstanceQueueProjection(event.payload);
    }
}

function queuePendingBackendRealtimeProjectionEvent(
    event: BackendRealtimeProjectionEvent
): void {
    const scope = currentBackendRealtimeProjectionScope(event.payload);
    if (!scope) {
        return;
    }
    const currentScope =
        pendingBackendRealtimeProjectionEvents[0]?.scope ?? null;
    if (
        pendingBackendRealtimeProjectionEvents.length &&
        !sameBackendRealtimeProjectionScope(currentScope, scope)
    ) {
        pendingBackendRealtimeProjectionEvents = [];
    }
    pendingBackendRealtimeProjectionEvents.push({ event, scope });
    if (pendingBackendRealtimeProjectionEvents.length > 128) {
        pendingBackendRealtimeProjectionEvents.shift();
    }
}

export function flushPendingBackendRealtimeProjectionEvents(): void {
    const currentScope =
        pendingBackendRealtimeProjectionEvents[0]?.scope ?? null;
    const authenticatedSession = currentAuthenticatedSessionScope();
    if (
        !pendingBackendRealtimeProjectionEvents.length ||
        !isBackendRuntimeRealtimeOwner() ||
        currentScope?.userId !== authenticatedSession?.userId ||
        currentScope?.authScopeGeneration !==
            authenticatedSession?.authScopeGeneration
    ) {
        return;
    }
    const pending = pendingBackendRealtimeProjectionEvents;
    pendingBackendRealtimeProjectionEvents = [];
    for (const entry of pending) {
        if (sameBackendRealtimeProjectionScope(entry.scope, currentScope)) {
            deliverBackendRealtimeProjectionEvent(entry.event);
        }
    }
}

export function prunePendingBackendRealtimeProjectionEvents(): void {
    if (!pendingBackendRealtimeProjectionEvents.length) {
        return;
    }
    const authenticatedSession = currentAuthenticatedSessionScope();
    const currentScope = pendingBackendRealtimeProjectionEvents[0]?.scope;
    if (
        !isBackendRuntimeRealtimeCandidate() ||
        !authenticatedSession ||
        currentScope?.userId !== authenticatedSession.userId ||
        currentScope?.authScopeGeneration !==
            authenticatedSession.authScopeGeneration
    ) {
        pendingBackendRealtimeProjectionEvents = [];
    }
}

export function handleBackendRealtimeProjectionEvent(
    event: RuntimeEvent
): boolean {
    if (!isRealtimeProjectionEvent(event)) {
        return false;
    }
    const realtimeGeneration = projectionGeneration(event.payload);
    const authoritativeGeneration = currentRealtimeTransportGeneration();
    if (
        realtimeGeneration &&
        authoritativeGeneration !== null &&
        realtimeGeneration !== authoritativeGeneration
    ) {
        return true;
    }
    if (!isBackendRuntimeRealtimeOwner()) {
        if (isBackendRuntimeRealtimeCandidate()) {
            queuePendingBackendRealtimeProjectionEvent(event);
        }
        return true;
    }

    flushPendingBackendRealtimeProjectionEvents();
    deliverBackendRealtimeProjectionEvent(event);
    return true;
}

export function resetBackendRealtimeProjectionState(): void {
    pendingBackendRealtimeProjectionEvents = [];
    resetRealtimeRosterUpdates();
}
