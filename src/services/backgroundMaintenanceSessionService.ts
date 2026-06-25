import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import { buildAvatarWearSnapshotUpdate } from './avatarWearTimeService';
import { recordCurrentUserSnapshot } from './domainIngestionService';
import { bootstrapFavorites } from './favoriteBootstrapService';
import { bootstrapFriendRoster } from './friendBootstrapService';
import { refreshModerationSync } from './moderationSyncService';

type RuntimeAuthSnapshot = {
    currentUserId: string | null;
    currentUserEndpoint: string;
    currentUserWebsocket: string;
    currentUserSnapshot: Record<string, unknown> | null;
};

type RuntimeAuthTarget = {
    currentUserId: string;
    currentUserEndpoint: string;
    currentUserWebsocket: string;
};

type CurrentUserRefreshRecord = {
    target: RuntimeAuthTarget;
    overlayPatch: Record<string, unknown> | null;
    promise: Promise<Record<string, unknown> | null>;
};

type RefreshCurrentUserOptions = {
    expectedUserId?: unknown;
    expectedEndpoint?: unknown;
    expectedWebsocket?: unknown;
    overlayPatch?: unknown;
};

type RefreshPlayerModerationsOptions = {
    isCurrent?: (() => boolean) | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function getRuntimeAuth(): RuntimeAuthSnapshot {
    const runtimeState = useRuntimeStore.getState();
    return {
        currentUserId: runtimeState.auth.currentUserId,
        currentUserEndpoint: runtimeState.auth.currentUserEndpoint,
        currentUserWebsocket: runtimeState.auth.currentUserWebsocket,
        currentUserSnapshot: isRecord(runtimeState.auth.currentUserSnapshot)
            ? runtimeState.auth.currentUserSnapshot
            : null
    };
}

function normalizeRuntimeAuthValue(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getRuntimeAuthTargetKey(target: RuntimeAuthTarget) {
    return `${target.currentUserEndpoint}\u0000${target.currentUserId}\u0000${target.currentUserWebsocket}`;
}

const currentUserRefreshes = new Map<string, CurrentUserRefreshRecord>();
const CURRENT_USER_LOCAL_AUTHORITY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends',
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'pendingOffline',
    'location',
    '$location',
    '$location_at',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime',
    'travelingToTime',
    '$previousLocation',
    '$previousLocation_at'
];
const CURRENT_USER_FRIEND_ARRAY_FIELDS = new Set([
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends'
]);

function mergeCurrentUserRefreshOverlayPatch(
    record: CurrentUserRefreshRecord,
    patch: unknown
) {
    if (!isRecord(patch)) {
        return;
    }

    record.overlayPatch = {
        ...(record.overlayPatch || {}),
        ...patch
    };
}

function areCurrentUserSnapshotValuesEqual(left: unknown, right: unknown) {
    if (Object.is(left, right)) {
        return true;
    }

    if (
        (left && typeof left === 'object') ||
        (right && typeof right === 'object')
    ) {
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch {
            return false;
        }
    }

    return false;
}

function hasCurrentUserSnapshotField(source: unknown, field: string) {
    return (
        isRecord(source) && Object.prototype.hasOwnProperty.call(source, field)
    );
}

function mergeCurrentUserRefreshSnapshot({
    responseUser,
    baseSnapshot,
    currentSnapshot,
    overlayPatch
}: {
    responseUser: Record<string, unknown>;
    baseSnapshot: Record<string, unknown> | null;
    currentSnapshot: unknown;
    overlayPatch: Record<string, unknown> | null;
}): Record<string, unknown> {
    const currentSnapshotRecord = isRecord(currentSnapshot)
        ? currentSnapshot
        : null;
    let user: Record<string, unknown> = currentSnapshotRecord
        ? { ...currentSnapshotRecord, ...responseUser }
        : { ...responseUser };

    for (const field of CURRENT_USER_LOCAL_AUTHORITY_FIELDS) {
        if (
            CURRENT_USER_FRIEND_ARRAY_FIELDS.has(field) &&
            hasCurrentUserSnapshotField(responseUser, field)
        ) {
            continue;
        }
        if (hasCurrentUserSnapshotField(currentSnapshot, field)) {
            user[field] = currentSnapshotRecord?.[field];
        }
    }

    if (
        baseSnapshot &&
        normalizeRuntimeAuthValue(baseSnapshot.id) ===
            normalizeRuntimeAuthValue(currentSnapshotRecord?.id)
    ) {
        const keys = new Set([
            ...Object.keys(baseSnapshot),
            ...Object.keys(currentSnapshotRecord || {})
        ]);
        keys.delete('id');
        for (const key of keys) {
            if (
                CURRENT_USER_FRIEND_ARRAY_FIELDS.has(key) &&
                hasCurrentUserSnapshotField(responseUser, key)
            ) {
                continue;
            }
            if (
                !areCurrentUserSnapshotValuesEqual(
                    baseSnapshot[key],
                    currentSnapshotRecord?.[key]
                )
            ) {
                user[key] = currentSnapshotRecord?.[key];
            }
        }
    }

    if (overlayPatch) {
        user = { ...user, ...overlayPatch };
    }

    return user;
}

export async function refreshCurrentUser({
    expectedUserId = '',
    expectedEndpoint = '',
    expectedWebsocket = '',
    overlayPatch = null
}: RefreshCurrentUserOptions = {}) {
    const initialAuth = getRuntimeAuth();
    const target: RuntimeAuthTarget = {
        currentUserId: normalizeRuntimeAuthValue(
            expectedUserId || initialAuth.currentUserId
        ),
        currentUserEndpoint: normalizeRuntimeAuthValue(
            expectedEndpoint || initialAuth.currentUserEndpoint
        ),
        currentUserWebsocket: normalizeRuntimeAuthValue(
            expectedWebsocket || initialAuth.currentUserWebsocket
        )
    };

    if (!target.currentUserId) {
        return null;
    }

    const key = getRuntimeAuthTargetKey(target);
    const activeRecord = currentUserRefreshes.get(key);
    if (activeRecord) {
        mergeCurrentUserRefreshOverlayPatch(activeRecord, overlayPatch);
        return activeRecord.promise;
    }

    const record: CurrentUserRefreshRecord = {
        target,
        overlayPatch: null,
        promise: Promise.resolve(null)
    };
    mergeCurrentUserRefreshOverlayPatch(record, overlayPatch);
    record.promise = refreshCurrentUserForTarget({
        target,
        record
    }).finally(() => {
        if (currentUserRefreshes.get(key) === record) {
            currentUserRefreshes.delete(key);
        }
    });
    currentUserRefreshes.set(key, record);

    return record.promise;
}

async function refreshCurrentUserForTarget({
    target,
    record
}: {
    target: RuntimeAuthTarget;
    record: CurrentUserRefreshRecord;
}) {
    const {
        currentUserId,
        currentUserEndpoint,
        currentUserWebsocket,
        currentUserSnapshot: baseSnapshot
    } = getRuntimeAuth();
    if (
        target.currentUserEndpoint !==
            normalizeRuntimeAuthValue(currentUserEndpoint) ||
        target.currentUserId !== normalizeRuntimeAuthValue(currentUserId) ||
        target.currentUserWebsocket !==
            normalizeRuntimeAuthValue(currentUserWebsocket)
    ) {
        return null;
    }

    const response = await vrchatAuthRepository.getCurrentUser({
        endpoint: target.currentUserEndpoint
    });
    const responseUser =
        response.json && isRecord(response.json) ? response.json : null;
    if (!responseUser?.id) {
        return null;
    }
    if (normalizeRuntimeAuthValue(responseUser.id) !== target.currentUserId) {
        return null;
    }

    const runtimeStore = useRuntimeStore.getState();
    if (
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserId) !==
            target.currentUserId ||
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserEndpoint) !==
            target.currentUserEndpoint ||
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserWebsocket) !==
            target.currentUserWebsocket
    ) {
        return null;
    }
    const user = mergeCurrentUserRefreshSnapshot({
        responseUser,
        baseSnapshot,
        currentSnapshot: runtimeStore.auth.currentUserSnapshot,
        overlayPatch: record.overlayPatch
    });

    import('./realtimeTransportService')
        .then(({ syncRuntimeRealtimeCurrentUserSnapshot }) =>
            syncRuntimeRealtimeCurrentUserSnapshot(user, record.overlayPatch)
        )
        .catch((error: unknown) => {
            console.warn(
                'Failed to sync current user snapshot to runtime:',
                error
            );
        });

    const { snapshot } = buildAvatarWearSnapshotUpdate({
        previousSnapshot: runtimeStore.auth.currentUserSnapshot,
        nextSnapshot: user,
        isGameRunning: runtimeStore.gameState.isGameRunning
    });
    const nextSnapshot = isRecord(snapshot) ? snapshot : user;

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: normalizeRuntimeAuthValue(nextSnapshot.id),
        currentUserDisplayName:
            normalizeRuntimeAuthValue(nextSnapshot.displayName) ||
            normalizeRuntimeAuthValue(nextSnapshot.username) ||
            normalizeRuntimeAuthValue(nextSnapshot.id),
        currentUserEndpoint: target.currentUserEndpoint,
        currentUserWebsocket: target.currentUserWebsocket,
        currentUserSnapshot: nextSnapshot
    });
    recordCurrentUserSnapshot(nextSnapshot, {
        endpoint: target.currentUserEndpoint
    });
    return nextSnapshot;
}

async function refreshFriendsAndFavorites() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return;
    }

    const results = await Promise.allSettled([
        bootstrapFriendRoster({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint,
            websocket: auth.currentUserWebsocket,
            currentUserSnapshot: auth.currentUserSnapshot,
            preserveLoadedState: true
        }),
        bootstrapFavorites({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint,
            currentUserSnapshot: auth.currentUserSnapshot
        })
    ]);
    const failed = results.find(
        (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
    );
    if (failed) {
        throw failed.reason;
    }
}

export async function refreshFriendAndFavoriteSnapshots(
    _options: { syncRealtime?: boolean } = {}
) {
    void _options;
    let refreshError: unknown = null;
    try {
        await refreshFriendsAndFavorites();
    } catch (error) {
        refreshError = error;
    }
    if (refreshError) {
        throw refreshError;
    }
}

export async function refreshPlayerModerations({
    isCurrent = null
}: RefreshPlayerModerationsOptions = {}) {
    const { currentUserId, currentUserEndpoint } = getRuntimeAuth();
    if (!currentUserId) {
        return;
    }

    await refreshModerationSync({
        userId: currentUserId,
        endpoint: currentUserEndpoint
    });

    const latestAuth = getRuntimeAuth();
    if (
        latestAuth.currentUserId !== currentUserId ||
        latestAuth.currentUserEndpoint !== currentUserEndpoint ||
        (typeof isCurrent === 'function' && !isCurrent())
    ) {
        return;
    }
}
