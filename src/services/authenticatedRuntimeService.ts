import type {
    AuthenticatedRuntimePhaseSnapshot,
    RealtimeWsStatusPayload,
    RuntimeVrchatAuthFailurePayload
} from '@/platform/tauri/bindings';
import { normalizeVrchatEndpointKey } from '@/shared/vrchatEndpoint';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { rosterSnapshotInput } from './friendBootstrapModel';
import { signalFriendLogChanged } from './friendLogMutationService';
import { flushRealtimeRosterUpdates } from './realtimeRosterUpdateQueue';
import { syncStartupServicesTask } from './startupServicesStatus';

let latestSnapshot: AuthenticatedRuntimePhaseSnapshot | null = null;
let appliedFriendBaselineKey = '';
let appliedFavoritesRunId = 0;
let initializedTransportKey = '';
let friendStepKey = '';
let favoritesStepKey = '';
let pendingRealtimeStatus: RealtimeWsStatusPayload | null = null;

function matchesCurrentSession(
    snapshot: AuthenticatedRuntimePhaseSnapshot
): boolean {
    const authenticatedSession =
        useRuntimeStore.getState().authenticatedSession.session;
    const session = useSessionStore.getState();
    return Boolean(
        session.isLoggedIn &&
        session.sessionPhase === 'ready' &&
        authenticatedSession?.userId === snapshot.userId &&
        authenticatedSession.authScopeGeneration ===
            snapshot.authScopeGeneration &&
        normalizeVrchatEndpointKey(authenticatedSession.endpoint) ===
            normalizeVrchatEndpointKey(snapshot.endpoint) &&
        authenticatedSession.websocket === snapshot.websocket
    );
}

function replacesLatestSnapshot(
    snapshot: AuthenticatedRuntimePhaseSnapshot
): boolean {
    if (!latestSnapshot || snapshot.runId !== latestSnapshot.runId) {
        return !latestSnapshot || snapshot.runId > latestSnapshot.runId;
    }
    if (
        snapshot.friendBaselineRevision !==
        latestSnapshot.friendBaselineRevision
    ) {
        return (
            snapshot.friendBaselineRevision >
            latestSnapshot.friendBaselineRevision
        );
    }
    return snapshot.updatedAt >= latestSnapshot.updatedAt;
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
    const baseline = output?.snapshot ?? null;
    const baselineKey = `${snapshot.runId}:${snapshot.friendBaselineRevision}`;
    if (
        snapshot.friends.status !== 'ready' ||
        !baseline ||
        appliedFriendBaselineKey === baselineKey
    ) {
        return;
    }

    flushRealtimeRosterUpdates();
    useFriendRosterStore
        .getState()
        .setRosterSnapshot(
            rosterSnapshotInput(
                snapshot.userId,
                baseline,
                output?.detail || snapshot.friends.detail
            )
        );
    useSessionStore.getState().setFriendsLoaded(true);
    if (output?.friendLogChanged) {
        signalFriendLogChanged();
    }
    appliedFriendBaselineKey = baselineKey;
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
        !baseline ||
        appliedFavoritesRunId === snapshot.runId
    ) {
        return;
    }

    useFavoriteStore.getState().setFavoritesSnapshot(baseline);
    useSessionStore.getState().setFavoritesLoaded(true);
    appliedFavoritesRunId = snapshot.runId;
}

const CLEARED_REALTIME_RECOVERY = {
    interrupted: false,
    retryWaiting: false,
    retryAt: null,
    retryAttempt: 0,
    lastError: null,
    outageStartedAt: null
};

function applyRealtimeStep(snapshot: AuthenticatedRuntimePhaseSnapshot): void {
    if (snapshot.phase === 'error') {
        pendingRealtimeStatus = null;
        initializedTransportKey = `${snapshot.runId}:error`;
        useRuntimeStore.getState().setTransportState({
            ...CLEARED_REALTIME_RECOVERY,
            websocketConnected: false,
            websocketDomain: snapshot.websocket,
            lastDisconnectedAt: snapshot.updatedAt || new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('pipeline-error');
        return;
    }
    if (snapshot.phase === 'stopped') {
        pendingRealtimeStatus = null;
        initializedTransportKey = `${snapshot.runId}:stopped`;
        useRuntimeStore.getState().setTransportState({
            ...CLEARED_REALTIME_RECOVERY,
            websocketConnected: false,
            websocketDomain: snapshot.websocket,
            lastDisconnectedAt: snapshot.updatedAt || new Date().toISOString()
        });
        useSessionStore.getState().setTransportStatus('disconnected');
        return;
    }

    const health = snapshot.realtimeHealth;
    useRuntimeStore.getState().setTransportState({
        interrupted: health.interrupted,
        retryWaiting: snapshot.realtime.status === 'retryWaiting',
        retryAt: health.retryAt,
        retryAttempt: snapshot.realtime.attempt,
        lastError: snapshot.realtime.lastError,
        outageStartedAt: health.disconnectedAt
    });

    const transport = snapshot.realtimeTransport;
    const transportKey = transport
        ? `${snapshot.runId}:${transport.clientRunId}:${transport.generation}:${transport.sessionGeneration}`
        : `${snapshot.runId}:pending:${snapshot.realtime.status}:${snapshot.realtime.attempt}`;
    if (initializedTransportKey === transportKey) {
        return;
    }
    initializedTransportKey = transportKey;
    if (!transport && snapshot.realtime.status !== 'running') {
        return;
    }
    const connected = Boolean(
        transport && snapshot.realtime.status === 'ready'
    );
    useRuntimeStore.getState().setTransportState({
        websocketConnected: connected,
        websocketDomain: snapshot.websocket,
        ...(connected
            ? {
                  lastConnectedAt:
                      snapshot.updatedAt || new Date().toISOString()
              }
            : {})
    });
    useSessionStore
        .getState()
        .setTransportStatus(
            connected ? 'pipeline-connected' : 'pipeline-connecting'
        );
}

function positiveNumber(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;
}

export function matchesAuthenticatedRuntimeAuthFailure(
    failure: RuntimeVrchatAuthFailurePayload
): boolean {
    const snapshot = latestSnapshot;
    if (
        !snapshot ||
        (snapshot.phase !== 'starting' && snapshot.phase !== 'ready') ||
        snapshot.userId !== failure.ownerUserId.trim() ||
        normalizeVrchatEndpointKey(snapshot.endpoint) !==
            normalizeVrchatEndpointKey(failure.endpoint) ||
        snapshot.authScopeGeneration !== failure.authScopeGeneration
    ) {
        return false;
    }
    const expected = failure.realtimeTransport;
    const current = snapshot.realtimeTransport;
    return (
        !expected ||
        Boolean(
            current &&
            current.clientRunId === expected.clientRunId &&
            current.generation === expected.generation &&
            current.sessionGeneration === expected.sessionGeneration
        )
    );
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
        if (
            clientRunId === snapshot.runId &&
            generation !== null &&
            generation > transport.generation
        ) {
            pendingRealtimeStatus = payload;
        }
        return;
    }

    if (pendingRealtimeStatus === payload) {
        pendingRealtimeStatus = null;
    }
    const runtimeStore = useRuntimeStore.getState();
    const sessionStore = useSessionStore.getState();
    const websocketDomain = (
        payload.websocketDomain || snapshot.websocket
    ).replace(/\/+$/, '');
    const at = payload.at || new Date().toISOString();

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
    if (!matchesCurrentSession(snapshot) || !replacesLatestSnapshot(snapshot)) {
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

export function currentRealtimeTransportGeneration(): number | null {
    const snapshot = latestSnapshot;
    if (!snapshot || !matchesCurrentSession(snapshot)) {
        return null;
    }
    return positiveNumber(snapshot.realtimeTransport?.generation);
}

export function resetAuthenticatedRuntimeMirror(): void {
    latestSnapshot = null;
    appliedFriendBaselineKey = '';
    appliedFavoritesRunId = 0;
    initializedTransportKey = '';
    friendStepKey = '';
    favoritesStepKey = '';
    pendingRealtimeStatus = null;
}
