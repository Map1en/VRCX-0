import type {
    DebugLoggingOutcome,
    GameLogProjection,
    HostSessionProjection
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { applyRuntimeGameLogProjection } from '../gameLogIngestService';
import { handleGameRunningUpdate } from '../gameStateService';
import { isHostCapabilityAvailable } from '../hostCapabilityService';
import i18n from '../i18nService';
import { toast } from '../toastService';
import { handleBrowserFocus } from '../vrcStatusService';
import type { RuntimeEventPayloadMap } from './types';

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
    }
}

export function handleGameClientEvent(
    event: RuntimeEventPayloadMap['gameClientEvent']
): void {
    if (!isHostCapabilityAvailable('runtimeGameClientLifecycle')) {
        return;
    }
    if (event.kind === 'notification') {
        toast.add({
            type: event.payload.level,
            title: event.payload.title,
            description: event.payload.message
        });
    } else if (event.kind === 'debugLoggingOutcome') {
        handleDebugLoggingOutcome(event.payload);
    }
}

export function handleDebugLoggingOutcome(outcome: DebugLoggingOutcome): void {
    if (outcome.checkId <= lastDebugLoggingCheckId) {
        return;
    }
    lastDebugLoggingCheckId = outcome.checkId;
    if (outcome.kind === 'needsUserAction') {
        if (outcome.error) {
            console.error(
                'Failed to enable VRChat debug logging:',
                outcome.error
            );
        }
        useModalStore.getState().alert({
            title: i18n.t('message.gamelog.debug_logging_title'),
            description: i18n.t('message.gamelog.debug_logging_description')
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
        toast.add({
            type: 'warning',
            title: i18n.t('message.gamelog.game_state_update_failed'),
            description: error instanceof Error ? error.message : String(error)
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
