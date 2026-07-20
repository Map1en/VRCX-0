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
import type {
    RuntimeEventName,
    RuntimeEventPayloadMap,
    RuntimeSnapshotPayload
} from './types';

type BackendRealtimeProjectionScope = {
    userId: string;
    generation: number;
};

let pendingBackendRealtimeProjectionEvents: Array<{
    name: RuntimeEventName;
    payload: unknown;
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

function projectionGeneration(payload: unknown): number {
    const generation = Number(isRecord(payload) ? payload.generation : null);
    return Number.isFinite(generation) && generation > 0 ? generation : 0;
}

function currentBackendRealtimeProjectionScope(
    payload: unknown
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

function isRealtimeProjectionEvent(name: RuntimeEventName): boolean {
    return (
        name === 'realtimeFriendProjection' ||
        name === 'realtimeUserProjection' ||
        name === 'realtimeNotificationProjection' ||
        name === 'realtimeCurrentUserProjection' ||
        name === 'realtimeInstanceClosedProjection' ||
        name === 'realtimeInstanceQueueProjection'
    );
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
    name: RuntimeEventName,
    payload: unknown
): void {
    useRuntimeStore.getState().recordRuntimeEvent(name, payload);
    if (name === 'realtimeFriendProjection') {
        handleRealtimeFriendProjection(
            payload as RuntimeEventPayloadMap['realtimeFriendProjection']
        );
    } else if (name === 'realtimeUserProjection') {
        handleRealtimeUserCacheProjection(payload);
    } else if (name === 'realtimeNotificationProjection') {
        Promise.resolve(
            handleRealtimeNotificationProjection(
                payload as RuntimeEventPayloadMap['realtimeNotificationProjection']
            )
        ).catch(handleBackendRealtimeProjectionFailure);
    } else if (name === 'realtimeCurrentUserProjection') {
        handleRealtimeCurrentUserProjection(
            payload as RuntimeEventPayloadMap['realtimeCurrentUserProjection']
        );
    } else if (name === 'realtimeInstanceClosedProjection') {
        Promise.resolve(
            handleRealtimeInstanceClosedProjection(
                payload as RuntimeEventPayloadMap['realtimeInstanceClosedProjection']
            )
        ).catch(handleBackendRealtimeProjectionFailure);
    } else if (name === 'realtimeInstanceQueueProjection') {
        handleRealtimeInstanceQueueProjection(payload);
    }
}

function queuePendingBackendRealtimeProjectionEvent(
    name: RuntimeEventName,
    payload: unknown
): void {
    const scope = currentBackendRealtimeProjectionScope(payload);
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
    pendingBackendRealtimeProjectionEvents.push({ name, payload, scope });
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
            deliverBackendRealtimeProjectionEvent(entry.name, entry.payload);
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
    name: RuntimeEventName,
    payload: unknown
): boolean {
    if (!isRealtimeProjectionEvent(name)) {
        return false;
    }
    if (!isBackendRuntimeRealtimeOwner()) {
        if (isBackendRuntimeRealtimeCandidate()) {
            queuePendingBackendRealtimeProjectionEvent(name, payload);
        }
        return true;
    }

    flushPendingBackendRealtimeProjectionEvents();
    deliverBackendRealtimeProjectionEvent(name, payload);
    return true;
}

export function resetBackendRealtimeProjectionState(): void {
    pendingBackendRealtimeProjectionEvents = [];
}
