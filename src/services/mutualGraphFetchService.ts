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

let resetTimer: number | null = null;
let latestAcceptedRunId = 0;
let latestAcceptedRevision = 0;
const sessionStartedRunIds = new Set<number>();

function normalizeString(value: unknown) {
    return typeof value === 'string' ? value : String(value ?? '');
}

function normalizeStatus(
    status: Partial<MutualGraphFetchStatus> | null | undefined
) {
    return {
        runId: normalizeNumber(status?.runId),
        revision: normalizeNumber(status?.revision),
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

function isNewerStatus(runId: number, revision: number): boolean {
    return (
        runId > latestAcceptedRunId ||
        (runId === latestAcceptedRunId && revision > latestAcceptedRevision)
    );
}

function clearResetTimer() {
    if (resetTimer !== null) {
        window.clearTimeout(resetTimer);
        resetTimer = null;
    }
}

function scheduleTerminalReset() {
    clearResetTimer();
    resetTimer = window.setTimeout(() => {
        resetTimer = null;
        useRuntimeStore.getState().resetMutualGraphState();
    }, TERMINAL_RESET_DELAY_MS);
}

function applyMutualGraphFetchStatus(
    status: Partial<MutualGraphFetchStatus> | null | undefined
) {
    const normalized = normalizeStatus(status);
    if (!isNewerStatus(normalized.runId, normalized.revision)) {
        return normalized;
    }
    latestAcceptedRunId = normalized.runId;
    latestAcceptedRevision = normalized.revision;
    useRuntimeStore.getState().setMutualGraphState(normalized);
    if (ACTIVE_STATUSES.has(normalized.status)) {
        clearResetTimer();
    } else if (TERMINAL_STATUSES.has(normalized.status)) {
        scheduleTerminalReset();
    }
    return normalized;
}

export function handleMutualGraphFetchStatusEvent(
    status: Partial<MutualGraphFetchStatus> | null | undefined
) {
    return applyMutualGraphFetchStatus(status);
}

export async function refreshMutualGraphFetchStatus() {
    const status = await commands.appMutualGraphFetchStatusGet();
    return applyMutualGraphFetchStatus(status);
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
    const runId = normalizeNumber(status.runId);
    if (runId) {
        sessionStartedRunIds.add(runId);
    }
    return applyMutualGraphFetchStatus(status);
}

export async function cancelMutualGraphFetch(ownerUserId: string) {
    const status = await commands.appMutualGraphFetchCancel({
        ownerUserId
    });
    return applyMutualGraphFetchStatus(status);
}

export function wasMutualGraphFetchStartedInThisSession(runId: number) {
    return sessionStartedRunIds.has(runId);
}
