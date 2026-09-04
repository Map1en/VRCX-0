import { commands } from '@/platform/tauri/bindings';
import type {
    AncillaryRuntimeSnapshot,
    BackendRuntimeCombinedSnapshot
} from '@/platform/tauri/bindings';
import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { handleAppLauncherSnapshotEvent } from './appLauncherSnapshotService';
import {
    applyAuthenticatedRuntimePhaseSnapshot,
    handleAuthenticatedRuntimeRealtimeStatus,
    matchesAuthenticatedRuntimeAuthFailure,
    resetAuthenticatedRuntimeMirror
} from './authenticatedRuntimeService';
import { handleRuntimeAuthFailure } from './authSessionRecoveryService';
import {
    applyBackgroundImageProjectionEvent,
    initializeBackgroundImage
} from './background-image/backgroundImageService';
import { handleAppUpdateStatusEvent } from './backgroundMaintenanceUpdateService';
import {
    applyCommunityThemeProjectionEvent,
    initializeCommunityThemes
} from './community-theme/installedThemes';
import { bindDeepLinkEvents, drainPendingDeepLinks } from './deepLinkService';
import {
    bindDesktopNotificationActivationEvents,
    takePendingDesktopNotificationActivation
} from './desktopNotificationActivationService';
import {
    handleFavoriteImportStatusEvent,
    hydrateFavoriteImportRuntimeStatus
} from './favoriteImportService';
import { applyFriendProfileLoadStatusPayload } from './friendProfileLoadService';
import { handleGroupBanImportStatusEvent } from './groupBanImportService';
import { isHostCapabilityAvailable } from './hostCapabilityService';
import {
    handleIntegrationApiStartFailed,
    hydrateIntegrationApiStatus
} from './integrationApiService';
import { handleMutualGraphFetchStatusEvent } from './mutualGraphFetchService';
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
    handleAuthenticatedSessionProjection,
    handleBackendRuntimeSyncSnapshot,
    hydrateBackendRuntimeSnapshot
} from './runtime-event-bridge/backendRuntimeHydration';
import {
    handleBrowserFocusEvent,
    handleDebugLoggingOutcome,
    handleGameClientEvent,
    handleGameLogPersistenceFallback,
    handleGameLogSideEffect,
    getNowPlayingEventRevision,
    handleRuntimeGameLogProjection,
    handleUpdateIsGameRunning
} from './runtime-event-bridge/gameRuntimeEventHandlers';
import { subscribeRuntimeEvent as subscribeTypedRuntimeEvent } from './runtime-event-bridge/subscription';
import type {
    RuntimeEvent,
    RuntimeEventName,
    RuntimeEventPayloadMap
} from './runtime-event-bridge/types';
import { handleScreenshotExportProgressEvent } from './screenshotExportService';
import { handleScreenshotLibraryScanStatusEvent } from './screenshotLibraryScanService';
import {
    handleAppUpdateDownloadProgressEvent,
    handleAppUpdateDownloadStatusSnapshot,
    handleAppUpdateInstalledEvent
} from './updateInstallService';
import { applyVrcStatusSnapshot } from './vrcStatusService';

function reconcilePendingBackendRealtimeProjectionEvents(): void {
    prunePendingBackendRealtimeProjectionEvents();
    flushPendingBackendRealtimeProjectionEvents();
}

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

    if (event.name === 'appLauncherSnapshot') {
        handleAppLauncherSnapshotEvent(event.payload);
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

    if (event.name === 'backgroundImageState') {
        applyBackgroundImageProjectionEvent(event.payload);
        return;
    }

    if (event.name === 'communityThemeState') {
        applyCommunityThemeProjectionEvent(event.payload);
        return;
    }

    if (event.name === 'notificationDoNotDisturbState') {
        runtimeStore.setNotificationDoNotDisturb(event.payload);
        return;
    }

    if (event.name === 'vrcStatus') {
        applyVrcStatusSnapshot(event.payload);
        return;
    }

    if (event.name === 'favoriteImportStatus') {
        handleFavoriteImportStatusEvent(event.payload);
        return;
    }

    if (event.name === 'groupBanImportStatus') {
        handleGroupBanImportStatusEvent(event.payload);
        return;
    }

    if (event.name === 'mutualGraphFetchStatus') {
        handleMutualGraphFetchStatusEvent(event.payload);
        return;
    }

    if (event.name === 'screenshotLibraryScanStatus') {
        handleScreenshotLibraryScanStatusEvent(event.payload);
        return;
    }

    if (event.name === 'screenshotExportProgress') {
        handleScreenshotExportProgressEvent(event.payload);
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

    if (event.name === 'authenticatedSessionProjection') {
        runtimeStore.recordRuntimeEvent(event.name, event.payload);
        handleAuthenticatedSessionProjection(
            event.payload,
            reconcilePendingBackendRealtimeProjectionEvents
        );
        return;
    }

    if (event.name === 'realtimeWsStatus') {
        handleAuthenticatedRuntimeRealtimeStatus(event.payload);
        return;
    }

    if (event.name === 'realtimeProjectionSync') {
        const snapshot = event.payload.snapshot;
        handleBackendRuntimeSyncSnapshot(
            snapshot,
            reconcilePendingBackendRealtimeProjectionEvents
        );
        return;
    }

    if (handleBackendRealtimeProjectionEvent(event)) {
        return;
    }

    runtimeStore.recordRuntimeEvent(event.name, event.payload);

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

    if (event.name === 'integrationApiStartFailed') {
        handleIntegrationApiStartFailed(event.payload);
        return;
    }

    if (event.name === 'browserFocus') {
        handleBrowserFocusEvent();
    }
}

async function hydrateRuntimeState<TResult>(
    failureMessage: string,
    hydrate: () => TResult | PromiseLike<TResult>
): Promise<void> {
    try {
        await hydrate();
    } catch (error) {
        console.warn(failureMessage, error);
    }
}

async function loadAncillaryRuntimeSnapshot(): Promise<AncillaryRuntimeSnapshot | null> {
    try {
        return await commands.appAncillaryRuntimeSnapshotGet();
    } catch (error) {
        console.warn('Failed to hydrate ancillary runtime snapshot:', error);
        return null;
    }
}

function gameRunningEventCount(): number {
    return (
        useRuntimeStore.getState().runtimeEvents.updateIsGameRunning?.count ?? 0
    );
}

async function hydrateAncillaryRuntimeState(): Promise<void> {
    const gameRunningEventCountBeforeSnapshot = gameRunningEventCount();
    const nowPlayingEventRevisionBeforeSnapshot = getNowPlayingEventRevision();
    const snapshot = await loadAncillaryRuntimeSnapshot();
    const gameProcessSnapshotIsStale =
        gameRunningEventCount() !== gameRunningEventCountBeforeSnapshot;
    const nowPlayingSnapshotIsStale =
        getNowPlayingEventRevision() !== nowPlayingEventRevisionBeforeSnapshot;

    const maintenance = hydrateRuntimeState(
        'Failed to run registry backup maintenance during hydration:',
        runForegroundUpdateRegistryBackupMaintenance
    );
    const favoriteImport = hydrateRuntimeState(
        'Failed to hydrate favorite import status:',
        hydrateFavoriteImportRuntimeStatus
    );
    if (!snapshot) {
        await Promise.all([maintenance, favoriteImport]);
        return;
    }

    await Promise.all([
        maintenance,
        favoriteImport,
        hydrateRuntimeState(
            'Failed to hydrate community theme projection:',
            async () => {
                if (snapshot.communityThemeState) {
                    await initializeCommunityThemes(
                        snapshot.communityThemeState
                    );
                }
            }
        ),
        hydrateRuntimeState(
            'Failed to hydrate profile backup status:',
            async () => {
                useProfileBackupStore
                    .getState()
                    .applyStatus(snapshot.profileBackupCurrentStatus);
            }
        ),
        hydrateRuntimeState(
            'Failed to hydrate data directory migration status:',
            async () => {
                useDataDirMigrationStore
                    .getState()
                    .applyStatus(snapshot.dataDirMigrationCurrentStatus);
            }
        ),
        hydrateRuntimeState(
            'Failed to hydrate mutual graph fetch status:',
            async () => {
                handleMutualGraphFetchStatusEvent(
                    snapshot.mutualGraphFetchStatus
                );
            }
        ),
        hydrateRuntimeState('Failed to hydrate app update status:', () =>
            handleAppUpdateStatusEvent(snapshot.appUpdateStatus)
        ),
        hydrateRuntimeState(
            'Failed to hydrate debug logging status:',
            async () => {
                if (snapshot.gameClientDebugLoggingStatus) {
                    handleDebugLoggingOutcome(
                        snapshot.gameClientDebugLoggingStatus
                    );
                }
            }
        ),
        hydrateRuntimeState(
            'Failed to hydrate game process state:',
            async () => {
                if (
                    snapshot.gameProcessSnapshot &&
                    !gameProcessSnapshotIsStale &&
                    isHostCapabilityAvailable('gameProcessMonitor')
                ) {
                    handleUpdateIsGameRunning(snapshot.gameProcessSnapshot);
                }
            }
        ),
        hydrateRuntimeState('Failed to hydrate now playing state:', () => {
            if (!nowPlayingSnapshotIsStale) {
                useRuntimeStore
                    .getState()
                    .setNowPlayingState(snapshot.nowPlaying);
            }
        }),
        hydrateRuntimeState('Failed to hydrate background image state:', () =>
            initializeBackgroundImage(snapshot.backgroundImageState)
        ),
        hydrateRuntimeState('Failed to hydrate do not disturb state:', () => {
            useRuntimeStore
                .getState()
                .setNotificationDoNotDisturb(
                    snapshot.notificationDoNotDisturbState
                );
        }),
        hydrateRuntimeState(
            'Failed to hydrate app update download status:',
            async () => {
                handleAppUpdateDownloadStatusSnapshot(
                    snapshot.appUpdateDownloadStatus
                );
            }
        )
    ]);
}

export async function bindRuntimeEvents(): Promise<() => void> {
    resetBackendRealtimeProjectionState();
    resetAuthenticatedRuntimeMirror();
    const unsubscribers: RuntimeEventUnsubscribe[] = [];
    const events: RuntimeEventName[] = [
        'addGameLogEvent',
        'authenticatedSessionProjection',
        'authenticatedRuntimePhase',
        'appUpdateStatus',
        'appUpdateDownloadProgress',
        'appUpdateInstalled',
        'appLauncherSnapshot',
        'backendRuntimeTelemetry',
        'backgroundImageState',
        'communityThemeState',
        'notificationDoNotDisturbState',
        'gameLogProjection',
        'gameLogPersistenceFallback',
        'gameLogSideEffect',
        'runtimeGroupInstancesProjection',
        'printsAutoCleanup',
        'profileBackupStatus',
        'profileRestoreProgress',
        'dataDirMigration',
        'favoriteImportStatus',
        'favoritesChanged',
        'groupBanImportStatus',
        'groupMembershipBatchProgress',
        'groupModerationBatchProgress',
        'mutualGraphFetchStatus',
        'screenshotLibraryScanStatus',
        'screenshotExportProgress',
        'friendProfileLoadStatus',
        'gameClientEvent',
        'runtimeWorkerError',
        'runtimeVrchatAuthFailure',
        'vrcStatus',
        'realtimeFriendProjection',
        'realtimeFeedProjection',
        'realtimeUserProjection',
        'realtimeEntryCorrection',
        'realtimeNotificationProjection',
        'realtimeWsStatus',
        'realtimeCurrentUserProjection',
        'realtimeInstanceClosedProjection',
        'realtimeInstanceQueueProjection',
        'realtimeProjectionSync',
        'updateIsGameRunning',
        'integrationApiStartFailed',
        'browserFocus'
    ];

    useSessionStore.getState().setTransportStatus('runtime-subscribing');

    try {
        const subscriptions = await Promise.allSettled(
            events.map(subscribeRuntimeEvent)
        );
        const failure = subscriptions.find(
            (subscription) => subscription.status === 'rejected'
        );
        for (const subscription of subscriptions) {
            if (subscription.status === 'fulfilled') {
                unsubscribers.push(subscription.value);
            }
        }
        if (failure) {
            throw failure.reason;
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
    await hydrateRuntimeState(
        'Failed to hydrate Integration API status:',
        async () => {
            hydrateIntegrationApiStatus(
                await commands.appIntegrationApiStatus()
            );
        }
    );
    let combinedSnapshot: BackendRuntimeCombinedSnapshot | null = null;
    try {
        combinedSnapshot =
            await commands.appBackendRuntimeCombinedSnapshotGet();
    } catch (error) {
        console.warn(
            'Failed to fetch backend runtime combined snapshot:',
            error
        );
    }
    try {
        if (!combinedSnapshot) {
            throw new Error(
                'Backend runtime combined snapshot is unavailable.'
            );
        }
        await hydrateBackendRuntimeSnapshot(
            combinedSnapshot.backendRuntime,
            combinedSnapshot.authenticatedSession,
            reconcilePendingBackendRealtimeProjectionEvents
        );
    } catch (error) {
        useRuntimeStore.getState().setShellState({
            backendRuntimeSnapshotHydrated: true,
            backendRuntimeSessionHydrating: false
        });
        console.warn('Failed to hydrate backend runtime snapshot:', error);
    }
    try {
        if (!combinedSnapshot) {
            throw new Error(
                'Backend runtime combined snapshot is unavailable.'
            );
        }
        applyAuthenticatedRuntimePhaseSnapshot(
            combinedSnapshot.authenticatedRuntimePhase
        );
    } catch (error) {
        console.warn('Failed to hydrate authenticated runtime phase:', error);
    }
    await hydrateAncillaryRuntimeState();
    try {
        unsubscribers.push(await bindDeepLinkEvents());
        unsubscribers.push(await bindDesktopNotificationActivationEvents());
        await Promise.all([
            drainPendingDeepLinks(),
            takePendingDesktopNotificationActivation()
        ]);
    } catch (error) {
        resetBackendRealtimeProjectionState();
        resetAuthenticatedRuntimeMirror();
        unsubscribeRuntimeEvents(unsubscribers);
        useSessionStore.getState().setTransportStatus('disconnected');
        throw error;
    }
    void requestGroupInstancesRefresh(
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
    return subscribeTypedRuntimeEvent(name, (payload) => {
        handleRuntimeEvent({ name, payload } as RuntimeEvent);
    });
}
