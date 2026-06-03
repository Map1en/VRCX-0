import {
    TELEMETRY_HEARTBEAT_INTERVAL_MS,
    isTelemetryEnabled
} from './telemetryConfig';
import { postTelemetry } from './telemetryClient';
import {
    buildTelemetryContext,
    waitForInitialTelemetryContext
} from './telemetryPayload';
import {
    createTelemetrySessionId,
    getOrCreateTelemetryInstallId
} from './telemetryIdentity';
import type { TelemetrySessionState } from './telemetryTypes';

let activeSession: TelemetrySessionState | null = null;
let startPromise: Promise<void> | null = null;

function silently(task: Promise<unknown>): void {
    task.catch(() => {});
}

async function sendSessionStart(session: TelemetrySessionState): Promise<void> {
    await postTelemetry(
        '/api/v1/telemetry/session/start',
        buildTelemetryContext(session)
    );
}

async function sendHeartbeat(session: TelemetrySessionState): Promise<void> {
    await postTelemetry(
        '/api/v1/telemetry/session/heartbeat',
        buildTelemetryContext(session)
    );
}

async function sendErrorCode(
    session: TelemetrySessionState,
    errorCode: string
): Promise<void> {
    const normalizedCode = String(errorCode || '').trim();
    if (!normalizedCode) {
        return;
    }
    await postTelemetry('/api/v1/telemetry/event', {
        ...buildTelemetryContext(session),
        eventType: 'error',
        errorCode: normalizedCode
    });
}

async function ensureTelemetrySession(): Promise<TelemetrySessionState | null> {
    if (!isTelemetryEnabled()) {
        return null;
    }
    if (activeSession) {
        return activeSession;
    }

    const installId = await getOrCreateTelemetryInstallId();
    activeSession = {
        installId,
        sessionId: createTelemetrySessionId()
    };
    return activeSession;
}

export function startTelemetryLifecycle(): () => void {
    if (!isTelemetryEnabled()) {
        return () => {};
    }

    let disposed = false;
    let heartbeatTimer: number | null = null;
    let heartbeatInFlight = false;
    const startupAbortController = new AbortController();

    const requestHeartbeat = () => {
        if (!activeSession || heartbeatInFlight) {
            return;
        }
        heartbeatInFlight = true;
        sendHeartbeat(activeSession)
            .catch(() => {})
            .finally(() => {
                heartbeatInFlight = false;
            });
    };

    startPromise = (async () => {
        await waitForInitialTelemetryContext({
            signal: startupAbortController.signal
        });
        if (disposed) {
            return;
        }
        const session = await ensureTelemetrySession();
        if (!session || disposed) {
            return;
        }
        await sendSessionStart(session).catch(() => {});
        if (disposed) {
            return;
        }
        heartbeatTimer = window.setInterval(() => {
            requestHeartbeat();
        }, TELEMETRY_HEARTBEAT_INTERVAL_MS);
    })().catch(() => {});

    return () => {
        disposed = true;
        startupAbortController.abort();
        if (heartbeatTimer !== null) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };
}

export function recordTelemetryErrorCode(errorCode: string): void {
    if (!isTelemetryEnabled()) {
        return;
    }
    const run = async () => {
        if (!activeSession) {
            await startPromise;
        }
        if (activeSession) {
            await sendErrorCode(activeSession, errorCode);
        }
    };
    silently(run());
}
