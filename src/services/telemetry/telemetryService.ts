import configRepository from '@/repositories/configRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    resetAssistantHealth,
    sendAssistantHealth
} from './telemetryAssistantHealth';
import {
    resetAssistantUsage,
    sendAssistantUsage
} from './telemetryAssistantUsage';
import { postTelemetry } from './telemetryClient';
import {
    TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY,
    TELEMETRY_HEARTBEAT_INTERVAL_MS,
    isAnonymousUsageTelemetryEnabled,
    isTelemetryEnabled
} from './telemetryConfig';
import { sendConfigSnapshot } from './telemetryConfigSnapshot';
import {
    createTelemetrySessionId,
    getOrCreateTelemetryInstallIdentity
} from './telemetryIdentity';
import { resetPageReach, sendPageReach } from './telemetryPageReach';
import {
    buildBasicTelemetryContext,
    buildTelemetryContext,
    waitForInitialTelemetryContext
} from './telemetryPayload';
import {
    resetRustErrors,
    seedRustErrors,
    sendRustErrors
} from './telemetryRustErrors';
import type {
    TelemetrySessionState,
    TelemetryVrchatLifecycleState
} from './telemetryTypes';
import {
    resetViewModeUsage,
    seedViewModeUsage,
    sendViewModeUsage
} from './telemetryViewModeUsage';

type HeartbeatCollector = {
    seed?: () => Promise<void>;
    flush: (session: TelemetrySessionState) => Promise<void>;
    reset: () => void;
};

const HEARTBEAT_COLLECTORS: HeartbeatCollector[] = [
    {
        seed: seedViewModeUsage,
        flush: sendViewModeUsage,
        reset: resetViewModeUsage
    },
    {
        flush: sendPageReach,
        reset: resetPageReach
    },
    {
        flush: sendAssistantHealth,
        reset: resetAssistantHealth
    },
    {
        flush: sendAssistantUsage,
        reset: resetAssistantUsage
    },
    {
        seed: seedRustErrors,
        flush: sendRustErrors,
        reset: resetRustErrors
    }
];

let activeSession: TelemetrySessionState | null = null;

function silently(task: Promise<unknown>): void {
    task.catch(() => {});
}

async function seedHeartbeatCollectors(): Promise<void> {
    const seedTasks: Promise<void>[] = [];
    for (const collector of HEARTBEAT_COLLECTORS) {
        if (collector.seed) {
            seedTasks.push(collector.seed());
        }
    }
    await Promise.all(seedTasks);
}

function flushHeartbeatCollectors(session: TelemetrySessionState): void {
    HEARTBEAT_COLLECTORS.forEach((collector) =>
        silently(collector.flush(session))
    );
}

function resetHeartbeatCollectors(): void {
    HEARTBEAT_COLLECTORS.forEach((collector) => collector.reset());
}

async function sendSessionStart(session: TelemetrySessionState): Promise<void> {
    const usageTelemetryEnabled = isAnonymousUsageTelemetryEnabled();
    if (
        !usageTelemetryEnabled &&
        !(await shouldReportBasicSessionStart(session))
    ) {
        return;
    }
    await postTelemetry(
        '/api/v1/telemetry/session/start',
        usageTelemetryEnabled
            ? buildTelemetryContext(session)
            : buildBasicTelemetryContext(session)
    );
    await markBasicTelemetryVersionReported();
}

function currentTelemetryVersion(): string {
    return typeof VERSION === 'string' && VERSION ? VERSION : 'unknown';
}

async function shouldReportBasicSessionStart(
    session: TelemetrySessionState
): Promise<boolean> {
    if (session.isNewInstall) {
        return true;
    }
    const reportedVersion = await configRepository.getString(
        TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY,
        ''
    );
    return reportedVersion !== currentTelemetryVersion();
}

async function markBasicTelemetryVersionReported(): Promise<void> {
    await configRepository.setString(
        TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY,
        currentTelemetryVersion()
    );
}

async function sendHeartbeat(session: TelemetrySessionState): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    await postTelemetry(
        '/api/v1/telemetry/session/heartbeat',
        buildTelemetryContext(session)
    );
}

async function sendSessionEndHeartbeat(
    session: TelemetrySessionState
): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    await postTelemetry('/api/v1/telemetry/session/heartbeat', {
        ...buildTelemetryContext(session),
        sessionEnded: true
    });
}

async function sendVrchatLifecycle(
    session: TelemetrySessionState,
    state: TelemetryVrchatLifecycleState
): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    await postTelemetry('/api/v1/telemetry/vrchat', {
        ...buildTelemetryContext(session),
        vrchatRunning: state === 'started',
        state
    });
}

async function ensureTelemetrySession(): Promise<TelemetrySessionState | null> {
    if (!isTelemetryEnabled()) {
        return null;
    }
    if (activeSession) {
        return activeSession;
    }

    const identity = await getOrCreateTelemetryInstallIdentity();
    activeSession = {
        installId: identity.installId,
        sessionId: createTelemetrySessionId(),
        isNewInstall: identity.isNewInstall
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
    let runtimeUnsubscribe: (() => void) | null = null;
    let lastVrchatRunning: boolean | null = null;
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

    const requestVrchatLifecycle = (
        nextVrchatRunning: boolean,
        options: { force?: boolean } = {}
    ) => {
        if (!activeSession) {
            return;
        }
        if (!options.force && lastVrchatRunning === nextVrchatRunning) {
            return;
        }
        lastVrchatRunning = nextVrchatRunning;
        silently(
            sendVrchatLifecycle(
                activeSession,
                nextVrchatRunning ? 'started' : 'stopped'
            )
        );
    };

    void (async () => {
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
        await seedHeartbeatCollectors().catch(() => {});
        silently(sendConfigSnapshot(session));
        const initialVrchatRunning =
            buildTelemetryContext(session).vrchatRunning;
        lastVrchatRunning = initialVrchatRunning;
        if (initialVrchatRunning && isAnonymousUsageTelemetryEnabled()) {
            requestVrchatLifecycle(true, { force: true });
        }
        runtimeUnsubscribe = useRuntimeStore.subscribe(
            (state, previousState) => {
                const nextVrchatRunning =
                    state.gameState.isGameRunning === true;
                const previousVrchatRunning =
                    previousState?.gameState?.isGameRunning === true;
                if (nextVrchatRunning !== previousVrchatRunning) {
                    requestVrchatLifecycle(nextVrchatRunning);
                }
            }
        );
        heartbeatTimer = window.setInterval(() => {
            requestHeartbeat();
            if (activeSession) {
                flushHeartbeatCollectors(activeSession);
            }
        }, TELEMETRY_HEARTBEAT_INTERVAL_MS);
    })().catch(() => {});

    return () => {
        disposed = true;
        startupAbortController.abort();
        if (heartbeatTimer !== null) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (runtimeUnsubscribe) {
            runtimeUnsubscribe();
            runtimeUnsubscribe = null;
        }
        if (activeSession) {
            silently(sendSessionEndHeartbeat(activeSession));
            flushHeartbeatCollectors(activeSession);
        }
        if (lastVrchatRunning === true && activeSession) {
            requestVrchatLifecycle(false, { force: true });
        }
        resetHeartbeatCollectors();
    };
}
