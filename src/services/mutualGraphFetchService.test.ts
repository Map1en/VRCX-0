// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cancel: vi.fn(),
    start: vi.fn(),
    statusGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appMutualGraphFetchCancel: mocks.cancel,
        appMutualGraphFetchStart: mocks.start,
        appMutualGraphFetchStatusGet: mocks.statusGet
    }
}));

import type { MutualGraphFetchStatus } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    handleMutualGraphFetchStatusEvent,
    refreshMutualGraphFetchStatus,
    startMutualGraphFetch,
    wasMutualGraphFetchStartedInThisSession
} from './mutualGraphFetchService';

function status(
    runId: number,
    state: MutualGraphFetchStatus['status'],
    revision: number,
    processedFriends = 0
): MutualGraphFetchStatus {
    return {
        runId,
        revision,
        status: state,
        ownerUserId: 'usr_owner',
        totalFriends: 2,
        processedFriends,
        currentFriendId: '',
        fetchedFriends: processedFriends,
        optedOutFriends: 0,
        failedFriends: 0,
        cancelRequested: state === 'cancelling',
        startedAt: '2026-07-31T00:00:00Z',
        updatedAt: '2026-07-31T00:00:01Z',
        finishedAt: state === 'completed' ? '2026-07-31T00:00:02Z' : null,
        lastError: null
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('mutualGraphFetchService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('applies event progress and preserves the terminal reset delay', () => {
        handleMutualGraphFetchStatusEvent(status(21, 'running', 2, 1));
        expect(useRuntimeStore.getState().mutualGraph).toMatchObject({
            runId: 21,
            revision: 2,
            status: 'running',
            processedFriends: 1
        });

        handleMutualGraphFetchStatusEvent(status(21, 'completed', 3, 2));
        expect(useRuntimeStore.getState().mutualGraph.status).toBe('completed');

        vi.advanceTimersByTime(4999);
        expect(useRuntimeStore.getState().mutualGraph.status).toBe('completed');
        vi.advanceTimersByTime(1);
        expect(useRuntimeStore.getState().mutualGraph.status).toBe('idle');
    });

    it('keeps session-started run tracking when command results are applied', async () => {
        mocks.start.mockResolvedValue(status(22, 'running', 1));

        await startMutualGraphFetch({
            ownerUserId: 'usr_owner',
            friendIds: ['usr_friend']
        });

        expect(wasMutualGraphFetchStartedInThisSession(22)).toBe(true);
        expect(useRuntimeStore.getState().mutualGraph.status).toBe('running');
    });

    it('rejects a lower revision delivered after a terminal event', () => {
        handleMutualGraphFetchStatusEvent(status(23, 'completed', 4, 2));
        handleMutualGraphFetchStatusEvent(status(23, 'cancelling', 3, 1));

        expect(useRuntimeStore.getState().mutualGraph).toMatchObject({
            runId: 23,
            revision: 4,
            status: 'completed',
            processedFriends: 2
        });
    });

    it('does not apply an old command response after a newer event', async () => {
        const hydration = deferred<MutualGraphFetchStatus>();
        mocks.statusGet.mockReturnValue(hydration.promise);

        const pending = refreshMutualGraphFetchStatus();
        handleMutualGraphFetchStatusEvent(status(24, 'completed', 3, 2));
        hydration.resolve(status(24, 'running', 1));
        await pending;

        expect(useRuntimeStore.getState().mutualGraph).toMatchObject({
            runId: 24,
            revision: 3,
            status: 'completed',
            processedFriends: 2
        });
    });

    it('accepts a newer run even when its revision restarts at one', () => {
        handleMutualGraphFetchStatusEvent(status(25, 'completed', 9, 2));
        handleMutualGraphFetchStatusEvent(status(26, 'running', 1));

        expect(useRuntimeStore.getState().mutualGraph).toMatchObject({
            runId: 26,
            revision: 1,
            status: 'running'
        });
    });
});
