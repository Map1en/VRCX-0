import { backend } from '@/platform/index.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { recordBackendGameClientEvent } from './gameClientLifecycle.js';
import { handleGameRunningUpdate } from './gameStateService.js';
import {
    ingestBackendGameLogEvent,
    persistBackendGameLogFallbackBatch,
    resetNowPlayingState
} from './gameLogIngestService.js';
import {
    isHostCapabilityAvailable,
    refreshHostCapabilities
} from './hostCapabilityService.js';
import { handleIpcEvent } from './ipcEventService.js';
import { pushSharedFeedNotification } from './sharedFeedFilterService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';
import { handleBrowserFocus } from './vrcStatusService.js';

type BackendEventName =
    | 'addGameLogEvent'
    | 'gameLogPersistenceFallback'
    | 'gameLogSideEffect'
    | 'gameClientEvent'
    | 'backendWorkerError'
    | 'updateIsGameRunning'
    | 'ipcEvent'
    | 'browserFocus';

type CapabilityStatus = {
    available?: unknown;
};

type HostCapabilitySnapshot = Record<string, unknown> & {
    platform?: unknown;
    gameLogWatcher?: CapabilityStatus;
    vrchatPathDiscovery?: CapabilityStatus;
};

type BackendEventUnsubscribe = () => void;

let gameLogIngestQueue: Promise<unknown> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isBackendPersistedGameLogMirror(payload: unknown): boolean {
    return isRecord(payload) && payload.backendPersisted === true;
}

function publishNowPlayingSharedFeed(payload: Record<string, unknown>): void {
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

    void pushSharedFeedNotification({
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
    }).catch((error) => {
        console.warn(
            'Failed to publish backend video shared feed notification:',
            error
        );
    });
}

async function canIngestGameLogEvent(): Promise<boolean> {
    if (isHostCapabilityAvailable('gameLogWatcher')) {
        return true;
    }

    const capabilities = useRuntimeStore.getState()
        .hostCapabilities as HostCapabilitySnapshot;
    if (
        capabilities?.platform !== 'linux' ||
        !capabilities?.vrchatPathDiscovery?.available
    ) {
        return false;
    }

    try {
        const refreshed = await refreshHostCapabilities();
        return Boolean(refreshed?.gameLogWatcher?.available);
    } catch (error) {
        console.warn('Failed to refresh GameLog capability:', error);
        return false;
    }
}

async function ingestAndRecordGameLogEvent(
    name: BackendEventName,
    payload: unknown
): Promise<void> {
    if (isBackendPersistedGameLogMirror(payload)) {
        useRuntimeStore.getState().recordBackendEvent(name, payload);
        return;
    }

    if (!(await canIngestGameLogEvent())) {
        return;
    }

    try {
        await ingestBackendGameLogEvent(payload);
        useRuntimeStore.getState().recordBackendEvent(name, payload);
    } catch (error) {
        await showSQLiteErrorDialog(error);
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Game log ingest failed',
            message: error instanceof Error ? error.message : String(error)
        });
    }
}

async function persistAndRecordGameLogFallback(
    name: BackendEventName,
    payload: unknown
): Promise<void> {
    try {
        await persistBackendGameLogFallbackBatch(payload);
        const runtimeStore = useRuntimeStore.getState();
        runtimeStore.recordBackendEvent(name, payload);
        const record = isRecord(payload) ? payload : {};
        const rawRows = Array.isArray(record.rawRows) ? record.rawRows : [];
        if (rawRows.length > 0) {
            for (const raw of rawRows) {
                runtimeStore.recordBackendEvent('addGameLogEvent', {
                    backendPersistenceFallback: true,
                    raw
                });
            }
        } else {
            runtimeStore.recordBackendEvent('addGameLogEvent', {
                backendPersistenceFallback: true,
                payload
            });
        }
    } catch (error) {
        await showSQLiteErrorDialog(error);
        useNotificationStore.getState().pushNotification({
            level: 'warning',
            title: 'Game log fallback failed',
            message: error instanceof Error ? error.message : String(error)
        });
    }
}

function handleBackendEvent(name: BackendEventName, payload: unknown): void {
    const runtimeStore = useRuntimeStore.getState();

    if (name === 'addGameLogEvent') {
        gameLogIngestQueue = gameLogIngestQueue.then(
            () => ingestAndRecordGameLogEvent(name, payload),
            () => ingestAndRecordGameLogEvent(name, payload)
        );
        return;
    }

    if (name === 'gameLogPersistenceFallback') {
        gameLogIngestQueue = gameLogIngestQueue.then(
            () => persistAndRecordGameLogFallback(name, payload),
            () => persistAndRecordGameLogFallback(name, payload)
        );
        return;
    }

    runtimeStore.recordBackendEvent(name, payload);

    if (name === 'gameLogSideEffect') {
        if (!isHostCapabilityAvailable('backendGameLogSideEffects')) {
            return;
        }
        const record = isRecord(payload) ? payload : {};
        const kind = String(record.kind || '');
        const sidePayload = isRecord(record.payload) ? record.payload : {};
        if (kind === 'nowPlaying') {
            runtimeStore.setNowPlayingState(sidePayload);
            publishNowPlayingSharedFeed(sidePayload);
        } else if (kind === 'nowPlayingReset') {
            resetNowPlayingState();
        } else if (kind === 'screenshotProcessed') {
            runtimeStore.setGameState({
                lastScreenshotPath: String(sidePayload.path || '')
            });
        } else if (kind === 'gameNoVR') {
            runtimeStore.setGameState({
                isGameNoVR: Boolean(sidePayload.isGameNoVR)
            });
        } else if (kind === 'notification') {
            useNotificationStore.getState().pushNotification(sidePayload);
        }
        return;
    }

    if (name === 'gameClientEvent') {
        if (!isHostCapabilityAvailable('backendGameClientLifecycle')) {
            return;
        }
        const record = isRecord(payload) ? payload : {};
        const kind = String(record.kind || '');
        const clientPayload = isRecord(record.payload) ? record.payload : {};
        recordBackendGameClientEvent(kind, clientPayload);
        if (kind === 'notification') {
            useNotificationStore.getState().pushNotification(clientPayload);
        }
        return;
    }

    if (name === 'backendWorkerError') {
        console.warn('Backend worker error:', payload);
        return;
    }

    if (name === 'updateIsGameRunning') {
        if (!isHostCapabilityAvailable('gameProcessMonitor')) {
            return;
        }
        handleGameRunningUpdate(payload).catch((error) => {
            useNotificationStore.getState().pushNotification({
                level: 'warning',
                title: 'Game state update failed',
                message: error instanceof Error ? error.message : String(error)
            });
        });
        return;
    }

    if (name === 'ipcEvent') {
        if (!isHostCapabilityAvailable('ipc')) {
            return;
        }
        handleIpcEvent(payload).catch((error) => {
            useNotificationStore.getState().pushNotification({
                level: 'warning',
                title: 'IPC event failed',
                message: error instanceof Error ? error.message : String(error)
            });
        });
        return;
    }

    if (name === 'browserFocus') {
        runtimeStore.setGameState({
            lastBrowserFocusAt: new Date().toISOString()
        });
        handleBrowserFocus().catch((error) => {
            console.warn('Browser focus status refresh failed:', error);
        });
    }
}

export async function bindBackendEvents(): Promise<() => void> {
    const unsubscribers: BackendEventUnsubscribe[] = [];
    const events: BackendEventName[] = [
        'addGameLogEvent',
        'gameLogPersistenceFallback',
        'gameLogSideEffect',
        'gameClientEvent',
        'backendWorkerError',
        'updateIsGameRunning',
        'ipcEvent',
        'browserFocus'
    ];

    useSessionStore.getState().setTransportStatus('backend-subscribing');

    try {
        for (const name of events) {
            const unsubscribe = await backend.events.subscribe(
                name,
                (payload) => {
                    handleBackendEvent(name, payload);
                }
            );
            unsubscribers.push(unsubscribe);
        }
    } catch (error) {
        for (const unsubscribe of unsubscribers) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        useSessionStore.getState().setTransportStatus('disconnected');
        throw error;
    }

    useSessionStore.getState().setTransportStatus('backend-subscribed');

    return () => {
        for (const unsubscribe of unsubscribers) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        useSessionStore.getState().setTransportStatus('disconnected');
    };
}
