import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import type { FriendProfileLoadStatusPayload } from '@/platform/tauri/bindings';
import {
    type FriendProfileLoadState,
    useRuntimeStore
} from '@/state/runtimeStore';

import i18n from './i18nService';

const TERMINAL_RESET_DELAY_MS = 5000;
const TERMINAL_STATUSES = new Set<FriendProfileLoadState['status']>([
    'completed',
    'cancelled',
    'error'
]);
const STATUS_PHASE: Record<FriendProfileLoadState['status'], number> = {
    idle: 0,
    running: 1,
    cancelling: 2,
    completed: 3,
    cancelled: 3,
    error: 3
};

let resetTimer: ReturnType<typeof setTimeout> | null = null;
let latestRunId = 0;
let latestStatus: FriendProfileLoadState['status'] = 'idle';

function clearResetTimer(): void {
    if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
}

function scheduleTerminalReset(runId: number): void {
    clearResetTimer();
    resetTimer = setTimeout(() => {
        resetTimer = null;
        const runtime = useRuntimeStore.getState();
        if (runtime.friendProfileLoad.runId === runId) {
            runtime.resetFriendProfileLoadState();
        }
    }, TERMINAL_RESET_DELAY_MS);
}

export function isFriendProfileLoadTerminalStatus(
    status: FriendProfileLoadState['status']
): boolean {
    return TERMINAL_STATUSES.has(status);
}

function toFriendProfileLoadPatch(
    payload: FriendProfileLoadStatusPayload,
    current: FriendProfileLoadState
): Partial<FriendProfileLoadState> {
    const sameRun = current.runId === payload.runId;
    return {
        runId: payload.runId,
        status: payload.status,
        totalFriends: payload.total,
        processedFriends: sameRun
            ? Math.max(current.processedFriends, payload.processed)
            : payload.processed,
        loadedFriends: sameRun
            ? Math.max(current.loadedFriends, payload.loaded)
            : payload.loaded,
        failedFriends: sameRun
            ? Math.max(current.failedFriends, payload.failed)
            : payload.failed,
        cancelRequested: payload.status === 'cancelling',
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt ?? null,
        lastError: payload.lastError ?? null
    };
}

function shouldApplyFriendProfileLoadStatusPayload(
    payload: FriendProfileLoadStatusPayload
): boolean {
    if (payload.runId < latestRunId) {
        return false;
    }
    if (payload.runId > latestRunId) {
        return true;
    }
    if (isFriendProfileLoadTerminalStatus(latestStatus)) {
        return false;
    }
    return STATUS_PHASE[payload.status] >= STATUS_PHASE[latestStatus];
}

export function applyFriendProfileLoadStatusPayload(
    payload: FriendProfileLoadStatusPayload
): void {
    if (!shouldApplyFriendProfileLoadStatusPayload(payload)) {
        return;
    }
    clearResetTimer();
    const runtime = useRuntimeStore.getState();
    latestRunId = payload.runId;
    latestStatus = payload.status;
    runtime.setFriendProfileLoadState(
        toFriendProfileLoadPatch(payload, runtime.friendProfileLoad)
    );
    if (isFriendProfileLoadTerminalStatus(payload.status)) {
        scheduleTerminalReset(payload.runId);
    }
}

export async function startFriendProfileLoad(): Promise<void> {
    clearResetTimer();
    useRuntimeStore.getState().setFriendProfileLoadState({ dialogOpen: true });
    const payload = await commands.appFriendProfileLoadStart();
    applyFriendProfileLoadStatusPayload(payload);
    if (
        payload.status === 'completed' &&
        payload.processed === payload.total &&
        payload.loaded === 0 &&
        payload.failed === 0
    ) {
        toast.success(
            i18n.t('view.friend_list.label.friend_details_are_already_loaded')
        );
    }
}

export async function cancelFriendProfileLoad(): Promise<void> {
    const current = useRuntimeStore.getState().friendProfileLoad;
    if (current.status !== 'running') {
        return;
    }
    latestRunId = current.runId;
    latestStatus = 'cancelling';
    useRuntimeStore.getState().setFriendProfileLoadState({
        status: 'cancelling',
        cancelRequested: true,
        dialogOpen: false
    });
    try {
        const payload = await commands.appFriendProfileLoadCancel();
        applyFriendProfileLoadStatusPayload(payload);
    } catch {
        const latest = useRuntimeStore.getState().friendProfileLoad;
        if (latest.runId === current.runId && latest.status === 'cancelling') {
            latestStatus = 'running';
            useRuntimeStore.getState().setFriendProfileLoadState({
                status: 'running',
                cancelRequested: false,
                dialogOpen: true
            });
        }
    }
}

export function minimizeFriendProfileLoadDialog(): void {
    useRuntimeStore.getState().setFriendProfileLoadState({ dialogOpen: false });
}

export function openFriendProfileLoadDialog(): void {
    useRuntimeStore.getState().setFriendProfileLoadState({ dialogOpen: true });
}

export function resetFriendProfileLoadService(): void {
    clearResetTimer();
    latestRunId = 0;
    latestStatus = 'idle';
    useRuntimeStore.getState().resetFriendProfileLoadState();
}
