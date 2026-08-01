import type { ScreenshotLibraryScanStatus } from '@/platform/tauri/bindings';
import mediaRepository from '@/repositories/mediaRepository';

type ScreenshotLibraryScanStatusListener = (
    status: ScreenshotLibraryScanStatus
) => void;

const listeners = new Set<ScreenshotLibraryScanStatusListener>();
let statusSequence = 0;
let latestStatus: ScreenshotLibraryScanStatus | null = null;

function publishScreenshotLibraryScanStatus(
    status: ScreenshotLibraryScanStatus
): ScreenshotLibraryScanStatus {
    latestStatus = status;
    for (const listener of listeners) {
        listener(status);
    }
    return status;
}

function beginStatusRequest(): number {
    statusSequence += 1;
    return statusSequence;
}

function applyStatusResponse(
    status: ScreenshotLibraryScanStatus,
    requestSequence: number
): ScreenshotLibraryScanStatus | null {
    if (requestSequence !== statusSequence) {
        return latestStatus;
    }
    return publishScreenshotLibraryScanStatus(status);
}

export function handleScreenshotLibraryScanStatusEvent(
    status: ScreenshotLibraryScanStatus
): void {
    statusSequence += 1;
    publishScreenshotLibraryScanStatus(status);
}

export function subscribeScreenshotLibraryScanStatus(
    listener: ScreenshotLibraryScanStatusListener
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export async function getCurrentScreenshotLibraryScanStatus(): Promise<ScreenshotLibraryScanStatus | null> {
    const requestSequence = beginStatusRequest();
    return applyStatusResponse(
        await mediaRepository.getScreenshotLibraryStatus(),
        requestSequence
    );
}

export async function startScreenshotLibraryScan(
    force = false
): Promise<ScreenshotLibraryScanStatus | null> {
    const requestSequence = beginStatusRequest();
    return applyStatusResponse(
        await mediaRepository.startScreenshotLibraryScan(force),
        requestSequence
    );
}
