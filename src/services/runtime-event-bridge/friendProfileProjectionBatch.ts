import type { FriendProjection } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import { isRecord } from './guards';
import type { RuntimeEventName, RuntimeEventPayloadMap } from './types';

type DeliverProjection = (name: RuntimeEventName, payload: unknown) => void;

const FRIEND_PROFILE_PROJECTION_BATCH_MS = 10_000;
const FRIEND_PROFILE_BULK_LOAD_SOURCE = 'friendProfileBulkLoad';

let friendProfileProjectionBatchTimer: ReturnType<typeof setTimeout> | null =
    null;
let pendingFriendProfileProjection: FriendProjection | null = null;
let pendingFriendProfileUsers: unknown[] = [];

function friendProfileLoadIsActive(): boolean {
    const status = useRuntimeStore.getState().friendProfileLoad.status;
    return status === 'running' || status === 'cancelling';
}

function isBatchableFriendProfileProjection(
    projection: FriendProjection
): boolean {
    return (
        (projection.patches?.length ?? 0) > 0 &&
        (projection.removals?.length ?? 0) === 0 &&
        (projection.feedEntries?.length ?? 0) === 0 &&
        !projection.friendLogChanged
    );
}

function scheduleFriendProfileProjectionBatch(
    deliverProjection: DeliverProjection
): void {
    if (friendProfileProjectionBatchTimer !== null) {
        return;
    }
    friendProfileProjectionBatchTimer = setTimeout(() => {
        friendProfileProjectionBatchTimer = null;
        flushFriendProfileProjectionBatch(deliverProjection);
    }, FRIEND_PROFILE_PROJECTION_BATCH_MS);
}

function clearFriendProfileProjectionBatchTimer(): void {
    if (friendProfileProjectionBatchTimer === null) {
        return;
    }
    clearTimeout(friendProfileProjectionBatchTimer);
    friendProfileProjectionBatchTimer = null;
}

function queueFriendProfileProjection(
    projection: FriendProjection,
    deliverProjection: DeliverProjection
): void {
    if (
        pendingFriendProfileProjection &&
        (pendingFriendProfileProjection.generation !== projection.generation ||
            pendingFriendProfileProjection.baselineRevision !==
                projection.baselineRevision)
    ) {
        flushFriendProfileProjectionBatch(deliverProjection);
    }
    if (pendingFriendProfileProjection) {
        pendingFriendProfileProjection = {
            ...pendingFriendProfileProjection,
            patches: [
                ...(pendingFriendProfileProjection.patches ?? []),
                ...(projection.patches ?? [])
            ]
        };
    } else {
        pendingFriendProfileProjection = {
            ...projection,
            patches: [...(projection.patches ?? [])],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        };
    }
    scheduleFriendProfileProjectionBatch(deliverProjection);
}

function queueFriendProfileUsers(
    payload: unknown,
    deliverProjection: DeliverProjection
): boolean {
    const projection = isRecord(payload) ? payload : {};
    if (!Array.isArray(projection.users) || projection.users.length === 0) {
        return false;
    }
    pendingFriendProfileUsers.push(...projection.users);
    scheduleFriendProfileProjectionBatch(deliverProjection);
    return true;
}

export function flushFriendProfileProjectionBatch(
    deliverProjection: DeliverProjection
): void {
    clearFriendProfileProjectionBatchTimer();
    const friendProjection = pendingFriendProfileProjection;
    const users = pendingFriendProfileUsers;
    pendingFriendProfileProjection = null;
    pendingFriendProfileUsers = [];
    if (users.length > 0) {
        deliverProjection('realtimeUserProjection', { users });
    }
    if (friendProjection) {
        deliverProjection('realtimeFriendProjection', friendProjection);
    }
}

export function resetFriendProfileProjectionBatch(): void {
    clearFriendProfileProjectionBatchTimer();
    pendingFriendProfileProjection = null;
    pendingFriendProfileUsers = [];
}

export function queueFriendProfileLoadProjection(
    name: RuntimeEventName,
    payload: unknown,
    deliverProjection: DeliverProjection
): boolean {
    if (
        !friendProfileLoadIsActive() ||
        !isRecord(payload) ||
        payload.source !== FRIEND_PROFILE_BULK_LOAD_SOURCE
    ) {
        return false;
    }
    if (name === 'realtimeUserProjection') {
        return queueFriendProfileUsers(payload, deliverProjection);
    }
    if (name !== 'realtimeFriendProjection') {
        return false;
    }
    const projection =
        payload as RuntimeEventPayloadMap['realtimeFriendProjection'];
    if (!isBatchableFriendProfileProjection(projection)) {
        return false;
    }
    queueFriendProfileProjection(projection, deliverProjection);
    return true;
}
