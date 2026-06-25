import type { Event, UnlistenFn } from '@tauri-apps/api/event';

import { normalizePlatformError } from './errors';

export type TauriEventHandler<TPayload = unknown> = (payload: TPayload) => void;

interface TauriEventRegistration {
    promise: Promise<UnlistenFn>;
    unlisten: UnlistenFn | null;
}

const listeners = new Map<string, Set<TauriEventHandler>>();
const tauriRegistrations = new Map<string, TauriEventRegistration>();

async function loadListen() {
    const event = await import('@tauri-apps/api/event');
    return event.listen;
}

function getBucket(name: string): Set<TauriEventHandler> {
    let bucket = listeners.get(name);
    if (!bucket) {
        bucket = new Set();
        listeners.set(name, bucket);
    }
    return bucket;
}

function dispatch(name: string, payload: unknown): void {
    const bucket = listeners.get(name);
    if (!bucket || bucket.size === 0) {
        return;
    }

    for (const handler of bucket) {
        try {
            handler(payload);
        } catch (error) {
            console.error(`Error in Tauri event handler for ${name}:`, error);
        }
    }
}

async function ensureTauriSubscription(name: string): Promise<UnlistenFn> {
    const existing = tauriRegistrations.get(name);
    if (existing) {
        return existing.promise;
    }

    const bucket: TauriEventRegistration = {
        promise: Promise.resolve(() => undefined),
        unlisten: null
    };
    bucket.promise = (async () => {
        try {
            const listen = await loadListen();
            const unlisten = await listen<unknown>(
                name,
                (event: Event<unknown>) => {
                    dispatch(name, event.payload);
                }
            );
            bucket.unlisten = unlisten;

            if (!listeners.has(name) || listeners.get(name)?.size === 0) {
                try {
                    unlisten();
                } catch {}
                tauriRegistrations.delete(name);
            }

            return unlisten;
        } catch (error) {
            throw normalizePlatformError(
                error,
                `Unable to subscribe to Tauri event: ${name}`
            );
        }
    })();

    tauriRegistrations.set(name, bucket);
    return bucket.promise;
}

export async function onTauriEvent(
    name: string,
    handler: TauriEventHandler
): Promise<() => void> {
    getBucket(name).add(handler);
    await ensureTauriSubscription(name);

    return () => offTauriEvent(name, handler);
}

export async function subscribeTauriEvent<TPayload = unknown>(
    name: string,
    handler: TauriEventHandler<TPayload>
): Promise<() => void> {
    const eventHandler = handler as TauriEventHandler;
    getBucket(name).add(eventHandler);
    await ensureTauriSubscription(name);

    return () => offTauriEvent(name, eventHandler);
}

export function offTauriEvent(name: string, handler: TauriEventHandler): void {
    const bucket = listeners.get(name);
    if (!bucket) {
        return;
    }

    bucket.delete(handler);
    if (bucket.size === 0) {
        listeners.delete(name);
        const registration = tauriRegistrations.get(name);
        if (registration?.unlisten) {
            try {
                registration.unlisten();
            } catch {}
            tauriRegistrations.delete(name);
        }
    }
}

export function emitTauriEvent(name: string, payload?: unknown): void {
    dispatch(name, payload);
}

export function clearTauriEventListeners(name: string | null = null): void {
    if (name === null) {
        for (const registration of tauriRegistrations.values()) {
            if (registration?.unlisten) {
                try {
                    registration.unlisten();
                } catch {}
            }
        }
        listeners.clear();
        tauriRegistrations.clear();
        return;
    }

    listeners.delete(name);
    const registration = tauriRegistrations.get(name);
    if (registration?.unlisten) {
        try {
            registration.unlisten();
        } catch {}
    }
    tauriRegistrations.delete(name);
}

export const tauriEvents = Object.freeze({
    on: onTauriEvent,
    off: offTauriEvent,
    emit: emitTauriEvent,
    clear: clearTauriEventListeners,
    subscribe: subscribeTauriEvent
});
