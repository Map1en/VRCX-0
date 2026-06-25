import { commands } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { isHostCapabilityAvailable } from './hostCapabilityService';

type GameClientLifecycleRoutingOptions = {
    runtimeGameClientLifecycleAvailable: boolean;
    runtimeCrashRelaunchHandled?: boolean;
};

const BACKEND_CRASH_RELAUNCH_DECISION_MAX_AGE_MS = 30_000;

let lastRuntimeCrashRelaunchDecision: {
    handled: boolean;
    receivedAt: number;
} | null = null;
let lastRuntimeStateSignature = '';
let crashRelaunchDecisionWaiters: Array<(received: boolean) => void> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function isRuntimeGameClientLifecycleActive(): boolean {
    return isHostCapabilityAvailable('runtimeGameClientLifecycle');
}

function getRuntimeCrashRelaunchHandled(): boolean {
    if (!lastRuntimeCrashRelaunchDecision) {
        return false;
    }
    if (
        Date.now() - lastRuntimeCrashRelaunchDecision.receivedAt >
        BACKEND_CRASH_RELAUNCH_DECISION_MAX_AGE_MS
    ) {
        lastRuntimeCrashRelaunchDecision = null;
        return false;
    }
    return lastRuntimeCrashRelaunchDecision.handled;
}

export function shouldSkipFrontendCrashRelaunch(
    options: GameClientLifecycleRoutingOptions = {
        runtimeGameClientLifecycleAvailable:
            isRuntimeGameClientLifecycleActive(),
        runtimeCrashRelaunchHandled: getRuntimeCrashRelaunchHandled()
    }
): boolean {
    const runtimeCrashRelaunchHandled =
        options.runtimeCrashRelaunchHandled ?? getRuntimeCrashRelaunchHandled();
    return (
        options.runtimeGameClientLifecycleAvailable &&
        runtimeCrashRelaunchHandled === true
    );
}

export function recordRuntimeGameClientEvent(
    kind: unknown,
    payload: unknown
): void {
    if (kind !== 'crashRelaunchDecision') {
        return;
    }
    const record = isRecord(payload) ? payload : {};
    lastRuntimeCrashRelaunchDecision = {
        handled: record.handled === true,
        receivedAt: Date.now()
    };
    const waiters = crashRelaunchDecisionWaiters;
    crashRelaunchDecisionWaiters = [];
    for (const resolve of waiters) {
        resolve(true);
    }
}

export function resetRuntimeCrashRelaunchDecision(): void {
    lastRuntimeCrashRelaunchDecision = null;
    crashRelaunchDecisionWaiters = [];
}

export function waitForRuntimeCrashRelaunchDecision(
    timeoutMs: number = 2000
): Promise<boolean> {
    if (getRuntimeCrashRelaunchHandled() || lastRuntimeCrashRelaunchDecision) {
        return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof globalThis.setTimeout>;
        const finish = (received: boolean) => {
            globalThis.clearTimeout(timer);
            resolve(received);
        };
        timer = globalThis.setTimeout(() => {
            crashRelaunchDecisionWaiters = crashRelaunchDecisionWaiters.filter(
                (entry) => entry !== finish
            );
            resolve(false);
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

export async function syncRuntimeGameClientState(): Promise<void> {
    if (!isRuntimeGameClientLifecycleActive()) {
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
        await commands.appSetGameClientRuntimeState(
            sessionActive,
            currentLocation
        );
    } catch (error) {
        lastRuntimeStateSignature = '';
        console.warn('Failed to sync game client runtime state:', error);
    }
}

export function startRuntimeGameClientSync(): () => void {
    const sync = () => {
        syncRuntimeGameClientState();
    };
    const unsubscribeSession = useSessionStore.subscribe(sync);
    const unsubscribeRuntime = useRuntimeStore.subscribe(sync);
    sync();

    return () => {
        unsubscribeSession();
        unsubscribeRuntime();
    };
}
