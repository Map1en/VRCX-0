import { act } from '@testing-library/react';
import type { Mock } from 'vitest';

import { useFeedLiveStore } from '@/state/feedLiveStore';

import type { FeedRow } from './feedTypes';

export type MergeArgs = {
    rows: FeedRow[];
    minLiveSequence: number;
    maxRows?: number;
};

export type Deferred<T> = {
    promise: Promise<T>;
    resolve(value: T): void;
};

export function createDeferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

export async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

export function mergeCallArgsOf(mergeLiveRows: Mock): MergeArgs[] {
    return mergeLiveRows.mock.calls.map(
        (call: unknown[]) => call[0] as MergeArgs
    );
}

export function pushLiveEntry(id: string): void {
    act(() => {
        useFeedLiveStore.getState().pushEntry({ id, type: 'Online' });
    });
}
