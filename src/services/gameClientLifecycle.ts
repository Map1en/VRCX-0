import { backend } from '@/platform/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { isHostCapabilityAvailable } from './hostCapabilityService.js';

type GameClientLifecycleRoutingOptions = {
    backendGameClientLifecycleAvailable: boolean;
    backendCrashRelaunchHandled?: boolean;
};

const BACKEND_CRASH_RELAUNCH_DECISION_MAX_AGE_MS = 30_000;

let lastBackendCrashRelaunchDecision: {
    handled: boolean;
    receivedAt: number;
} | null = null;
let lastRuntimeStateSignature = '';
let crashRelaunchDecisionWaiters: Array<() => void> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isBackendGameClientLifecycleActive(): boolean {
    return isHostCapabilityAvailable('backendGameClientLifecycle');
}

function getBackendCrashRelaunchHandled(): boolean {
    if (!lastBackendCrashRelaunchDecision) {
        return false;
    }
    if (
        Date.now() - lastBackendCrashRelaunchDecision.receivedAt >
        BACKEND_CRASH_RELAUNCH_DECISION_MAX_AGE_MS
    ) {
        lastBackendCrashRelaunchDecision = null;
        return false;
    }
    return lastBackendCrashRelaunchDecision.handled;
}

export function shouldSkipFrontendCrashRelaunch(
    options: GameClientLifecycleRoutingOptions = {
        backendGameClientLifecycleAvailable:
            isBackendGameClientLifecycleActive(),
        backendCrashRelaunchHandled: getBackendCrashRelaunchHandled()
    }
): boolean {
    const backendCrashRelaunchHandled =
        options.backendCrashRelaunchHandled ?? getBackendCrashRelaunchHandled();
    return (
        options.backendGameClientLifecycleAvailable &&
        backendCrashRelaunchHandled === true
    );
}

export function recordBackendGameClientEvent(
    kind: unknown,
    payload: unknown
): void {
    if (kind !== 'crashRelaunchDecision') {
        return;
    }
    const record = isRecord(payload) ? payload : {};
    lastBackendCrashRelaunchDecision = {
        handled: record.handled === true,
        receivedAt: Date.now()
    };
    const waiters = crashRelaunchDecisionWaiters;
    crashRelaunchDecisionWaiters = [];
    for (const resolve of waiters) {
        resolve();
    }
}

export function resetBackendCrashRelaunchDecision(): void {
    lastBackendCrashRelaunchDecision = null;
    crashRelaunchDecisionWaiters = [];
}

export function waitForBackendCrashRelaunchDecision(
    timeoutMs = 250
): Promise<void> {
    if (getBackendCrashRelaunchHandled() || lastBackendCrashRelaunchDecision) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let timer: ReturnType<typeof globalThis.setTimeout>;
        const finish = () => {
            globalThis.clearTimeout(timer);
            resolve();
        };
        timer = globalThis.setTimeout(() => {
            crashRelaunchDecisionWaiters = crashRelaunchDecisionWaiters.filter(
                (entry) => entry !== finish
            );
            resolve();
        }, timeoutMs);
        crashRelaunchDecisionWaiters.push(finish);
    });
}

function getRuntimeLocationMirror(): string {
    const runtimeState = useRuntimeStore.getState();
    return (
        normalizeString(runtimeState.gameState.currentLocation) ||
        normalizeString(runtimeState.auth.currentUserSnapshot?.location)
    );
}

export async function syncBackendGameClientRuntimeState(): Promise<void> {
    if (!isBackendGameClientLifecycleActive()) {
        lastRuntimeStateSignature = '';
        return;
    }

    const sessionActive = useSessionStore.getState().isLoggedIn;
    const currentLocation = getRuntimeLocationMirror();
    const signature = `${sessionActive ? '1' : '0'}\0${currentLocation}`;
    if (signature === lastRuntimeStateSignature) {
        return;
    }
    lastRuntimeStateSignature = signature;

    try {
        await backend.app.SetGameClientRuntimeState(
            sessionActive,
            currentLocation
        );
    } catch (error) {
        lastRuntimeStateSignature = '';
        console.warn('Failed to sync backend game client runtime state:', error);
    }
}

export function startBackendGameClientRuntimeSync(): () => void {
    const sync = () => {
        void syncBackendGameClientRuntimeState();
    };
    const unsubscribeSession = useSessionStore.subscribe(sync);
    const unsubscribeRuntime = useRuntimeStore.subscribe(sync);
    sync();

    return () => {
        unsubscribeSession();
        unsubscribeRuntime();
    };
}
