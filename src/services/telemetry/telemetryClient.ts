import {
    TELEMETRY_REQUEST_TIMEOUT_MS,
    getTelemetryEndpoint
} from './telemetryConfig';

export async function postTelemetry(
    path: string,
    payload: unknown
): Promise<void> {
    const endpoint = getTelemetryEndpoint();
    if (!endpoint) {
        return;
    }

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
        controller.abort();
    }, TELEMETRY_REQUEST_TIMEOUT_MS);

    try {
        await fetch(`${endpoint}${path}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(payload),
            keepalive: true,
            signal: controller.signal
        });
    } finally {
        globalThis.clearTimeout(timeout);
    }
}
