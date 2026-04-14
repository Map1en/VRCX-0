import { normalizePlatformError } from './errors.js';

const listeners = new Map();
const tauriRegistrations = new Map();

async function loadListen() {
    const event = await import('@tauri-apps/api/event');
    return event.listen;
}

function getBucket(name) {
    let bucket = listeners.get(name);
    if (!bucket) {
        bucket = new Set();
        listeners.set(name, bucket);
    }
    return bucket;
}

function dispatch(name, payload) {
    const bucket = listeners.get(name);
    if (!bucket || bucket.size === 0) {
        return;
    }

    for (const handler of bucket) {
        try {
            handler(payload);
        } catch (error) {
            console.error(`Error in backend event handler for ${name}:`, error);
        }
    }
}

async function ensureTauriSubscription(name) {
    const existing = tauriRegistrations.get(name);
    if (existing) {
        return existing.promise;
    }

    const bucket = { promise: null, unlisten: null };
    bucket.promise = (async () => {
        try {
            const listen = await loadListen();
            const unlisten = await listen(name, (event) => {
                dispatch(name, event.payload);
            });
            bucket.unlisten = unlisten;

            if (!listeners.has(name) || listeners.get(name)?.size === 0) {
                try {
                    unlisten();
                } catch {
                    // ignore cleanup errors
                }
                tauriRegistrations.delete(name);
            }

            return unlisten;
        } catch (error) {
            throw normalizePlatformError(error, `Unable to subscribe to backend event: ${name}`);
        }
    })();

    tauriRegistrations.set(name, bucket);
    return bucket.promise;
}

export async function onBackendEvent(name, handler) {
    getBucket(name).add(handler);
    await ensureTauriSubscription(name);

    return () => offBackendEvent(name, handler);
}

export function offBackendEvent(name, handler) {
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
            } catch {
                // ignore cleanup errors
            }
            tauriRegistrations.delete(name);
        }
    }
}

export function emitBackendEvent(name, payload) {
    dispatch(name, payload);
}

export function clearBackendEventListeners(name = null) {
    if (name === null) {
        for (const registration of tauriRegistrations.values()) {
            if (registration?.unlisten) {
                try {
                    registration.unlisten();
                } catch {
                    // ignore cleanup errors
                }
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
        } catch {
            // ignore cleanup errors
        }
    }
    tauriRegistrations.delete(name);
}

export const backendEvents = Object.freeze({
    on: onBackendEvent,
    off: offBackendEvent,
    emit: emitBackendEvent,
    clear: clearBackendEventListeners,
    subscribe: onBackendEvent
});
