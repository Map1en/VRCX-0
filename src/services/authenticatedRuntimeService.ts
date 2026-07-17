import type {
    AuthenticatedRuntimePhaseSnapshot,
    RealtimeWsStatusPayload
} from '@/platform/tauri/bindings';
import { normalizeVrchatEndpointKey } from '@/shared/vrchatEndpoint';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    normalizeFriendsById,
    normalizeStringArray
} from './friendBootstrapModel';
import { signalFriendLogChanged } from './friendLogMutationService';
import { syncStartupServicesTask } from './startupServicesStatus';

let latestSnapshot: AuthenticatedRuntimePhaseSnapshot | null = null;
let appliedFriendRunId = 0;
let appliedFavoritesRunId = 0;
let initializedTransportRunId = 0;
let friendStepKey = '';
let favoritesStepKey = '';
let pendingRealtimeStatus: RealtimeWsStatusPayload | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function matchesCurrentSession(
    snapshot: AuthenticatedRuntimePhaseSnapshot
): boolean {
    const auth = useRuntimeStore.getState().auth;
    const session = useSessionStore.getState();
    return Boolean(
        session.isLoggedIn &&
        session.sessionPhase === 'ready' &&
        auth.currentUserId === snapshot.userId &&
        normalizeVrchatEndpointKey(auth.currentUserEndpoint) ===
            normalizeVrchatEndpointKey(snapshot.endpoint) &&
        auth.currentUserWebsocket === snapshot.websocket
    );
}

function applyFriendStep(snapshot: AuthenticatedRuntimePhaseSnapshot): void {
    const key = `${snapshot.runId}:${snapshot.friends.status}:${snapshot.friends.attempt}`;
    if (friendStepKey !== key) {
        friendStepKey = key;
        if (
            snapshot.friends.status === 'running' &&
            !useSessionStore.getState().isFriendsLoaded
        ) {
            useFriendRosterStore
                .getState()
                .setRosterLoading(snapshot.userId, snapshot.friends.detail);
        } else if (
            snapshot.friends.status === 'retryWaiting' &&
            snapshot.friends.lastError
        ) {
            useFriendRosterStore
                .getState()
                .setRosterError(snapshot.friends.lastError);
        }
    }

    const output = snapshot.friendBaseline;
    const baseline = isRecord(output?.snapshot) ? output.snapshot : null;
    if (
        snapshot.friends.status !== 'ready' ||
        !baseline ||
        appliedFriendRunId === snapshot.runId
    ) {
        return;
    }

    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: snapshot.userId,
        friendsById: normalizeFriendsById(baseline.friendsById),
        orderedFriendIds: normalizeStringArray(baseline.orderedFriendIds),
        onlineIds: normalizeStringArray(baseline.onlineIds),
        activeIds: normalizeStringArray(baseline.activeIds),
        offlineIds: normalizeStringArray(baseline.offlineIds),
        detail: output?.detail || snapshot.friends.detail
    });
    useSessionStore.getState().setFriendsLoaded(true);
    if (output?.friendLogChanged) {
        signalFriendLogChanged();
    }
    appliedFriendRunId = snapshot.runId;
}

function applyFavoritesStep(snapshot: AuthenticatedRuntimePhaseSnapshot): void {
    const key = `${snapshot.runId}:${snapshot.favorites.status}:${snapshot.favorites.attempt}`;
    if (favoritesStepKey !== key) {
        favoritesStepKey = key;
        if (
            snapshot.favorites.status === 'running' &&
            !useSessionStore.getState().isFavoritesLoaded
        ) {
            useFavoriteStore
                .getState()
                .setFavoritesLoading(
                    snapshot.userId,
                    snapshot.favorites.detail
                );
        } else if (
            snapshot.favorites.status === 'retryWaiting' &&
            snapshot.favorites.lastError
        ) {
            useFavoriteStore
                .getState()
                .setFavoritesError(snapshot.favorites.lastError);
        }
    }

    const baseline = snapshot.favoritesBaseline?.snapshot;
    if (
        snapshot.favorites.status !== 'ready' ||
        !isRecord(baseline) ||
        appliedFavoritesRunId === snapshot.runId
    ) {
        return;
    }

    useFavoriteStore.getState().setFavoritesSnapshot({
        ...baseline,
        detail:
            typeof baseline.detail === 'string'
                ? baseline.detail
                : snapshot.favorites.detail
    });
    useSessionStore.getState().setFavoritesLoaded(true);
    appliedFavoritesRunId = snapshot.runId;
}

function applyRealtimeStep(snapshot: AuthenticatedRuntimePhaseSnapshot): void {
    if (snapshot.phase === 'stopped') {
        pendingRealtimeStatus = null;
        initializedTransportRunId = snapshot.runId;
        useRuntimeStore.getState().setTransportState({
            websocketConnected: false,
            websocketDomain: snapshot.websocket,
            lastDisconnectedAt: snapshot.updatedAt || new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('disconnected');
        return;
    }

    if (initializedTransportRunId === snapshot.runId) {
        return;
    }
    initializedTransportRunId = snapshot.runId;
    useRuntimeStore.getState().setTransportState({
        websocketConnected: false,
        websocketDomain: snapshot.websocket,
        reconnectCount: 0,
        lastConnectedAt: null,
        lastDisconnectedAt: null
    });
    useSessionStore.getState().setTransportStatus('pipeline-connecting');
}

function positiveNumber(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function applyRealtimeStatus(
    payload: RealtimeWsStatusPayload,
    snapshot: AuthenticatedRuntimePhaseSnapshot
): void {
    const transport = snapshot.realtimeTransport;
    const clientRunId = positiveNumber(payload.clientRunId);
    if (!transport) {
        if (clientRunId === snapshot.runId) {
            pendingRealtimeStatus = payload;
        }
        return;
    }

    const generation = positiveNumber(payload.generation);
    const sessionGeneration = positiveNumber(payload.sessionGeneration);
    if (
        (clientRunId !== null && clientRunId !== transport.clientRunId) ||
        generation !== transport.generation ||
        (sessionGeneration !== null &&
            sessionGeneration !== transport.sessionGeneration)
    ) {
        return;
    }

    pendingRealtimeStatus = null;
    const runtimeStore = useRuntimeStore.getState();
    const sessionStore = useSessionStore.getState();
    const websocketDomain = String(
        payload.websocketDomain || snapshot.websocket || ''
    ).replace(/\/+$/, '');
    const at = String(payload.at || new Date().toISOString());

    switch (payload.status) {
        case 'connecting':
            sessionStore.setTransportStatus('pipeline-connecting');
            break;
        case 'connected':
            runtimeStore.setTransportState({
                websocketConnected: true,
                websocketDomain,
                lastConnectedAt: at
            });
            sessionStore.setTransportStatus('pipeline-connected');
            break;
        case 'reconnecting':
            runtimeStore.incrementTransportReconnect();
            runtimeStore.setTransportState({
                websocketConnected: false,
                websocketDomain,
                lastDisconnectedAt: at
            });
            sessionStore.setTransportStatus('pipeline-reconnecting');
            break;
        case 'error':
        case 'authFailure':
            runtimeStore.setTransportState({
                websocketConnected: false,
                websocketDomain,
                lastDisconnectedAt: at
            });
            sessionStore.setTransportStatus('pipeline-error');
            break;
        case 'disconnected':
            runtimeStore.setTransportState({
                websocketConnected: false,
                websocketDomain,
                lastDisconnectedAt: at
            });
            sessionStore.setTransportStatus('disconnected');
            break;
    }
}

export function applyAuthenticatedRuntimePhaseSnapshot(
    snapshot: AuthenticatedRuntimePhaseSnapshot
): void {
    if (!matchesCurrentSession(snapshot)) {
        return;
    }

    latestSnapshot = snapshot;
    applyFriendStep(snapshot);
    applyFavoritesStep(snapshot);
    applyRealtimeStep(snapshot);
    if (pendingRealtimeStatus && snapshot.realtimeTransport) {
        applyRealtimeStatus(pendingRealtimeStatus, snapshot);
    }
    if (snapshot.phase === 'ready') {
        syncStartupServicesTask([
            snapshot.friends.detail,
            snapshot.favorites.detail,
            snapshot.realtime.detail
        ]);
    }
}

export function handleAuthenticatedRuntimeRealtimeStatus(
    payload: RealtimeWsStatusPayload
): void {
    useRuntimeStore.getState().recordRuntimeEvent('realtimeWsStatus', payload);
    const snapshot = latestSnapshot;
    if (!snapshot || !matchesCurrentSession(snapshot)) {
        return;
    }
    applyRealtimeStatus(payload, snapshot);
}

export function resetAuthenticatedRuntimeMirror(): void {
    latestSnapshot = null;
    appliedFriendRunId = 0;
    appliedFavoritesRunId = 0;
    initializedTransportRunId = 0;
    friendStepKey = '';
    favoritesStepKey = '';
    pendingRealtimeStatus = null;
}
