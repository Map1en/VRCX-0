import { backend } from '@/platform/index.js';
import { DEFAULT_WEBSOCKET_DOMAIN } from '@/repositories/vrchatAuthRepository.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { handleRuntimeAuthFailure } from './authSessionRecoveryService.js';
import { refreshFriendAndFavoriteSnapshots } from './backgroundMaintenanceService.js';
import { isHostCapabilityAvailable } from './hostCapabilityService.js';
import {
    handleRealtimeCurrentUserProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection
} from './realtimePresenceService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';
import { syncStartupServicesTask } from './startupServicesStatus.js';

let activeContext: Record<string, any> | null = null;
let intentionalStop = false;
let ipcAnnouncedForActiveSession = false;
let backendTransportStarting = false;
let backendTransportActive = false;
let backendTransportCleanup: (() => void) | null = null;
let backendConnectedForActiveSession = false;
let backendTransportRunId = 0;
let backendTransportContext: Record<string, any> | null = null;
let backendTransportClientRunId: number | null = null;
let backendTransportGeneration: number | null = null;
let pendingBackendProjectionEvents: Array<{
    payload: unknown;
    context: Record<string, any>;
    deliver: () => void;
}> = [];

function normalizeWebsocketDomain(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim().replace(/\/+$/, '');
    }

    return DEFAULT_WEBSOCKET_DOMAIN;
}

function isCurrentTransportTarget(
    context: Record<string, any> | null = activeContext
) {
    return (
        isCurrentTransportIdentity(context) &&
        useSessionStore.getState().isFriendsLoaded
    );
}

function isCurrentTransportIdentity(
    context: Record<string, any> | null = activeContext
) {
    if (!context?.userId) {
        return false;
    }

    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === context.userId &&
        runtimeState.auth.currentUserEndpoint === context.endpoint &&
        runtimeState.auth.currentUserWebsocket === context.websocket &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

function updateTransportStartupDetail(detail: string) {
    syncStartupServicesTask([detail]);
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === 'object');
}

function projectionGeneration(payload: unknown) {
    const generation = Number(isRecord(payload) ? payload.generation : null);
    return Number.isFinite(generation) && generation > 0 ? generation : null;
}

function isCurrentRealtimeProjection(
    payload: unknown,
    context: Record<string, any>
) {
    return (
        isCurrentTransportIdentity(context) &&
        backendTransportGeneration !== null &&
        projectionGeneration(payload) === backendTransportGeneration
    );
}

function routeRealtimeProjection(
    payload: unknown,
    context: Record<string, any>,
    deliver: () => void
) {
    if (isCurrentRealtimeProjection(payload, context)) {
        deliver();
        return;
    }
    if (
        backendTransportGeneration === null &&
        isCurrentTransportIdentity(context) &&
        projectionGeneration(payload) !== null
    ) {
        pendingBackendProjectionEvents.push({ payload, context, deliver });
        if (pendingBackendProjectionEvents.length > 128) {
            pendingBackendProjectionEvents.shift();
        }
    }
}

function flushPendingBackendProjectionEvents() {
    if (!pendingBackendProjectionEvents.length) {
        return;
    }
    const pending = pendingBackendProjectionEvents;
    pendingBackendProjectionEvents = [];
    for (const entry of pending) {
        if (isCurrentRealtimeProjection(entry.payload, entry.context)) {
            entry.deliver();
        }
    }
}

function cleanupBackendRealtimeSubscription() {
    const cleanup = backendTransportCleanup;
    backendTransportCleanup = null;
    if (cleanup) {
        cleanup();
    }
}

function cleanupBackendRealtimeSubscriptionForRun(
    runId: number,
    cleanup: () => void
) {
    cleanup();
    if (
        runId === backendTransportRunId &&
        backendTransportCleanup === cleanup
    ) {
        backendTransportCleanup = null;
    }
}

function markBackendTransportStopped() {
    backendTransportStarting = false;
    backendTransportActive = false;
    backendConnectedForActiveSession = false;
    backendTransportContext = null;
    backendTransportClientRunId = null;
    backendTransportGeneration = null;
    pendingBackendProjectionEvents = [];
}

function backendTransportStopScope() {
    return {
        userId: backendTransportContext?.userId ?? null,
        endpoint: backendTransportContext?.endpoint ?? null,
        websocket: backendTransportContext?.websocket ?? null,
        clientRunId: backendTransportClientRunId,
        generation: backendTransportGeneration
    };
}

function transportStopScopeForRun(
    context: Record<string, any>,
    clientRunId: number,
    generation: number | null
) {
    return {
        userId: context.userId ?? null,
        endpoint: context.endpoint ?? null,
        websocket: context.websocket ?? null,
        clientRunId,
        generation
    };
}

function requestBackendRealtimeStop(scope = backendTransportStopScope()) {
    backend.app
        .StopRealtimeTransport(
            scope.userId,
            scope.endpoint,
            scope.websocket,
            scope.clientRunId,
            scope.generation
        )
        .catch((error) => {
            console.warn('Backend realtime transport stop failed:', error);
        });
}

function stopBackendRealtimeTransport() {
    const shouldStopBackend =
        backendTransportStarting || backendTransportActive;
    const stopScope = backendTransportStopScope();
    backendTransportRunId += 1;
    cleanupBackendRealtimeSubscription();
    markBackendTransportStopped();
    if (shouldStopBackend) {
        requestBackendRealtimeStop(stopScope);
    }
}

function refreshBaselineAfterReconnect() {
    let refreshError: unknown = null;
    void refreshFriendAndFavoriteSnapshots({ syncRealtime: false })
        .catch((error) => {
            refreshError = error;
        })
        .finally(() =>
            syncBackendRealtimeFriendSnapshot({ requireFriendsLoaded: false })
        )
        .catch((error) => {
            const reportError = refreshError || error;
            useNotificationStore.getState().pushNotification({
                level: 'warning',
                title: 'Realtime baseline refresh failed',
                message:
                    reportError instanceof Error
                        ? reportError.message
                        : String(reportError)
            });
        });
}

function handleRealtimeMessageFailure(error: unknown) {
    showSQLiteErrorDialog(error).catch((dialogError) => {
        console.warn('Realtime SQLite error dialog failed:', dialogError);
    });
    useNotificationStore.getState().pushNotification({
        level: 'warning',
        title: 'Realtime event failed',
        message: error instanceof Error ? error.message : String(error)
    });
}

function handleRealtimeAuthFailure(payload: Record<string, any>) {
    const reason = String(payload.reason || '').trim();
    const statusCode = Number(payload.statusCode);
    const isMissingCredentials =
        statusCode === 401 && reason.includes('Missing Credentials');
    if (!isMissingCredentials) {
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Realtime auth failed',
            message: reason || 'The realtime websocket could not authenticate.'
        });
        return;
    }

    const error = Object.assign(new Error(reason), {
        status: statusCode,
        endpoint: 'auth',
        payload
    });
    const handled = handleRuntimeAuthFailure(error);
    if (handled) {
        void handled.catch((recoveryError) => {
            console.warn(
                'Realtime auth failure recovery failed:',
                recoveryError
            );
        });
        return;
    }

    useNotificationStore.getState().pushNotification({
        level: 'warning',
        title: 'Realtime auth failed',
        message: reason || 'The realtime websocket could not authenticate.'
    });
}

function handleRealtimeStatus(
    payload: unknown,
    context: Record<string, any>,
    refreshBaselineOnReconnect: boolean
) {
    useRuntimeStore.getState().recordBackendEvent('realtimeWsStatus', payload);
    const statusPayload = isRecord(payload) ? payload : {};
    const status = String(statusPayload.status || '');
    if (!isCurrentTransportTarget(context)) {
        return;
    }

    const websocketDomain = normalizeWebsocketDomain(
        statusPayload.websocketDomain || context.websocket
    );

    if (status === 'connecting') {
        useSessionStore.getState().setTransportStatus('pipeline-connecting');
        return;
    }

    if (status === 'connected') {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: true,
            websocketDomain,
            lastConnectedAt: new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('pipeline-connected');
        updateTransportStartupDetail(
            'Backend realtime transport, IPC announce, and websocket transport are active.'
        );
        if (backendConnectedForActiveSession || refreshBaselineOnReconnect) {
            refreshBaselineAfterReconnect();
        }
        backendConnectedForActiveSession = true;
        return;
    }

    if (status === 'reconnecting') {
        useRuntimeStore.getState().incrementTransportReconnect();
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            websocketDomain,
            lastDisconnectedAt: new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('pipeline-reconnecting');
        return;
    }

    if (status === 'error') {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            websocketDomain,
            lastDisconnectedAt: new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('pipeline-error');
        return;
    }

    if (status === 'authFailure') {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            websocketDomain,
            lastDisconnectedAt: new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('pipeline-error');
        handleRealtimeAuthFailure(statusPayload);
        return;
    }

    if (status === 'disconnected') {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            lastDisconnectedAt: new Date().toISOString()
        });
        if (intentionalStop || !isCurrentTransportTarget(context)) {
            useSessionStore.getState().setTransportStatus('disconnected');
        }
    }
}

async function subscribeBackendRealtimeEvents(
    context: Record<string, any>,
    refreshBaselineOnReconnect: boolean
) {
    const unsubscribers = await Promise.all([
        backend.events.subscribe('realtimeWsStatus', (payload) => {
            handleRealtimeStatus(payload, context, refreshBaselineOnReconnect);
        }),
        backend.events.subscribe('realtimeFriendProjection', (payload) => {
            routeRealtimeProjection(payload, context, () => {
                useRuntimeStore
                    .getState()
                    .recordBackendEvent('realtimeFriendProjection', payload);
                handleRealtimeFriendProjection(payload);
            });
        }),
        backend.events.subscribe('realtimeNotificationProjection', (payload) => {
            routeRealtimeProjection(payload, context, () => {
                useRuntimeStore
                    .getState()
                    .recordBackendEvent('realtimeNotificationProjection', payload);
                Promise.resolve(handleRealtimeNotificationProjection(payload)).catch(
                    handleRealtimeMessageFailure
                );
            });
        }),
        backend.events.subscribe('realtimeCurrentUserProjection', (payload) => {
            routeRealtimeProjection(payload, context, () => {
                useRuntimeStore
                    .getState()
                    .recordBackendEvent('realtimeCurrentUserProjection', payload);
                handleRealtimeCurrentUserProjection(payload);
            });
        }),
        backend.events.subscribe('realtimeInstanceClosedProjection', (payload) => {
            routeRealtimeProjection(payload, context, () => {
                useRuntimeStore
                    .getState()
                    .recordBackendEvent('realtimeInstanceClosedProjection', payload);
                Promise.resolve(handleRealtimeInstanceClosedProjection(payload)).catch(
                    handleRealtimeMessageFailure
                );
            });
        })
    ]);

    return () => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
    };
}

async function startBackendRealtimeTransport(
    context: Record<string, any>,
    { refreshBaselineOnReconnect = false } = {}
) {
    const runId = ++backendTransportRunId;
    cleanupBackendRealtimeSubscription();
    backendTransportStarting = true;
    backendTransportActive = false;
    backendConnectedForActiveSession = false;
    backendTransportContext = context;
    backendTransportClientRunId = runId;
    backendTransportGeneration = null;
    useSessionStore.getState().setTransportStatus('pipeline-connecting');

    let cleanup: () => void;
    try {
        cleanup = await subscribeBackendRealtimeEvents(
            context,
            Boolean(refreshBaselineOnReconnect)
        );
    } catch (error) {
        if (runId === backendTransportRunId) {
            markBackendTransportStopped();
        }
        console.warn('[RealtimeTransport] subscribe failed', error);
        throw error;
    }
    if (
        runId !== backendTransportRunId ||
        intentionalStop ||
        !isCurrentTransportTarget(context)
    ) {
        cleanupBackendRealtimeSubscriptionForRun(runId, cleanup);
        if (runId === backendTransportRunId) {
            markBackendTransportStopped();
        }
        return;
    }
    backendTransportCleanup = cleanup;

    let startResult: Record<string, any>;
    let startGeneration: number | null = null;
    try {
        startResult = (await backend.app.StartRealtimeTransport(
            context.userId,
            context.endpoint,
            context.websocket,
            runId,
            context.currentUserSnapshot,
            useFriendRosterStore.getState().friendsById
        )) as Record<string, any>;
        startGeneration = Number(startResult?.generation) || null;
        if (runId === backendTransportRunId) {
            backendTransportGeneration = startGeneration;
            flushPendingBackendProjectionEvents();
        }
    } catch (error) {
        if (runId === backendTransportRunId) {
            cleanupBackendRealtimeSubscription();
            markBackendTransportStopped();
        }
        console.warn('[RealtimeTransport] backend start failed', error);
        throw error;
    }

    if (
        runId !== backendTransportRunId ||
        intentionalStop ||
        !isCurrentTransportTarget(context)
    ) {
        const stopScope = transportStopScopeForRun(
            context,
            runId,
            startGeneration
        );
        cleanupBackendRealtimeSubscriptionForRun(runId, cleanup);
        if (runId === backendTransportRunId) {
            markBackendTransportStopped();
        }
        requestBackendRealtimeStop(stopScope);
        return;
    }

    backendTransportStarting = false;
    backendTransportActive = true;
}

function handleTransportFailure(error: unknown) {
    if (!isCurrentTransportTarget()) {
        return;
    }

    const message = error instanceof Error ? error.message : String(error);
    useSessionStore.getState().setTransportStatus('pipeline-error');
    updateTransportStartupDetail(
        [`Realtime transport bootstrap failed: ${message}.`].join(' ')
    );
    useNotificationStore.getState().pushNotification({
        level: 'warning',
        title: 'Realtime transport failed',
        message
    });
}

async function connectRealtimeTransport({
    announceIpc,
    preserveMetrics
}: Record<string, any>) {
    const context = activeContext;
    if (!isCurrentTransportTarget(context)) {
        return stopRealtimeTransport();
    }

    stopBackendRealtimeTransport();

    if (!preserveMetrics) {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            websocketDomain: normalizeWebsocketDomain(context.websocket),
            reconnectCount: 0,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            ipcAnnounced: false,
            lastIpcAnnouncedAt: null
        });
    }

    if (
        announceIpc &&
        !ipcAnnouncedForActiveSession &&
        isHostCapabilityAvailable('ipc')
    ) {
        useSessionStore.getState().setTransportStatus('announcing-ipc');
        try {
            await backend.app.IPCAnnounceStart();
            ipcAnnouncedForActiveSession = true;
            useRuntimeStore.getState().setTransportState({
                ipcAnnounced: true,
                lastIpcAnnouncedAt: new Date().toISOString()
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            useNotificationStore.getState().pushNotification({
                level: 'warning',
                title: 'IPC announce failed',
                message
            });
        }
    }

    if (!isCurrentTransportTarget(context)) {
        return stopRealtimeTransport();
    }

    if (!isHostCapabilityAvailable('backendRealtimeTransport')) {
        console.warn('[RealtimeTransport] backend capability unavailable');
        throw new Error('Backend realtime transport is unavailable.');
    }

    await startBackendRealtimeTransport(context, {
        refreshBaselineOnReconnect: Boolean(preserveMetrics)
    });
}

export async function startRealtimeTransport({
    userId,
    endpoint = '',
    websocket = '',
    currentUserSnapshot
}) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (
        !normalizedUserId ||
        !currentUserSnapshot ||
        typeof currentUserSnapshot !== 'object'
    ) {
        throw new Error(
            'Realtime transport bootstrap requires an authenticated user context.'
        );
    }

    if (
        activeContext?.userId === normalizedUserId &&
        activeContext?.endpoint === endpoint &&
        activeContext?.websocket === websocket &&
        (backendTransportStarting || backendTransportActive)
    ) {
        return stopRealtimeTransport;
    }

    stopRealtimeTransport({ preserveTelemetry: false, updateStatus: false });

    intentionalStop = false;
    ipcAnnouncedForActiveSession = false;
    activeContext = {
        userId: normalizedUserId,
        endpoint,
        websocket,
        currentUserSnapshot
    };

    try {
        await connectRealtimeTransport({
            announceIpc: true,
            preserveMetrics: false
        });
    } catch (error) {
        handleTransportFailure(error);
        throw error;
    }

    return stopRealtimeTransport;
}

export async function syncBackendRealtimeFriendSnapshot({
    requireFriendsLoaded = true
}: { requireFriendsLoaded?: boolean } = {}) {
    const context = backendTransportContext ?? activeContext;
    const isCurrent = requireFriendsLoaded
        ? isCurrentTransportTarget(context)
        : isCurrentTransportIdentity(context);
    if (
        !backendTransportActive ||
        !context?.userId ||
        backendTransportGeneration === null ||
        !isCurrent
    ) {
        return null;
    }

    return backend.app.SyncRealtimeFriendSnapshot(
        context.userId,
        context.endpoint,
        context.websocket,
        backendTransportGeneration,
        useFriendRosterStore.getState().friendsById
    );
}

export async function syncBackendRealtimeCurrentUserSnapshot(
    snapshot: unknown,
    overlayPatch: unknown = null
) {
    const context = backendTransportContext ?? activeContext;
    if (
        !backendTransportActive ||
        !context?.userId ||
        backendTransportGeneration === null ||
        !isCurrentTransportIdentity(context) ||
        !snapshot ||
        typeof snapshot !== 'object'
    ) {
        return null;
    }

    return backend.app.SyncRealtimeCurrentUserSnapshot(
        context.userId,
        context.endpoint,
        context.websocket,
        backendTransportGeneration,
        snapshot as Record<string, unknown>,
        overlayPatch && typeof overlayPatch === 'object'
            ? (overlayPatch as Record<string, unknown>)
            : null
    );
}

export function stopRealtimeTransport({
    preserveTelemetry = false,
    updateStatus = true
} = {}) {
    intentionalStop = true;
    ipcAnnouncedForActiveSession = false;
    stopBackendRealtimeTransport();
    activeContext = null;

    if (!preserveTelemetry) {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            websocketDomain: '',
            reconnectCount: 0,
            lastConnectedAt: null,
            lastDisconnectedAt: new Date().toISOString(),
            ipcAnnounced: false,
            lastIpcAnnouncedAt: null
        });
    } else {
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            lastDisconnectedAt: new Date().toISOString()
        });
    }

    if (updateStatus) {
        useSessionStore.getState().setTransportStatus('disconnected');
    }
}
