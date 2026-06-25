import { commands } from '@/platform/tauri/bindings';
import type {
    FriendProjection,
    FriendRecord as BackendFriendRecord,
    RealtimeCurrentUserProjection,
    RealtimeInstanceClosedProjection,
    RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection,
    RealtimeTransportStartResult,
    RealtimeWsStatusPayload
} from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import { DEFAULT_WEBSOCKET_DOMAIN } from '@/repositories/vrchatAuthRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { handleRuntimeAuthFailure } from './authSessionRecoveryService';
import { isHostCapabilityAvailable } from './hostCapabilityService';
import { handleRealtimeInstanceQueueProjection } from './realtimeInstanceQueueService';
import {
    handleRealtimeCurrentUserProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection
} from './realtimePresenceService';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService';
import { syncStartupServicesTask } from './startupServicesStatus';

type RuntimeTransportContext = {
    userId: string;
    endpoint: string;
    websocket: string;
    currentUserSnapshot: Record<string, unknown>;
};

type RuntimeTransportStopScope = {
    userId: string | null;
    endpoint: string | null;
    websocket: string | null;
    clientRunId: number | null;
    generation: number | null;
};

type ConnectRealtimeTransportOptions = {
    announceIpc?: boolean;
    preserveMetrics?: boolean;
};

type StartRealtimeTransportOptions = {
    userId?: unknown;
    endpoint?: string;
    websocket?: string;
    currentUserSnapshot?: unknown;
};

type StopRealtimeTransportOptions = {
    preserveTelemetry?: boolean;
    updateStatus?: boolean;
};

let activeContext: RuntimeTransportContext | null = null;
let intentionalStop = false;
let ipcAnnouncedForActiveSession = false;
let runtimeTransportStarting = false;
let runtimeTransportActive = false;
let runtimeTransportCleanup: (() => void) | null = null;
let runtimeTransportRunId = 0;
let runtimeTransportContext: RuntimeTransportContext | null = null;
let runtimeTransportClientRunId: number | null = null;
let runtimeTransportGeneration: number | null = null;
let pendingRuntimeProjectionEvents: Array<{
    payload: unknown;
    context: RuntimeTransportContext;
    deliver: () => void;
}> = [];

function normalizeWebsocketDomain(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim().replace(/\/+$/, '');
    }

    return DEFAULT_WEBSOCKET_DOMAIN;
}

function isCurrentTransportTarget(
    context: RuntimeTransportContext | null = activeContext
) {
    return (
        isCurrentTransportIdentity(context) &&
        useSessionStore.getState().isFriendsLoaded
    );
}

function isCurrentTransportIdentity(
    context: RuntimeTransportContext | null = activeContext
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function projectionGeneration(payload: unknown) {
    const generation = Number(isRecord(payload) ? payload.generation : null);
    return Number.isFinite(generation) && generation > 0 ? generation : null;
}

function isCurrentRealtimeProjection(
    payload: unknown,
    context: RuntimeTransportContext
) {
    return (
        isCurrentTransportIdentity(context) &&
        runtimeTransportGeneration !== null &&
        projectionGeneration(payload) === runtimeTransportGeneration
    );
}

function routeRealtimeProjection(
    payload: unknown,
    context: RuntimeTransportContext,
    deliver: () => void
) {
    if (isCurrentRealtimeProjection(payload, context)) {
        deliver();
        return;
    }
    if (
        runtimeTransportGeneration === null &&
        isCurrentTransportIdentity(context) &&
        projectionGeneration(payload) !== null
    ) {
        pendingRuntimeProjectionEvents.push({ payload, context, deliver });
        if (pendingRuntimeProjectionEvents.length > 128) {
            pendingRuntimeProjectionEvents.shift();
        }
    }
}

function flushPendingRuntimeProjectionEvents() {
    if (!pendingRuntimeProjectionEvents.length) {
        return;
    }
    const pending = pendingRuntimeProjectionEvents;
    pendingRuntimeProjectionEvents = [];
    for (const entry of pending) {
        if (isCurrentRealtimeProjection(entry.payload, entry.context)) {
            entry.deliver();
        }
    }
}

function cleanupRuntimeRealtimeSubscription() {
    const cleanup = runtimeTransportCleanup;
    runtimeTransportCleanup = null;
    if (cleanup) {
        cleanup();
    }
}

function cleanupRuntimeRealtimeSubscriptionForRun(
    runId: number,
    cleanup: () => void
) {
    cleanup();
    if (
        runId === runtimeTransportRunId &&
        runtimeTransportCleanup === cleanup
    ) {
        runtimeTransportCleanup = null;
    }
}

function markRuntimeTransportStopped() {
    runtimeTransportStarting = false;
    runtimeTransportActive = false;
    runtimeTransportContext = null;
    runtimeTransportClientRunId = null;
    runtimeTransportGeneration = null;
    pendingRuntimeProjectionEvents = [];
}

function runtimeTransportStopScope() {
    return {
        userId: runtimeTransportContext?.userId ?? null,
        endpoint: runtimeTransportContext?.endpoint ?? null,
        websocket: runtimeTransportContext?.websocket ?? null,
        clientRunId: runtimeTransportClientRunId,
        generation: runtimeTransportGeneration
    };
}

function transportStopScopeForRun(
    context: RuntimeTransportContext,
    clientRunId: number,
    generation: number | null
): RuntimeTransportStopScope {
    return {
        userId: context.userId ?? null,
        endpoint: context.endpoint ?? null,
        websocket: context.websocket ?? null,
        clientRunId,
        generation
    };
}

function requestRuntimeRealtimeStop(
    scope: RuntimeTransportStopScope = runtimeTransportStopScope()
) {
    commands
        .appStopRealtimeTransport(
            scope.userId,
            scope.endpoint,
            scope.websocket,
            scope.clientRunId,
            scope.generation
        )
        .catch((error: unknown) => {
            console.warn('Backend realtime transport stop failed:', error);
        });
}

function stopRuntimeRealtimeTransport() {
    const shouldStopBackend =
        runtimeTransportStarting || runtimeTransportActive;
    const stopScope = runtimeTransportStopScope();
    runtimeTransportRunId += 1;
    cleanupRuntimeRealtimeSubscription();
    markRuntimeTransportStopped();
    if (shouldStopBackend) {
        requestRuntimeRealtimeStop(stopScope);
    }
}

function handleRealtimeMessageFailure(error: unknown) {
    showSQLiteErrorDialog(error).catch((dialogError: unknown) => {
        console.warn('Realtime SQLite error dialog failed:', dialogError);
    });
    useNotificationStore.getState().pushNotification({
        level: 'warning',
        title: 'Realtime event failed',
        message: error instanceof Error ? error.message : String(error)
    });
}

function handleRealtimeAuthFailure(payload: Record<string, unknown>) {
    const reason = String(payload.reason || '').trim();
    const statusCode = Number(payload.statusCode);
    const isRecoverableAuthFailure =
        statusCode === 401 ||
        statusCode === 403 ||
        reason.includes('Missing Credentials');
    if (!isRecoverableAuthFailure) {
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Realtime auth failed',
            message: reason || 'The realtime websocket could not authenticate.'
        });
        return;
    }

    const error = Object.assign(new Error(reason), {
        status: Number.isFinite(statusCode) ? statusCode : 401,
        endpoint: 'auth',
        payload
    });
    const handled = handleRuntimeAuthFailure(error);
    if (handled) {
        handled.catch((recoveryError: unknown) => {
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
    payload: RealtimeWsStatusPayload,
    context: RuntimeTransportContext
) {
    useRuntimeStore.getState().recordRuntimeEvent('realtimeWsStatus', payload);
    const statusPayload = payload;
    const status = String(statusPayload.status || '');
    if (!isCurrentTransportTarget(context)) {
        return;
    }
    const statusClientRunId = Number(statusPayload.clientRunId);
    if (
        Number.isFinite(statusClientRunId) &&
        statusClientRunId > 0 &&
        runtimeTransportClientRunId !== null &&
        statusClientRunId !== runtimeTransportClientRunId
    ) {
        return;
    }
    const statusGeneration = Number(statusPayload.generation);
    if (
        Number.isFinite(statusGeneration) &&
        statusGeneration > 0 &&
        runtimeTransportGeneration === null
    ) {
        runtimeTransportGeneration = statusGeneration;
        flushPendingRuntimeProjectionEvents();
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
        handleRealtimeAuthFailure({ ...statusPayload });
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

async function subscribeRuntimeRealtimeEvents(
    context: RuntimeTransportContext
) {
    const unsubscribers = await Promise.all([
        tauriClient.events.subscribe<RealtimeWsStatusPayload>(
            'realtimeWsStatus',
            (payload) => {
                handleRealtimeStatus(payload, context);
            }
        ),
        tauriClient.events.subscribe(
            'realtimeFriendProjection',
            (payload: FriendProjection) => {
                routeRealtimeProjection(payload, context, () => {
                    useRuntimeStore
                        .getState()
                        .recordRuntimeEvent(
                            'realtimeFriendProjection',
                            payload
                        );
                    handleRealtimeFriendProjection(payload);
                });
            }
        ),
        tauriClient.events.subscribe(
            'realtimeNotificationProjection',
            (payload: RealtimeNotificationProjection) => {
                routeRealtimeProjection(payload, context, () => {
                    useRuntimeStore
                        .getState()
                        .recordRuntimeEvent(
                            'realtimeNotificationProjection',
                            payload
                        );
                    Promise.resolve(
                        handleRealtimeNotificationProjection(payload)
                    ).catch(handleRealtimeMessageFailure);
                });
            }
        ),
        tauriClient.events.subscribe(
            'realtimeCurrentUserProjection',
            (payload: RealtimeCurrentUserProjection) => {
                routeRealtimeProjection(payload, context, () => {
                    useRuntimeStore
                        .getState()
                        .recordRuntimeEvent(
                            'realtimeCurrentUserProjection',
                            payload
                        );
                    handleRealtimeCurrentUserProjection(payload);
                });
            }
        ),
        tauriClient.events.subscribe(
            'realtimeInstanceClosedProjection',
            (payload: RealtimeInstanceClosedProjection) => {
                routeRealtimeProjection(payload, context, () => {
                    useRuntimeStore
                        .getState()
                        .recordRuntimeEvent(
                            'realtimeInstanceClosedProjection',
                            payload
                        );
                    Promise.resolve(
                        handleRealtimeInstanceClosedProjection(payload)
                    ).catch(handleRealtimeMessageFailure);
                });
            }
        ),
        tauriClient.events.subscribe(
            'realtimeInstanceQueueProjection',
            (payload: RealtimeInstanceQueueProjection) => {
                routeRealtimeProjection(payload, context, () => {
                    useRuntimeStore
                        .getState()
                        .recordRuntimeEvent(
                            'realtimeInstanceQueueProjection',
                            payload
                        );
                    handleRealtimeInstanceQueueProjection(payload);
                });
            }
        )
    ]);

    return () => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
    };
}

async function startRuntimeRealtimeTransport(context: RuntimeTransportContext) {
    const runId = ++runtimeTransportRunId;
    cleanupRuntimeRealtimeSubscription();
    runtimeTransportStarting = true;
    runtimeTransportActive = false;
    runtimeTransportContext = context;
    runtimeTransportClientRunId = runId;
    runtimeTransportGeneration = null;
    useSessionStore.getState().setTransportStatus('pipeline-connecting');

    let cleanup: () => void;
    try {
        cleanup = await subscribeRuntimeRealtimeEvents(context);
    } catch (error) {
        if (runId === runtimeTransportRunId) {
            markRuntimeTransportStopped();
        }
        console.warn('[RealtimeTransport] subscribe failed', error);
        throw error;
    }
    if (
        runId !== runtimeTransportRunId ||
        intentionalStop ||
        !isCurrentTransportTarget(context)
    ) {
        cleanupRuntimeRealtimeSubscriptionForRun(runId, cleanup);
        if (runId === runtimeTransportRunId) {
            markRuntimeTransportStopped();
        }
        return;
    }
    runtimeTransportCleanup = cleanup;

    let startResult: RealtimeTransportStartResult;
    let startGeneration: number | null = null;
    try {
        startResult = await commands.appStartRealtimeTransport(
            context.userId,
            context.endpoint,
            context.websocket,
            runId,
            context.currentUserSnapshot,
            useFriendRosterStore.getState().friendsById as unknown as Record<
                string,
                BackendFriendRecord
            >
        );
        startGeneration = Number(startResult?.generation) || null;
        if (runId === runtimeTransportRunId) {
            runtimeTransportGeneration = startGeneration;
            flushPendingRuntimeProjectionEvents();
        }
    } catch (error) {
        if (runId === runtimeTransportRunId) {
            cleanupRuntimeRealtimeSubscription();
            markRuntimeTransportStopped();
        }
        console.warn('[RealtimeTransport] runtime start failed', error);
        throw error;
    }

    if (
        runId !== runtimeTransportRunId ||
        intentionalStop ||
        !isCurrentTransportTarget(context)
    ) {
        const stopScope = transportStopScopeForRun(
            context,
            runId,
            startGeneration
        );
        cleanupRuntimeRealtimeSubscriptionForRun(runId, cleanup);
        if (runId === runtimeTransportRunId) {
            markRuntimeTransportStopped();
        }
        requestRuntimeRealtimeStop(stopScope);
        return;
    }

    runtimeTransportStarting = false;
    runtimeTransportActive = true;
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
}: ConnectRealtimeTransportOptions) {
    const context = activeContext;
    if (!context || !isCurrentTransportTarget(context)) {
        return stopRealtimeTransport();
    }

    stopRuntimeRealtimeTransport();

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
            await commands.appIpcAnnounceStart();
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

    if (!isHostCapabilityAvailable('runtimeRealtimeTransport')) {
        console.warn('[RealtimeTransport] runtime capability unavailable');
        throw new Error('Backend realtime transport is unavailable.');
    }

    await startRuntimeRealtimeTransport(context);
}

export async function startRealtimeTransport({
    userId,
    endpoint = '',
    websocket = '',
    currentUserSnapshot
}: StartRealtimeTransportOptions) {
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
        (runtimeTransportStarting || runtimeTransportActive)
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
        currentUserSnapshot: currentUserSnapshot as Record<string, unknown>
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

export async function syncRuntimeRealtimeFriendSnapshot({
    requireFriendsLoaded = true
}: { requireFriendsLoaded?: boolean } = {}) {
    const context = runtimeTransportContext ?? activeContext;
    const isCurrent = requireFriendsLoaded
        ? isCurrentTransportTarget(context)
        : isCurrentTransportIdentity(context);
    if (
        !runtimeTransportActive ||
        !context?.userId ||
        runtimeTransportGeneration === null ||
        !isCurrent
    ) {
        return null;
    }

    return commands.appSyncRealtimeFriendSnapshot(
        context.userId,
        context.endpoint,
        context.websocket,
        runtimeTransportGeneration,
        useFriendRosterStore.getState().friendsById as unknown as Record<
            string,
            BackendFriendRecord
        >
    );
}

export async function syncRuntimeRealtimeCurrentUserSnapshot(
    snapshot: unknown,
    overlayPatch: unknown = null
) {
    const context = runtimeTransportContext ?? activeContext;
    if (
        !runtimeTransportActive ||
        !context?.userId ||
        runtimeTransportGeneration === null ||
        !isCurrentTransportIdentity(context) ||
        !snapshot ||
        typeof snapshot !== 'object'
    ) {
        return null;
    }

    return commands.appSyncRealtimeCurrentUserSnapshot(
        context.userId,
        context.endpoint,
        context.websocket,
        runtimeTransportGeneration,
        snapshot as Record<string, unknown>,
        overlayPatch && typeof overlayPatch === 'object'
            ? (overlayPatch as Record<string, unknown>)
            : null
    );
}

export function stopRealtimeTransport({
    preserveTelemetry = false,
    updateStatus = true
}: StopRealtimeTransportOptions = {}) {
    intentionalStop = true;
    ipcAnnouncedForActiveSession = false;
    stopRuntimeRealtimeTransport();
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
