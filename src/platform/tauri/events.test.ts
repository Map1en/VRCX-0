import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    listen: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen
}));

import { clearTauriEventListeners, onTauriEvent } from './events';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

describe('tauri events', () => {
    beforeEach(() => {
        clearTauriEventListeners();
        mocks.listen.mockReset();
    });

    afterEach(() => {
        clearTauriEventListeners();
        vi.restoreAllMocks();
    });

    it('shares a Tauri listener until the last handler leaves', async () => {
        const unlisten = vi.fn();
        mocks.listen.mockResolvedValue(unlisten);
        const firstHandler = vi.fn();
        const secondHandler = vi.fn();

        const [offFirst, offSecond] = await Promise.all([
            onTauriEvent('shared-event', firstHandler),
            onTauriEvent('shared-event', secondHandler)
        ]);

        expect(mocks.listen).toHaveBeenCalledTimes(1);
        const dispatch = mocks.listen.mock.calls[0]?.[1];
        dispatch({ payload: { value: 1 } });
        expect(firstHandler).toHaveBeenCalledWith({ value: 1 });
        expect(secondHandler).toHaveBeenCalledWith({ value: 1 });

        offFirst();
        expect(unlisten).not.toHaveBeenCalled();

        offSecond();
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('allows a subscription to retry after listen rejects', async () => {
        const unlisten = vi.fn();
        mocks.listen
            .mockRejectedValueOnce(new Error('listen failed'))
            .mockResolvedValueOnce(unlisten);

        await expect(onTauriEvent('retry-event', vi.fn())).rejects.toThrow(
            'listen failed'
        );

        const off = await onTauriEvent('retry-event', vi.fn());

        expect(mocks.listen).toHaveBeenCalledTimes(2);
        off();
    });

    it('does not retain a pending listener after clear and resubscribe', async () => {
        const firstListen = deferred<() => void>();
        const secondListen = deferred<() => void>();
        const firstUnlisten = vi.fn();
        const secondUnlisten = vi.fn();
        mocks.listen
            .mockReturnValueOnce(firstListen.promise)
            .mockReturnValueOnce(secondListen.promise);
        const handler = vi.fn();

        const staleSubscription = onTauriEvent('pending-event', handler);
        await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(1));
        clearTauriEventListeners('pending-event');
        const currentSubscription = onTauriEvent('pending-event', handler);
        await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));

        firstListen.resolve(firstUnlisten);
        secondListen.resolve(secondUnlisten);
        const [offStale] = await Promise.all([
            staleSubscription,
            currentSubscription
        ]);
        offStale();

        expect(firstUnlisten).toHaveBeenCalledTimes(1);
        const staleDispatch = mocks.listen.mock.calls[0]?.[1];
        const currentDispatch = mocks.listen.mock.calls[1]?.[1];
        staleDispatch({ payload: 'stale' });
        currentDispatch({ payload: 'current' });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('current');
    });

    it('does not remove a replacement handler when a cleared listener rejects', async () => {
        const firstListen = deferred<() => void>();
        const secondListen = deferred<() => void>();
        const handler = vi.fn();
        mocks.listen
            .mockReturnValueOnce(firstListen.promise)
            .mockReturnValueOnce(secondListen.promise);

        const staleSubscription = onTauriEvent('rejected-event', handler);
        await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(1));
        clearTauriEventListeners('rejected-event');
        const currentSubscription = onTauriEvent('rejected-event', handler);
        await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));

        secondListen.resolve(vi.fn());
        await currentSubscription;
        firstListen.reject(new Error('stale listen failed'));
        await expect(staleSubscription).rejects.toThrow('stale listen failed');

        const currentDispatch = mocks.listen.mock.calls[1]?.[1];
        currentDispatch({ payload: 'current' });
        expect(handler).toHaveBeenCalledWith('current');
    });

    it('continues dispatching when one handler throws', async () => {
        const error = new Error('handler failed');
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        mocks.listen.mockResolvedValue(vi.fn());
        const healthyHandler = vi.fn();

        await onTauriEvent('dispatch-event', () => {
            throw error;
        });
        await onTauriEvent('dispatch-event', healthyHandler);

        const dispatch = mocks.listen.mock.calls[0]?.[1];
        dispatch({ payload: 'payload' });

        expect(healthyHandler).toHaveBeenCalledWith('payload');
        expect(consoleError).toHaveBeenCalledWith(
            'Error in Tauri event handler for dispatch-event:',
            error
        );
    });
});
