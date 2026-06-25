import { commands } from '@/platform/tauri/bindings';
import type { MutualGraphFetchStatus } from '@/platform/tauri/bindings';
import { normalizeNumber } from '@/shared/utils/coerce';
import { useRuntimeStore } from '@/state/runtimeStore';

type StartMutualGraphFetchInput = {
    ownerUserId: string;
    endpoint?: string;
    friendIds: string[];
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'error']);
const ACTIVE_STATUSES = new Set(['running', 'cancelling']);
const TERMINAL_RESET_DELAY_MS = 5000;

let pollTimer: number | null = null;
let resetTimer: number | null = null;
const sessionStartedRunIds = new Set<number>();

function normalizeString(value: unknown) {
    return typeof value === 'string' ? value : String(value ?? '');
}

function normalizeStatus(
    status: Partial<MutualGraphFetchStatus> | null | undefined
) {
    return {
        runId: normalizeNumber(status?.runId),
        status: normalizeString(status?.status || 'idle'),
        ownerUserId: normalizeString(status?.ownerUserId),
        totalFriends: normalizeNumber(status?.totalFriends),
        processedFriends: normalizeNumber(status?.processedFriends),
        currentFriendId: normalizeString(status?.currentFriendId),
        fetchedFriends: normalizeNumber(status?.fetchedFriends),
        optedOutFriends: normalizeNumber(status?.optedOutFriends),
        failedFriends: normalizeNumber(status?.failedFriends),
        cancelRequested: Boolean(status?.cancelRequested),
        startedAt: status?.startedAt || null,
        updatedAt: status?.updatedAt || null,
        finishedAt: status?.finishedAt || null,
        lastError: status?.lastError || null
    };
}

function clearResetTimer() {
    if (resetTimer !== null) {
        window.clearTimeout(resetTimer);
        resetTimer = null;
    }
}

function stopMutualGraphFetchStatusPolling() {
    if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
    }
}

function scheduleTerminalReset() {
    clearResetTimer();
    resetTimer = window.setTimeout(() => {
        resetTimer = null;
        useRuntimeStore.getState().resetMutualGraphState();
    }, TERMINAL_RESET_DELAY_MS);
}

function applyStatus(
    status: Partial<MutualGraphFetchStatus> | null | undefined
) {
    const normalized = normalizeStatus(status);
    useRuntimeStore.getState().setMutualGraphState(normalized);
    if (ACTIVE_STATUSES.has(normalized.status)) {
        clearResetTimer();
        startMutualGraphFetchStatusPolling();
    } else {
        stopMutualGraphFetchStatusPolling();
        if (TERMINAL_STATUSES.has(normalized.status)) {
            scheduleTerminalReset();
        }
    }
    return normalized;
}

export async function refreshMutualGraphFetchStatus() {
    const status = await commands.appMutualGraphFetchStatusGet();
    return applyStatus(status);
}

export function startMutualGraphFetchStatusPolling() {
    if (pollTimer !== null) {
        return;
    }
    pollTimer = window.setInterval(() => {
        refreshMutualGraphFetchStatus().catch((error: unknown) => {
            useRuntimeStore.getState().setMutualGraphState({
                status: 'error',
                lastError:
                    error instanceof Error
                        ? error.message
                        : 'Failed to read mutual graph fetch status.'
            });
            stopMutualGraphFetchStatusPolling();
            scheduleTerminalReset();
        });
    }, 1000);
}

export async function startMutualGraphFetch({
    ownerUserId,
    endpoint = '',
    friendIds
}: StartMutualGraphFetchInput) {
    const status = await commands.appMutualGraphFetchStart({
        ownerUserId,
        endpoint,
        friendIds
    });
    const normalized = applyStatus(status);
    if (normalized.runId) {
        sessionStartedRunIds.add(normalized.runId);
    }
    return normalized;
}

export async function cancelMutualGraphFetch(ownerUserId: string) {
    const status = await commands.appMutualGraphFetchCancel({
        ownerUserId
    });
    return applyStatus(status);
}

export function wasMutualGraphFetchStartedInThisSession(runId: number) {
    return sessionStartedRunIds.has(runId);
}
