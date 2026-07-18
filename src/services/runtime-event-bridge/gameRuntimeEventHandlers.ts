import { commands } from '@/platform/tauri/bindings';
import type {
    DebugLoggingOutcome,
    GameLogProjection,
    HostSessionProjection,
    NowPlayingPayload
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { recordRuntimeGameClientEvent } from '../gameClientLifecycle';
import { applyRuntimeGameLogProjection } from '../gameLogIngestService';
import { handleGameRunningUpdate } from '../gameStateService';
import { isHostCapabilityAvailable } from '../hostCapabilityService';
import { pushSharedFeedNotification } from '../sharedFeedNotificationService';
import { handleBrowserFocus } from '../vrcStatusService';
import type { RuntimeEventPayloadMap } from './types';

function publishNowPlayingSharedFeed(payload: NowPlayingPayload): void {
    const videoUrl = normalizeString(payload.videoUrl || payload.url);
    if (!videoUrl) {
        return;
    }

    const videoName = normalizeString(payload.videoName || payload.name);
    const displayName = normalizeString(payload.displayName);
    const message = [
        videoName || videoUrl,
        displayName ? `(${displayName})` : ''
    ]
        .filter(Boolean)
        .join(' ');

    pushSharedFeedNotification({
        ...payload,
        created_at:
            normalizeString(payload.created_at) ||
            normalizeString(payload.startedAt) ||
            new Date().toISOString(),
        type: 'VideoPlay',
        videoUrl,
        videoName,
        videoId: normalizeString(payload.videoId || payload.source),
        location: normalizeString(payload.location),
        displayName,
        userId: normalizeString(payload.userId),
        message,
        notyName: message
    }).catch((error: unknown) => {
        console.warn(
            'Failed to publish runtime video shared feed notification:',
            error
        );
    });
}

let lastDebugLoggingCheckId = 0;

function requestGameRunningStateRefresh(source: string): void {
    if (!isHostCapabilityAvailable('gameProcessMonitor')) {
        return;
    }

    commands.appCheckGameRunning().catch((error: unknown) => {
        console.warn(
            `Game process state refresh failed during ${source}:`,
            error
        );
    });
}

export function handleGameLogPersistenceFallback(
    payload: RuntimeEventPayloadMap['gameLogPersistenceFallback']
): void {
    useRuntimeStore
        .getState()
        .recordRuntimeEvent('gameLogPersistenceFallback', payload);
    const errorMessage = normalizeString(payload.error);
    if (errorMessage) {
        console.warn('Backend GameLog persistence failed:', errorMessage);
    }
}

export function handleRuntimeGameLogProjection(
    payload: GameLogProjection
): void {
    if (!isHostCapabilityAvailable('runtimeGameLogIngest')) {
        return;
    }
    applyRuntimeGameLogProjection(payload);
}

export function handleGameLogSideEffect(
    event: RuntimeEventPayloadMap['gameLogSideEffect']
): void {
    if (!isHostCapabilityAvailable('runtimeGameLogSideEffects')) {
        return;
    }
    const runtimeStore = useRuntimeStore.getState();
    switch (event.kind) {
        case 'nowPlaying':
            runtimeStore.setNowPlayingState(event.payload);
            publishNowPlayingSharedFeed(event.payload);
            break;
        case 'nowPlayingReset':
            runtimeStore.resetNowPlayingState();
            break;
        case 'screenshotProcessed':
            runtimeStore.setGameState({
                lastScreenshotPath: event.payload.path
            });
            break;
        case 'gameNoVR':
            runtimeStore.setGameState({
                isGameNoVR: event.payload.isGameNoVR
            });
            break;
        case 'notification':
            useNotificationStore
                .getState()
                .pushNotification({ ...event.payload });
            break;
    }
}

export function handleGameClientEvent(
    event: RuntimeEventPayloadMap['gameClientEvent']
): void {
    if (!isHostCapabilityAvailable('runtimeGameClientLifecycle')) {
        return;
    }
    recordRuntimeGameClientEvent(event.kind, event.payload);
    if (event.kind === 'notification') {
        useNotificationStore.getState().pushNotification({ ...event.payload });
    } else if (event.kind === 'debugLoggingOutcome') {
        handleDebugLoggingOutcome(event.payload);
    }
}

export function handleDebugLoggingOutcome(outcome: DebugLoggingOutcome): void {
    if (outcome.checkId <= lastDebugLoggingCheckId) {
        return;
    }
    lastDebugLoggingCheckId = outcome.checkId;
    if (outcome.kind === 'repaired') {
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: 'Enabled debug logging',
            message:
                'VRChat debug logging was disabled and has been re-enabled for game-log ingestion.'
        });
    } else if (outcome.kind === 'needsUserAction') {
        if (outcome.error) {
            console.error(
                'Failed to enable VRChat debug logging:',
                outcome.error
            );
        }
        useModalStore.getState().alert({
            title: 'Enable debug logging',
            description:
                'VRCX-0 noticed VRChat debug logging is disabled. Enable debug logging in VRChat quick menu settings > debug > enable debug logging, then rejoin the instance or restart VRChat.'
        });
    } else if (outcome.kind === 'unavailable' && outcome.error) {
        console.warn('Unable to inspect VRChat debug logging:', outcome.error);
    }
}

export function handleUpdateIsGameRunning(
    payload: HostSessionProjection
): void {
    if (!isHostCapabilityAvailable('gameProcessMonitor')) {
        return;
    }
    handleGameRunningUpdate(payload).catch((error: unknown) => {
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Game state update failed',
            message: error instanceof Error ? error.message : String(error)
        });
    });
}

export function handleBrowserFocusEvent(): void {
    useRuntimeStore.getState().setGameState({
        lastBrowserFocusAt: new Date().toISOString()
    });
    requestGameRunningStateRefresh('browser focus');
    handleBrowserFocus().catch((error: unknown) => {
        console.warn('Browser focus status refresh failed:', error);
    });
}
