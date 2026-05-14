import { backend } from '@/platform/index.js';
import { vrchatAuthRepository } from '@/repositories/index.js';
import { DEFAULT_WEBSOCKET_DOMAIN } from '@/repositories/vrchatAuthRepository.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { refreshFriendAndFavoriteSnapshots } from './backgroundMaintenanceService.js';
import { isHostCapabilityAvailable } from './hostCapabilityService.js';
import { handleRealtimePresenceEvent } from './realtimePresenceService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';
import { syncStartupServicesTask } from './startupServicesStatus.js';

let activeSocket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let activeContext: Record<string, any> | null = null;
let intentionalStop = false;
let ipcAnnouncedForActiveSession = false;
let lastSocketMessage = '';

function clearReconnectTimer() {
    if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function normalizeWebsocketDomain(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim().replace(/\/+$/, '');
    }

    return DEFAULT_WEBSOCKET_DOMAIN;
}

function getTransportUrl(domain: unknown, token: string) {
    return `${normalizeWebsocketDomain(domain)}/?auth=${encodeURIComponent(token)}`;
}

function parseTransportMessage(data: unknown): { json: Record<string, any> | null } {
    if (typeof data !== 'string') {
        return {
            json: null
        };
    }

    try {
        const json = JSON.parse(data);
        if (typeof json?.content === 'string') {
            try {
                json.content = JSON.parse(json.content);
            } catch {
                // keep the original string payload if it is not JSON
            }
        }

        return {
            json
        };
    } catch {
        return {
            json: null
        };
    }
}

function isCurrentTransportTarget(context: Record<string, any> | null = activeContext) {
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
        sessionState.sessionPhase === 'ready' &&
        sessionState.isFriendsLoaded
    );
}

function updateTransportStartupDetail(detail: string) {
    syncStartupServicesTask([detail]);
}

function scheduleReconnect() {
    if (!isCurrentTransportTarget()) {
        return;
    }

    useRuntimeStore.getState().incrementTransportReconnect();
    useSessionStore.getState().setTransportStatus('pipeline-reconnecting');
    clearReconnectTimer();
    reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectRealtimeTransport({
            announceIpc: false,
            preserveMetrics: true
        }).catch((error) => {
            handleTransportFailure(error, { reconnecting: true });
        });
    }, 5000);
}

function handleTransportFailure(error: unknown, { reconnecting = false } = {}) {
    if (!isCurrentTransportTarget()) {
        return;
    }

    const message = error instanceof Error ? error.message : String(error);
    useSessionStore
        .getState()
        .setTransportStatus(
            reconnecting ? 'pipeline-reconnecting' : 'pipeline-error'
        );
    updateTransportStartupDetail(
        [`Realtime transport bootstrap failed: ${message}.`].join(' ')
    );
    if (!reconnecting) {
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Realtime transport failed',
            message
        });
    }

    scheduleReconnect();
}

function refreshBaselineAfterReconnect() {
    void refreshFriendAndFavoriteSnapshots().catch((error) => {
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Realtime baseline refresh failed',
            message: error instanceof Error ? error.message : String(error)
        });
    });
}

function attachSocketHandlers(
    socket: WebSocket,
    context: Record<string, any>,
    { refreshBaselineOnOpen = false } = {}
) {
    socket.onopen = () => {
        if (socket !== activeSocket || !isCurrentTransportTarget(context)) {
            try {
                socket.close();
            } catch {
                // ignore stale socket close failure
            }
            return;
        }

        useRuntimeStore.getState().setTransportState({
            websocketConnected: true,
            websocketDomain: normalizeWebsocketDomain(context.websocket),
            lastConnectedAt: new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('pipeline-connected');
        updateTransportStartupDetail(
            [
                'Friend roster baseline, IPC announce, and websocket transport are active.'
            ].join(' ')
        );
        if (refreshBaselineOnOpen) {
            refreshBaselineAfterReconnect();
        }
    };

    socket.onmessage = ({ data }) => {
        if (socket !== activeSocket || !isCurrentTransportTarget(context)) {
            return;
        }

        const parsedMessage = parseTransportMessage(data);

        if (typeof data === 'string') {
            if (lastSocketMessage === data) {
                return;
            }
            lastSocketMessage = data;
        }

        if (parsedMessage.json) {
            Promise.resolve(
                handleRealtimePresenceEvent(parsedMessage.json)
            ).catch(async (error) => {
                await showSQLiteErrorDialog(error);
                useNotificationStore.getState().pushNotification({
                    level: 'warning',
                    title: 'Realtime event failed',
                    message:
                        error instanceof Error ? error.message : String(error)
                });
            });
        }
    };

    socket.onerror = () => {
        if (socket !== activeSocket || !isCurrentTransportTarget(context)) {
            return;
        }

        useSessionStore.getState().setTransportStatus('pipeline-error');
    };

    socket.onclose = () => {
        if (socket !== activeSocket) {
            return;
        }

        activeSocket = null;

        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            lastDisconnectedAt: new Date().toISOString()
        });

        if (intentionalStop || !isCurrentTransportTarget(context)) {
            useSessionStore.getState().setTransportStatus('disconnected');
            return;
        }

        scheduleReconnect();
    };
}

async function connectRealtimeTransport({
    announceIpc,
    preserveMetrics
}: Record<string, any>) {
    const context = activeContext;
    if (!isCurrentTransportTarget(context)) {
        return stopRealtimeTransport();
    }

    clearReconnectTimer();
    lastSocketMessage = '';

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

    useSessionStore.getState().setTransportStatus('pipeline-connecting');
    const authSession = await vrchatAuthRepository.getAuthSession({
        endpoint: context.endpoint
    });

    const authJson = authSession?.json as Record<string, any> | undefined;
    if (!authJson?.ok || !authJson?.token) {
        throw new Error(
            'The auth transport bootstrap did not return a websocket token.'
        );
    }

    if (!isCurrentTransportTarget(context)) {
        return stopRealtimeTransport();
    }

    const socket = new WebSocket(
        getTransportUrl(context.websocket, authJson.token)
    );
    activeSocket = socket;
    attachSocketHandlers(socket, context, {
        refreshBaselineOnOpen: Boolean(preserveMetrics)
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
        activeSocket !== null
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
        handleTransportFailure(error, { reconnecting: false });
        throw error;
    }

    return stopRealtimeTransport;
}

export function stopRealtimeTransport({
    preserveTelemetry = false,
    updateStatus = true
} = {}) {
    intentionalStop = true;
    clearReconnectTimer();
    lastSocketMessage = '';

    const socket = activeSocket;
    activeSocket = null;
    activeContext = null;
    ipcAnnouncedForActiveSession = false;

    if (socket !== null) {
        try {
            socket.close();
        } catch {
            // ignore transport shutdown errors
        }
    }

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
