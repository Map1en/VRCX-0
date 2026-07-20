import { commands } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    applyAuthenticatedRuntimePhaseSnapshot,
    handleAuthenticatedRuntimeRealtimeStatus,
    matchesAuthenticatedRuntimeAuthFailure,
    resetAuthenticatedRuntimeMirror
} from './authenticatedRuntimeService';
import { handleRuntimeAuthFailure } from './authSessionRecoveryService';
import { handleAppUpdateStatusEvent } from './backgroundMaintenanceUpdateService';
import { getCurrentDataDirMigrationStatus } from './dataDirMigrationService';
import { bindDeepLinkEvents, drainPendingDeepLinks } from './deepLinkService';
import { applyFriendProfileLoadStatusPayload } from './friendProfileLoadService';
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

function handleRuntimeVrchatAuthFailureEvent(
    failure: RuntimeEventPayloadMap['runtimeVrchatAuthFailure']
): void {
    if (!matchesAuthenticatedRuntimeAuthFailure(failure)) {
        return;
    }
    void handleRuntimeAuthFailure(failure);
}

function handleRuntimeEvent(event: RuntimeEvent): void {
    const runtimeStore = useRuntimeStore.getState();

    if (event.name === 'gameLogPersistenceFallback') {
        handleGameLogPersistenceFallback(event.payload);
        return;
    }

    if (event.name === 'friendProfileLoadStatus') {
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

    if (event.name === 'dataDirMigration') {
        useDataDirMigrationStore.getState().applyStatus(event.payload);
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
        handleRuntimeVrchatAuthFailureEvent(event.payload);
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
        'dataDirMigration',
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
            useDataDirMigrationStore
                .getState()
                .applyStatus(await getCurrentDataDirMigrationStatus());
        } catch (error) {
            console.warn(
                'Failed to hydrate data directory migration status:',
                error
            );
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
