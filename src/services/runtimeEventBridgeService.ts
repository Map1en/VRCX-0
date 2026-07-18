import { commands } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import { createRequestError } from '@/repositories/vrchatRequest';
import { normalizeVrchatEndpointKey } from '@/shared/vrchatEndpoint';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    applyAuthenticatedRuntimePhaseSnapshot,
    handleAuthenticatedRuntimeRealtimeStatus,
    resetAuthenticatedRuntimeMirror
} from './authenticatedRuntimeService';
import { handleRuntimeAuthFailure } from './authSessionRecoveryService';
import { handleAppUpdateStatusEvent } from './backgroundMaintenanceUpdateService';
import { bindDeepLinkEvents, drainPendingDeepLinks } from './deepLinkService';
import {
    applyFriendProfileLoadStatusPayload,
    isFriendProfileLoadTerminalStatus
} from './friendProfileLoadService';
import { getCurrentProfileBackupStatus } from './profileBackupService';
import { handleRealtimeEntryCorrection } from './realtimePresenceService';
import { runForegroundUpdateRegistryBackupMaintenance } from './registryBackupMaintenanceService';
import {
    handleFavoritesChangedEvent,
    handlePrintCleanupEvent,
    handleRuntimeGroupInstancesProjection,
    requestGroupInstancesRefresh
} from './runtime-event-bridge/auxiliaryEventHandlers';
import {
    flushFriendProfileProjectionBatch,
    flushPendingBackendRealtimeProjectionEvents,
    handleBackendRealtimeProjectionEvent,
    prunePendingBackendRealtimeProjectionEvents,
    resetBackendRealtimeProjectionState
} from './runtime-event-bridge/backendRealtimeProjection';
import {
    handleBackendRuntimeTelemetrySnapshot,
    hydrateBackendRuntimeSnapshot
} from './runtime-event-bridge/backendRuntimeHydration';
import {
    handleBrowserFocusEvent,
    handleDebugLoggingOutcome,
    handleGameClientEvent,
    handleGameLogPersistenceFallback,
    handleGameLogSideEffect,
    handleRuntimeGameLogProjection,
    handleUpdateIsGameRunning
} from './runtime-event-bridge/gameRuntimeEventHandlers';
import type {
    RuntimeEvent,
    RuntimeEventName,
    RuntimeEventPayloadMap
} from './runtime-event-bridge/types';
import {
    handleAppUpdateDownloadProgressEvent,
    handleAppUpdateInstalledEvent
} from './updateInstallService';

type RuntimeEventUnsubscribe = () => void;

async function handleRuntimeVrchatAuthFailureEvent(
    failure: RuntimeEventPayloadMap['runtimeVrchatAuthFailure']
): Promise<void> {
    if (failure.statusCode !== 401) {
        return;
    }
    const authScope = await commands
        .appRuntimeAuthScopeGet()
        .catch((error: unknown) => {
            console.warn('Failed to verify VRChat auth failure scope:', error);
            return null;
        });
    if (
        !authScope?.active ||
        authScope.currentUserId !== failure.ownerUserId.trim() ||
        normalizeVrchatEndpointKey(authScope.endpoint) !==
            normalizeVrchatEndpointKey(failure.endpoint) ||
        authScope.generation !== failure.authScopeGeneration
    ) {
        return;
    }
    void handleRuntimeAuthFailure(
        createRequestError(
            failure.reason,
            failure.statusCode,
            failure.path,
            failure
        )
    );
}

function handleRuntimeEvent(event: RuntimeEvent): void {
    const runtimeStore = useRuntimeStore.getState();

    if (event.name === 'gameLogPersistenceFallback') {
        handleGameLogPersistenceFallback(event.payload);
        return;
    }

    if (event.name === 'friendProfileLoadStatus') {
        if (isFriendProfileLoadTerminalStatus(event.payload.status)) {
            flushFriendProfileProjectionBatch();
        }
        runtimeStore.recordRuntimeEvent(event.name, event.payload);
        applyFriendProfileLoadStatusPayload(event.payload);
        return;
    }

    if (event.name === 'printsAutoCleanup') {
        runtimeStore.recordRuntimeEvent(event.name, event.payload);
        handlePrintCleanupEvent(event.payload);
        return;
    }

    if (event.name === 'appUpdateStatus') {
        void handleAppUpdateStatusEvent(event.payload);
        void runForegroundUpdateRegistryBackupMaintenance();
        return;
    }

    if (event.name === 'appUpdateDownloadProgress') {
        handleAppUpdateDownloadProgressEvent(event.payload);
        return;
    }

    if (event.name === 'appUpdateInstalled') {
        handleAppUpdateInstalledEvent(event.payload);
        return;
    }

    if (event.name === 'profileBackupStatus') {
        useProfileBackupStore.getState().applyStatus(event.payload);
        return;
    }

    if (event.name === 'profileRestoreProgress') {
        useProfileBackupStore.getState().applyRestoreProgress(event.payload);
        return;
    }

    if (event.name === 'favoritesChanged') {
        runtimeStore.recordRuntimeEvent(event.name, event.payload);
        handleFavoritesChangedEvent(event.payload);
        return;
    }

    if (event.name === 'authenticatedRuntimePhase') {
        runtimeStore.recordRuntimeEvent(event.name, event.payload);
        applyAuthenticatedRuntimePhaseSnapshot(event.payload);
        return;
    }

    if (event.name === 'realtimeWsStatus') {
        handleAuthenticatedRuntimeRealtimeStatus(event.payload);
        return;
    }

    if (handleBackendRealtimeProjectionEvent(event.name, event.payload)) {
        return;
    }

    runtimeStore.recordRuntimeEvent(event.name, event.payload);

    if (event.name === 'backendRuntimeTelemetry') {
        const snapshot = event.payload.snapshot;
        prunePendingBackendRealtimeProjectionEvents(snapshot);
        handleBackendRuntimeTelemetrySnapshot(
            snapshot,
            flushPendingBackendRealtimeProjectionEvents
        );
        return;
    }

    if (event.name === 'realtimeEntryCorrection') {
        handleRealtimeEntryCorrection(event.payload);
        return;
    }

    if (event.name === 'gameLogProjection') {
        handleRuntimeGameLogProjection(event.payload);
        return;
    }

    if (event.name === 'gameLogSideEffect') {
        handleGameLogSideEffect(event.payload);
        return;
    }

    if (event.name === 'runtimeGroupInstancesProjection') {
        handleRuntimeGroupInstancesProjection(event.payload);
        return;
    }

    if (event.name === 'gameClientEvent') {
        handleGameClientEvent(event.payload);
        return;
    }

    if (event.name === 'runtimeWorkerError') {
        console.warn('Backend worker error:', event.payload);
        return;
    }

    if (event.name === 'runtimeVrchatAuthFailure') {
        void handleRuntimeVrchatAuthFailureEvent(event.payload);
        return;
    }

    if (event.name === 'updateIsGameRunning') {
        handleUpdateIsGameRunning(event.payload);
        return;
    }

    if (event.name === 'browserFocus') {
        handleBrowserFocusEvent();
    }
}

export async function bindRuntimeEvents(): Promise<() => void> {
    resetBackendRealtimeProjectionState();
    resetAuthenticatedRuntimeMirror();
    const unsubscribers: RuntimeEventUnsubscribe[] = [];
    const events: RuntimeEventName[] = [
        'addGameLogEvent',
        'authenticatedRuntimePhase',
        'appUpdateStatus',
        'appUpdateDownloadProgress',
        'appUpdateInstalled',
        'backendRuntimeTelemetry',
        'gameLogProjection',
        'gameLogPersistenceFallback',
        'gameLogSideEffect',
        'runtimeGroupInstancesProjection',
        'overlayActivitySnapshot',
        'printsAutoCleanup',
        'profileBackupStatus',
        'profileRestoreProgress',
        'favoritesChanged',
        'friendProfileLoadStatus',
        'gameClientEvent',
        'runtimeWorkerError',
        'runtimeVrchatAuthFailure',
        'realtimeFriendProjection',
        'realtimeUserProjection',
        'realtimeEntryCorrection',
        'realtimeNotificationProjection',
        'realtimeWsStatus',
        'realtimeCurrentUserProjection',
        'realtimeInstanceClosedProjection',
        'realtimeInstanceQueueProjection',
        'updateIsGameRunning',
        'browserFocus'
    ];

    useSessionStore.getState().setTransportStatus('runtime-subscribing');

    try {
        for (const name of events) {
            const unsubscribe = await subscribeRuntimeEvent(name);
            unsubscribers.push(unsubscribe);
        }
        try {
            useProfileBackupStore
                .getState()
                .applyStatus(await getCurrentProfileBackupStatus());
        } catch (error) {
            console.warn('Failed to hydrate profile backup status:', error);
        }
        try {
            await handleAppUpdateStatusEvent(
                await commands.appAppUpdateStatusGet()
            );
        } catch (error) {
            console.warn('Failed to hydrate app update status:', error);
        }
        try {
            const debugLoggingOutcome =
                await commands.appGameClientDebugLoggingStatus();
            if (debugLoggingOutcome) {
                handleDebugLoggingOutcome(debugLoggingOutcome);
            }
        } catch (error) {
            console.warn('Failed to hydrate debug logging status:', error);
        }
        try {
            await runForegroundUpdateRegistryBackupMaintenance();
        } catch (error) {
            console.warn(
                'Failed to run registry backup maintenance during hydration:',
                error
            );
        }
        try {
            const downloadStatus =
                await commands.appAppUpdateDownloadStatusGet();
            useRuntimeStore.getState().setUpdateLoopState({
                autoDownloadState: downloadStatus.phase,
                downloadedVersion: downloadStatus.version,
                downloadProgress: downloadStatus.percent
            });
        } catch (error) {
            console.warn(
                'Failed to hydrate app update download status:',
                error
            );
        }
    } catch (error) {
        resetBackendRealtimeProjectionState();
        resetAuthenticatedRuntimeMirror();
        unsubscribeRuntimeEvents(unsubscribers);
        useRuntimeStore.getState().setShellState({
            backendRuntimeSnapshotHydrated: true,
            backendRuntimeSessionHydrating: false
        });
        useSessionStore.getState().setTransportStatus('disconnected');
        throw error;
    }

    useSessionStore.getState().setTransportStatus('runtime-subscribed');
    try {
        const snapshot = await commands.appGetBackendRuntimeSnapshot();
        await hydrateBackendRuntimeSnapshot(
            snapshot,
            flushPendingBackendRealtimeProjectionEvents
        );
    } catch (error) {
        useRuntimeStore.getState().setShellState({
            backendRuntimeSnapshotHydrated: true,
            backendRuntimeSessionHydrating: false
        });
        console.warn('Failed to hydrate backend runtime snapshot:', error);
    }
    try {
        applyAuthenticatedRuntimePhaseSnapshot(
            await commands.appAuthenticatedRuntimePhaseSnapshotGet()
        );
    } catch (error) {
        console.warn('Failed to hydrate authenticated runtime phase:', error);
    }
    try {
        unsubscribers.push(await bindDeepLinkEvents());
        await drainPendingDeepLinks();
    } catch (error) {
        resetBackendRealtimeProjectionState();
        resetAuthenticatedRuntimeMirror();
        unsubscribeRuntimeEvents(unsubscribers);
        useSessionStore.getState().setTransportStatus('disconnected');
        throw error;
    }
    requestGroupInstancesRefresh(
        'runtime event binding after backend snapshot hydration'
    );

    return () => {
        resetBackendRealtimeProjectionState();
        resetAuthenticatedRuntimeMirror();
        unsubscribeRuntimeEvents(unsubscribers);
        useSessionStore.getState().setTransportStatus('disconnected');
    };
}

function unsubscribeRuntimeEvents(
    unsubscribers: RuntimeEventUnsubscribe[]
): void {
    for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    }
}

function subscribeRuntimeEvent<Name extends RuntimeEventName>(
    name: Name
): Promise<RuntimeEventUnsubscribe> {
    return tauriClient.events.subscribe<RuntimeEventPayloadMap[Name]>(
        name,
        (payload) => {
            handleRuntimeEvent({ name, payload } as RuntimeEvent);
        }
    );
}
