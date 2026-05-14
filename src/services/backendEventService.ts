import { backend } from '@/platform/index.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { ingestBackendGameLogEvent } from './gameLogIngestService.js';
import { handleGameRunningUpdate } from './gameStateService.js';
import {
    isHostCapabilityAvailable,
    refreshHostCapabilities
} from './hostCapabilityService.js';
import { handleIpcEvent } from './ipcEventService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';
import { handleBrowserFocus } from './vrcStatusService.js';

type BackendEventName =
    | 'addGameLogEvent'
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

function handleBackendEvent(name: BackendEventName, payload: unknown): void {
    const runtimeStore = useRuntimeStore.getState();

    if (name === 'addGameLogEvent') {
        gameLogIngestQueue = gameLogIngestQueue.then(
            () => ingestAndRecordGameLogEvent(name, payload),
            () => ingestAndRecordGameLogEvent(name, payload)
        );
        return;
    }

    runtimeStore.recordBackendEvent(name, payload);

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
