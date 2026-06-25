import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

import type {
    TelemetryContextPayload,
    TelemetryRuntimeMode,
    TelemetrySessionState
} from './telemetryTypes';

function normalizeRuntimeMode(value: unknown): TelemetryRuntimeMode {
    if (value === 'background' || value === 'headless') {
        return value;
    }
    return 'foreground';
}

function resolveTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    } catch {
        return 'unknown';
    }
}

export function getCurrentTelemetryMode(): TelemetryRuntimeMode {
    return normalizeRuntimeMode(
        useRuntimeStore.getState().backendRuntime?.mode
    );
}

export function buildTelemetryContext(
    session: TelemetrySessionState
): TelemetryContextPayload {
    const runtimeState = useRuntimeStore.getState();
    const shellState = useShellStore.getState();
    const now = new Date();

    return {
        installId: session.installId,
        sessionId: session.sessionId,
        appVersion: VERSION || 'unknown',
        platform: runtimeState.hostCapabilities.platform || 'unknown',
        arch: runtimeState.hostCapabilities.arch || 'unknown',
        locale: shellState.locale || navigator.language || 'unknown',
        timezone: resolveTimezone(),
        mode: getCurrentTelemetryMode(),
        vrchatRunning: runtimeState.gameState.isGameRunning === true,
        localWeekday: now.getDay(),
        localHour: now.getHours()
    };
}

export function buildBasicTelemetryContext(
    session: TelemetrySessionState
): TelemetryContextPayload {
    return {
        ...buildTelemetryContext(session),
        mode: 'foreground',
        vrchatRunning: false
    };
}

type WaitForTelemetryContextOptions = {
    timeoutMs?: number;
    signal?: AbortSignal;
};

export function waitForInitialTelemetryContext(
    options: WaitForTelemetryContextOptions | number = {}
): Promise<void> {
    const timeoutMs =
        typeof options === 'number' ? options : (options.timeoutMs ?? 5000);
    const signal = typeof options === 'number' ? undefined : options.signal;

    if (useRuntimeStore.getState().hostCapabilities.platform !== 'unknown') {
        return Promise.resolve();
    }
    if (signal?.aborted) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let done = false;
        let unsubscribe = () => {};
        let timer = 0;
        const finish = () => {
            if (done) {
                return;
            }
            done = true;
            unsubscribe();
            window.clearTimeout(timer);
            signal?.removeEventListener('abort', finish);
            resolve();
        };
        signal?.addEventListener('abort', finish, { once: true });
        unsubscribe = useRuntimeStore.subscribe((state: any) => {
            if (state.hostCapabilities.platform !== 'unknown') {
                finish();
            }
        });
        timer = window.setTimeout(finish, timeoutMs);
    });
}
