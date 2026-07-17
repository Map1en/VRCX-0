import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FriendProfileLoadStatusPayload } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

const mocks = vi.hoisted(() => ({
    appFriendProfileLoadStart: vi.fn(),
    appFriendProfileLoadCancel: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFriendProfileLoadStart: mocks.appFriendProfileLoadStart,
        appFriendProfileLoadCancel: mocks.appFriendProfileLoadCancel
    }
}));

import {
    applyFriendProfileLoadStatusPayload,
    cancelFriendProfileLoad,
    minimizeFriendProfileLoadDialog,
    openFriendProfileLoadDialog,
    resetFriendProfileLoadService,
    startFriendProfileLoad
} from './friendProfileLoadService';

function runningPayload() {
    return {
        runId: 1,
        status: 'running' as const,
        total: 3,
        processed: 0,
        loaded: 0,
        failed: 0,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        lastError: null
    };
}

function completedPayload(
    overrides: Partial<ReturnType<typeof runningPayload>> = {}
) {
    return {
        ...runningPayload(),
        status: 'completed' as const,
        processed: 3,
        loaded: 3,
        finishedAt: '2026-01-01T00:00:05.000Z',
        ...overrides
    };
}

function deferred<T>() {
    let resolve = (_value: T) => {};
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('friendProfileLoadService', () => {
    beforeEach(() => {
        resetFriendProfileLoadService();
        useRuntimeStore.getState().resetRuntimeState();
        mocks.appFriendProfileLoadStart.mockReset();
        mocks.appFriendProfileLoadCancel.mockReset();
        vi.useRealTimers();
    });

    it('starts a run by calling the backend command and opens the dialog', async () => {
        mocks.appFriendProfileLoadStart.mockResolvedValue(runningPayload());

        await startFriendProfileLoad();

        expect(mocks.appFriendProfileLoadStart).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            runId: 1,
            status: 'running',
            totalFriends: 3,
            processedFriends: 0,
            dialogOpen: true
        });
    });

    it('toasts and stays idle when the backend reports nothing to load', async () => {
        mocks.appFriendProfileLoadStart.mockResolvedValue(
            completedPayload({ total: 0, processed: 0, loaded: 0 })
        );

        await startFriendProfileLoad();

        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'completed',
            totalFriends: 0
        });
    });

    it('cancels a run by calling the backend command', async () => {
        mocks.appFriendProfileLoadStart.mockResolvedValue(runningPayload());
        await startFriendProfileLoad();

        mocks.appFriendProfileLoadCancel.mockResolvedValue({
            ...runningPayload(),
            status: 'cancelling'
        });
        await cancelFriendProfileLoad();

        expect(mocks.appFriendProfileLoadCancel).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'cancelling'
        );
    });

    it('stays cancelling while queued running events arrive', async () => {
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 4,
            loaded: 4
        });
        openFriendProfileLoadDialog();
        const pendingCancel = deferred<FriendProfileLoadStatusPayload>();
        mocks.appFriendProfileLoadCancel.mockReturnValue(pendingCancel.promise);

        const cancelPromise = cancelFriendProfileLoad();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelling',
            processedFriends: 4,
            cancelRequested: true,
            dialogOpen: false
        });

        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 10,
            loaded: 10
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelling',
            processedFriends: 4
        });

        pendingCancel.resolve({
            ...runningPayload(),
            status: 'cancelling',
            processed: 74,
            loaded: 74
        });
        await cancelPromise;
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelling',
            processedFriends: 74
        });
    });

    it('reopens the dialog if the cancel command fails', async () => {
        applyFriendProfileLoadStatusPayload(runningPayload());
        openFriendProfileLoadDialog();
        mocks.appFriendProfileLoadCancel.mockRejectedValue(
            new Error('cancel failed')
        );

        await cancelFriendProfileLoad();

        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            cancelRequested: false,
            dialogOpen: true
        });
    });

    it('does not let queued events revive a terminal run', async () => {
        vi.useFakeTimers();
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 10,
            loaded: 10
        });
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            status: 'cancelled',
            processed: 74,
            loaded: 74,
            finishedAt: '2026-01-01T00:00:05.000Z'
        });
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 31,
            loaded: 31
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelled',
            processedFriends: 74
        });

        await vi.advanceTimersByTimeAsync(5000);
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 40,
            loaded: 40
        });
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'idle'
        );

        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            runId: 2,
            processed: 0,
            loaded: 0
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            runId: 2,
            status: 'running',
            processedFriends: 0
        });
    });

    it('merges a pushed status event without touching dialogOpen', () => {
        openFriendProfileLoadDialog();
        applyFriendProfileLoadStatusPayload(runningPayload());
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            dialogOpen: true
        });

        minimizeFriendProfileLoadDialog();
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 1
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            processedFriends: 1,
            dialogOpen: false
        });
    });

    it('keeps terminal progress for five seconds before resetting', async () => {
        vi.useFakeTimers();
        applyFriendProfileLoadStatusPayload(completedPayload());
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'completed'
        );

        await vi.advanceTimersByTimeAsync(4999);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'completed'
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'idle'
        );
    });

    it('minimize and open toggle dialogOpen without touching progress', () => {
        applyFriendProfileLoadStatusPayload(runningPayload());
        minimizeFriendProfileLoadDialog();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            dialogOpen: false
        });
        openFriendProfileLoadDialog();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            dialogOpen: true
        });
    });
});
