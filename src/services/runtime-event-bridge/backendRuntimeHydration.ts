import type { FriendProfileLoadStatusPayload } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import { resumeFrontendSessionFromBackendRuntime } from '../backendRuntimeSessionResumeService';
import { applyFriendProfileLoadStatusPayload } from '../friendProfileLoadService';
import { isRecord } from './guards';
import type { RuntimeSnapshotPayload } from './types';

let backendRuntimeHydrationPromise: Promise<void> | null = null;
let pendingBackendRuntimeHydrationSnapshot: RuntimeSnapshotPayload = null;
let hasPendingBackendRuntimeHydrationSnapshot = false;

function applyBackendRuntimeSnapshot(
    snapshot: RuntimeSnapshotPayload,
    {
        markHydrated = true,
        applyFriendProfileLoad = false
    }: { markHydrated?: boolean; applyFriendProfileLoad?: boolean } = {}
): void {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setBackendRuntimeSnapshot(snapshot);
    if (
        applyFriendProfileLoad &&
        isRecord(snapshot) &&
        isRecord(snapshot.friendProfileLoad)
    ) {
        applyFriendProfileLoadStatusPayload(
            snapshot.friendProfileLoad as FriendProfileLoadStatusPayload
        );
    }
    if (markHydrated) {
        runtimeStore.setShellState({
            backendRuntimeSnapshotHydrated: true
        });
    }
}

export function hydrateBackendRuntimeSnapshot(
    snapshot: RuntimeSnapshotPayload,
    flushPendingProjectionEvents: () => void
): Promise<void> {
    pendingBackendRuntimeHydrationSnapshot = snapshot;
    hasPendingBackendRuntimeHydrationSnapshot = true;

    if (!backendRuntimeHydrationPromise) {
        useRuntimeStore.getState().setShellState({
            backendRuntimeSessionHydrating: true
        });
        backendRuntimeHydrationPromise = (async () => {
            while (hasPendingBackendRuntimeHydrationSnapshot) {
                const nextSnapshot = pendingBackendRuntimeHydrationSnapshot;
                pendingBackendRuntimeHydrationSnapshot = null;
                hasPendingBackendRuntimeHydrationSnapshot = false;
                applyBackendRuntimeSnapshot(nextSnapshot, {
                    markHydrated: false,
                    applyFriendProfileLoad: true
                });
                try {
                    await resumeFrontendSessionFromBackendRuntime(nextSnapshot);
                    flushPendingProjectionEvents();
                } catch (error) {
                    console.warn(
                        'Failed to resume frontend session from backend runtime:',
                        error
                    );
                }
            }
        })().finally(() => {
            useRuntimeStore.getState().setShellState({
                backendRuntimeSnapshotHydrated: true,
                backendRuntimeSessionHydrating: false
            });
            backendRuntimeHydrationPromise = null;
        });
    }
    return backendRuntimeHydrationPromise;
}

export function handleBackendRuntimeTelemetrySnapshot(
    snapshot: RuntimeSnapshotPayload,
    flushPendingProjectionEvents: () => void
): void {
    if (!useRuntimeStore.getState().shell.backendRuntimeSnapshotHydrated) {
        hydrateBackendRuntimeSnapshot(snapshot, flushPendingProjectionEvents);
        return;
    }

    applyBackendRuntimeSnapshot(snapshot);
    resumeFrontendSessionFromBackendRuntime(snapshot)
        .catch((error: unknown) => {
            console.warn(
                'Failed to resume frontend session from backend runtime:',
                error
            );
        })
        .then(() => {
            flushPendingProjectionEvents();
        });
}
