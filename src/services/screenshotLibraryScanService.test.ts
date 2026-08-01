import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getScreenshotLibraryStatus: vi.fn(),
    startScreenshotLibraryScan: vi.fn()
}));

vi.mock('@/repositories/mediaRepository', () => ({
    default: {
        getScreenshotLibraryStatus: mocks.getScreenshotLibraryStatus,
        startScreenshotLibraryScan: mocks.startScreenshotLibraryScan
    }
}));

import type { ScreenshotLibraryScanStatus } from '@/platform/tauri/bindings';

import {
    getCurrentScreenshotLibraryScanStatus,
    handleScreenshotLibraryScanStatusEvent,
    startScreenshotLibraryScan,
    subscribeScreenshotLibraryScanStatus
} from './screenshotLibraryScanService';

function status(running: boolean, scanned = 0): ScreenshotLibraryScanStatus {
    return {
        running,
        scanned,
        indexed: 0,
        changed: 0,
        skipped: 0,
        deleted: 0,
        error: null,
        lastScanAt: running ? null : '2026-07-31T00:00:00Z'
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('screenshotLibraryScanService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fans out runtime status until the subscriber unsubscribes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeScreenshotLibraryScanStatus(listener);

        handleScreenshotLibraryScanStatusEvent(status(true));
        unsubscribe();
        handleScreenshotLibraryScanStatusEvent(status(false, 1));

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(status(true));
    });

    it('hydrates and starts through the same status distribution seam', async () => {
        const listener = vi.fn();
        const unsubscribe = subscribeScreenshotLibraryScanStatus(listener);
        mocks.getScreenshotLibraryStatus.mockResolvedValue(status(true));
        mocks.startScreenshotLibraryScan.mockResolvedValue(status(false, 2));

        await expect(getCurrentScreenshotLibraryScanStatus()).resolves.toEqual(
            status(true)
        );
        await expect(startScreenshotLibraryScan(true)).resolves.toEqual(
            status(false, 2)
        );

        expect(mocks.startScreenshotLibraryScan).toHaveBeenCalledWith(true);
        expect(listener).toHaveBeenNthCalledWith(1, status(true));
        expect(listener).toHaveBeenNthCalledWith(2, status(false, 2));
        unsubscribe();
    });

    it('does not publish an old hydration response after a newer event', async () => {
        const hydration = deferred<ScreenshotLibraryScanStatus>();
        const listener = vi.fn();
        const unsubscribe = subscribeScreenshotLibraryScanStatus(listener);
        mocks.getScreenshotLibraryStatus.mockReturnValue(hydration.promise);

        const pending = getCurrentScreenshotLibraryScanStatus();
        const completed = status(false, 3);
        handleScreenshotLibraryScanStatusEvent(completed);
        hydration.resolve(status(true, 1));

        await expect(pending).resolves.toEqual(completed);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(completed);
        unsubscribe();
    });
});
