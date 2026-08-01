import { normalizeString } from '@/shared/utils/string';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { handleRealtimeInstanceQueueProjection } from '../realtimeInstanceQueueService';
import {
    handleRealtimeCurrentUserProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection,
    handleRealtimeUserCacheProjection
} from '../realtimePresenceService';
import { showSQLiteErrorDialog } from '../sqliteErrorDialogService';
import { isRecord } from './guards';
import type { RuntimeEvent, RuntimeSnapshotPayload } from './types';

type BackendRealtimeProjectionScope = {
    userId: string;
    generation: number;
};

type BackendRealtimeProjectionEvent = RuntimeEvent<
    | 'realtimeFriendProjection'
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
    const snapshot = isRecord(runtimeState.backendRuntime)
        ? runtimeState.backendRuntime
        : {};
    const authUserId = normalizeString(snapshot.authUserId);
    return Boolean(
        snapshot.phase === 'running' &&
        snapshot.authStatus === 'authenticated' &&
        snapshot.wsStatus !== 'authFailure' &&
        snapshot.mode !== 'headless' &&
        authUserId &&
        runtimeState.auth.currentUserId === authUserId &&
        sessionState.sessionPhase === 'ready'
    );
}

function isBackendRuntimeRealtimeCandidate(): boolean {
    const snapshot = useRuntimeStore.getState().backendRuntime;
    return Boolean(
        isRecord(snapshot) &&
        snapshot.phase === 'running' &&
        snapshot.authStatus === 'authenticated' &&
        snapshot.wsStatus !== 'authFailure' &&
        snapshot.mode !== 'headless' &&
        normalizeString(snapshot.authUserId)
    );
}

function currentBackendRealtimeUserId(): string {
    const snapshot = useRuntimeStore.getState().backendRuntime;
    return isRecord(snapshot) ? normalizeString(snapshot.authUserId) : '';
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
    const userId = currentBackendRealtimeUserId();
    const generation = projectionGeneration(payload);
    if (!userId || !generation) {
        return null;
    }
    return { userId, generation };
}

function sameBackendRealtimeProjectionScope(
    left: BackendRealtimeProjectionScope | null,
    right: BackendRealtimeProjectionScope | null
): boolean {
    return Boolean(
        left &&
        right &&
        left.userId === right.userId &&
        left.generation === right.generation
    );
}

function isRealtimeProjectionEvent(
    event: RuntimeEvent
): event is BackendRealtimeProjectionEvent {
    switch (event.name) {
        case 'realtimeFriendProjection':
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
    useNotificationStore.getState().pushNotification({
        level: 'warning',
        title: 'Realtime event failed',
        message: error instanceof Error ? error.message : String(error)
    });
}

function deliverBackendRealtimeProjectionEvent(
    event: BackendRealtimeProjectionEvent
): void {
    useRuntimeStore.getState().recordRuntimeEvent(event.name, event.payload);
    if (event.name === 'realtimeFriendProjection') {
        handleRealtimeFriendProjection(event.payload);
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
    if (
        !pendingBackendRealtimeProjectionEvents.length ||
        !isBackendRuntimeRealtimeOwner() ||
        currentScope?.userId !== currentBackendRealtimeUserId()
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

export function prunePendingBackendRealtimeProjectionEvents(
    snapshot: RuntimeSnapshotPayload
): void {
    if (!pendingBackendRealtimeProjectionEvents.length) {
        return;
    }
    const userId = isRecord(snapshot)
        ? normalizeString(snapshot.authUserId)
        : '';
    const active = Boolean(
        isRecord(snapshot) &&
        snapshot.phase === 'running' &&
        snapshot.authStatus === 'authenticated' &&
        snapshot.mode !== 'headless' &&
        userId
    );
    const currentScope = pendingBackendRealtimeProjectionEvents[0]?.scope;
    if (!active || currentScope?.userId !== userId) {
        pendingBackendRealtimeProjectionEvents = [];
    }
}

export function handleBackendRealtimeProjectionEvent(
    event: RuntimeEvent
): boolean {
    if (!isRealtimeProjectionEvent(event)) {
        return false;
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
}
