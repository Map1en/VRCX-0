import { commands, type VrcStatusSnapshot } from '@/platform/tauri/bindings';
import { MINUTE_MS } from '@/shared/constants/time';
import { useRuntimeStore } from '@/state/runtimeStore';

const FOCUS_REFRESH_MS = MINUTE_MS;

let refreshPromise: Promise<void> | null = null;
let hydrationPromise: Promise<void> | null = null;
let snapshotSequence = 0;

export function applyVrcStatusSnapshot(snapshot: VrcStatusSnapshot): void {
    snapshotSequence += 1;
    useRuntimeStore.getState().setVrcStatusState(snapshot);
}

function applyVrcStatusResponse(
    snapshot: VrcStatusSnapshot,
    requestSequence: number
): void {
    if (snapshotSequence === requestSequence) {
        applyVrcStatusSnapshot(snapshot);
    }
}

export function refreshVrcStatus(): Promise<void> {
    if (!refreshPromise) {
        const requestSequence = snapshotSequence;
        refreshPromise = commands
            .appVrcStatusRefresh()
            .then((snapshot) =>
                applyVrcStatusResponse(snapshot, requestSequence)
            )
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
}

export function handleBrowserFocus(): Promise<void> {
    const lastFetchedAt = Date.parse(
        useRuntimeStore.getState().vrcStatus.lastFetchedAt || ''
    );
    if (
        Number.isFinite(lastFetchedAt) &&
        Date.now() - lastFetchedAt < FOCUS_REFRESH_MS
    ) {
        return Promise.resolve();
    }
    return refreshVrcStatus();
}

export function refreshVrcStatusNow(): Promise<void> {
    return refreshVrcStatus();
}

export function hydrateVrcStatus(): Promise<void> {
    if (!hydrationPromise) {
        const requestSequence = snapshotSequence;
        hydrationPromise = commands
            .appVrcStatusGet()
            .then((snapshot) =>
                applyVrcStatusResponse(snapshot, requestSequence)
            )
            .catch((error: unknown) => {
                console.warn('Failed to hydrate VRChat status:', error);
            })
            .finally(() => {
                hydrationPromise = null;
            });
    }
    return hydrationPromise;
}
