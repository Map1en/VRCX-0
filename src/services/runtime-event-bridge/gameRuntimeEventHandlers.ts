import type {
    DebugLoggingOutcome,
    GameLogProjection,
    HostSessionProjection,
    NowPlayingPayload
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { applyRuntimeGameLogProjection } from '../gameLogIngestService';
import { handleGameRunningUpdate } from '../gameStateService';
import { isHostCapabilityAvailable } from '../hostCapabilityService';
import { pushSharedFeedNotification } from '../sharedFeedNotificationService';
import { handleBrowserFocus } from '../vrcStatusService';
import type { RuntimeEventPayloadMap } from './types';

function publishNowPlayingSharedFeed(payload: NowPlayingPayload): void {
    const videoUrl = (payload.videoUrl || payload.url || '').trim();
    if (!videoUrl) {
        return;
    }

    const videoName = (payload.videoName || payload.name || '').trim();
    const displayName = (payload.displayName || '').trim();
    const message = [
        videoName || videoUrl,
        displayName ? `(${displayName})` : ''
    ]
        .filter(Boolean)
        .join(' ');

    pushSharedFeedNotification({
        ...payload,
        created_at:
            (payload.created_at || '').trim() ||
            payload.startedAt.trim() ||
            new Date().toISOString(),
        type: 'VideoPlay',
        videoUrl,
        videoName,
        videoId: (payload.videoId || payload.source || '').trim(),
        location: (payload.location || '').trim(),
        displayName,
        userId: (payload.userId || '').trim(),
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
let nowPlayingEventRevision = 0;

export function getNowPlayingEventRevision(): number {
    return nowPlayingEventRevision;
}

export function handleGameLogPersistenceFallback(
    payload: RuntimeEventPayloadMap['gameLogPersistenceFallback']
): void {
    useRuntimeStore
        .getState()
        .recordRuntimeEvent('gameLogPersistenceFallback', payload);
    const errorMessage = payload.error.trim();
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
    if (event.kind === 'nowPlaying' || event.kind === 'nowPlayingReset') {
        nowPlayingEventRevision += 1;
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
    handleBrowserFocus().catch((error: unknown) => {
        console.warn('Browser focus status refresh failed:', error);
    });
}
