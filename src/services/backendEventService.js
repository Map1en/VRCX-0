import { backend } from '@/platform/index.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { ingestBackendGameLogEvent } from './gameLogIngestService.js';
import { handleGameRunningUpdate } from './gameStateService.js';
import { handleIpcEvent } from './ipcEventService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';
import { handleBrowserFocus } from './vrcStatusService.js';

function handleBackendEvent(name, payload) {
    const runtimeStore = useRuntimeStore.getState();

    runtimeStore.recordBackendEvent(name, payload);

    if (name === 'addGameLogEvent') {
        ingestBackendGameLogEvent(payload).catch(async (error) => {
            await showSQLiteErrorDialog(error);
            useNotificationStore.getState().pushNotification({
                level: 'warning',
                title: 'Game log ingest failed',
                message: error instanceof Error ? error.message : String(error)
            });
        });
        return;
    }

    if (name === 'updateIsGameRunning') {
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

export async function bindBackendEvents() {
    const unsubscribers = [];
    const events = [
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
