import type { FriendPatchEntry } from '@/domain/friends/types';
import type { FriendLocationTime } from '@/platform/tauri/bindings';
import { signalFriendLogChanged } from '@/services/friendLogMutationService';
import type { RealtimeUserRecord } from '@/services/runtime-event-bridge/realtimeProjectionTypes';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useUserFactsStore } from '@/state/userFactsStore';

const COALESCE_WINDOW_MS = 500;

let pendingPatches: FriendPatchEntry[] = [];
let pendingUsers: RealtimeUserRecord[] = [];
let pendingFriendLogChanged = false;
let pendingLocationTimeSnapshot: FriendLocationTime[] | undefined;
let pendingOwnerUserId: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushAt = 0;

function rosterOwnerUserId(): string | null {
    return useFriendRosterStore.getState().currentUserId;
}

function hasPendingRosterUpdates(): boolean {
    return (
        pendingPatches.length > 0 ||
        pendingUsers.length > 0 ||
        pendingFriendLogChanged ||
        pendingLocationTimeSnapshot !== undefined
    );
}

function clearFlushTimer(): void {
    if (flushTimer === null) {
        return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
}

function clearPendingRosterUpdates(): void {
    pendingPatches = [];
    pendingUsers = [];
    pendingFriendLogChanged = false;
    pendingLocationTimeSnapshot = undefined;
    pendingOwnerUserId = null;
}

function applyRosterUpdates(
    patches: FriendPatchEntry[],
    users: RealtimeUserRecord[],
    friendLogChanged: boolean,
    locationTimeSnapshot?: FriendLocationTime[]
): void {
    lastFlushAt = Date.now();
    if (users.length) {
        useUserFactsStore.getState().replaceUserFacts(users);
    }
    if (patches.length) {
        useFriendRosterStore.getState().applyFriendPatches(patches);
    }
    if (locationTimeSnapshot !== undefined) {
        useFriendLocationTimeStore
            .getState()
            .replaceSnapshot(locationTimeSnapshot);
    }
    if (friendLogChanged) {
        signalFriendLogChanged();
    }
}

function scheduleFlush(): void {
    if (flushTimer !== null) {
        return;
    }
    const elapsed = Date.now() - lastFlushAt;
    const delay = Math.max(0, COALESCE_WINDOW_MS - elapsed);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushRealtimeRosterUpdates();
    }, delay);
}

function enqueueRosterUpdate(
    patches: FriendPatchEntry[],
    users: RealtimeUserRecord[],
    friendLogChanged: boolean,
    locationTimeSnapshot?: FriendLocationTime[]
): void {
    if (
        !patches.length &&
        !users.length &&
        !friendLogChanged &&
        locationTimeSnapshot === undefined
    ) {
        return;
    }
    const ownerUserId = rosterOwnerUserId();
    if (
        !hasPendingRosterUpdates() &&
        Date.now() - lastFlushAt >= COALESCE_WINDOW_MS
    ) {
        applyRosterUpdates(
            patches,
            users,
            friendLogChanged,
            locationTimeSnapshot
        );
        return;
    }
    if (hasPendingRosterUpdates() && pendingOwnerUserId !== ownerUserId) {
        flushRealtimeRosterUpdates();
    }
    pendingOwnerUserId = ownerUserId;
    pendingPatches.push(...patches);
    pendingUsers.push(...users);
    pendingFriendLogChanged = pendingFriendLogChanged || friendLogChanged;
    if (locationTimeSnapshot !== undefined) {
        pendingLocationTimeSnapshot = locationTimeSnapshot;
    }
    scheduleFlush();
}

export function queueRealtimeFriendRosterUpdate(
    patches: FriendPatchEntry[],
    friendLogChanged: boolean,
    locationTimeSnapshot?: FriendLocationTime[]
): void {
    enqueueRosterUpdate(patches, [], friendLogChanged, locationTimeSnapshot);
}

export function queueRealtimeUserFactsUpdate(
    users: RealtimeUserRecord[]
): void {
    enqueueRosterUpdate([], users, false);
}

export function flushRealtimeRosterUpdates(): void {
    clearFlushTimer();
    if (!hasPendingRosterUpdates()) {
        return;
    }
    const patches = pendingPatches;
    const users = pendingUsers;
    const friendLogChanged = pendingFriendLogChanged;
    const locationTimeSnapshot = pendingLocationTimeSnapshot;
    const ownerUserId = pendingOwnerUserId;
    clearPendingRosterUpdates();
    if (ownerUserId !== rosterOwnerUserId()) {
        return;
    }
    applyRosterUpdates(patches, users, friendLogChanged, locationTimeSnapshot);
}

export function hydrateFriendLocationTimes(
    snapshot: FriendLocationTime[]
): void {
    const store = useFriendLocationTimeStore.getState();
    if (!Object.keys(store.byUserId).length) {
        store.replaceSnapshot(snapshot);
    }
}

export function resetRealtimeRosterUpdates(): void {
    clearFlushTimer();
    clearPendingRosterUpdates();
    lastFlushAt = 0;
}
