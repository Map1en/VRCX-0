import type { RealtimeEntryCorrection } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendLogStore } from '@/state/friendLogStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import { recordCurrentUserSnapshot } from './domainIngestionService';
import { handleRealtimeInstanceQueueProjection } from './realtimeInstanceQueueService';
import { pushSharedFeedNotification } from './sharedFeedFilterService';

type ProjectionRecord = Record<string, unknown>;
type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
const CURRENT_USER_FRIEND_ARRAY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends'
];

function isRecord(value: unknown): value is ProjectionRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord(value: unknown): ProjectionRecord {
    return isRecord(value) ? value : {};
}

function hasOwn(record: ProjectionRecord, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function trimCorrectionId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getCurrentUserSnapshot(
    runtimeState: RuntimeState = useRuntimeStore.getState()
) {
    return isRecord(runtimeState.auth.currentUserSnapshot)
        ? runtimeState.auth.currentUserSnapshot
        : null;
}

function currentUserDisplayName(
    snapshot: ProjectionRecord,
    fallback: unknown = ''
) {
    return (
        normalizeUserId(snapshot.displayName) ||
        normalizeUserId(snapshot.username) ||
        normalizeUserId(snapshot.id) ||
        normalizeUserId(fallback)
    );
}

function hasCompleteCurrentUserFriendBucketSnapshot(source: ProjectionRecord) {
    return CURRENT_USER_FRIEND_ARRAY_FIELDS.every((field) =>
        Array.isArray(source[field])
    );
}

function getCurrentUserProjectionFriendBucketSource(payload: unknown) {
    const projection = asRecord(payload);
    const patch = asRecord(projection.patch);
    if (hasCompleteCurrentUserFriendBucketSnapshot(patch)) {
        return patch;
    }
    const snapshot = asRecord(projection.snapshot);
    if (
        Object.keys(patch).length === 0 &&
        hasCompleteCurrentUserFriendBucketSnapshot(snapshot)
    ) {
        return snapshot;
    }
    return null;
}

function mergeCurrentUserProjectionSnapshot(
    runtimeState: RuntimeState,
    payload: unknown
) {
    const projection = asRecord(payload);
    const currentSnapshot = getCurrentUserSnapshot(runtimeState);
    const patch = asRecord(projection.patch);
    const snapshotSource = isRecord(projection.snapshot)
        ? projection.snapshot
        : {};
    const source = Object.keys(patch).length ? patch : snapshotSource;
    const completeFriendBucketSource =
        getCurrentUserProjectionFriendBucketSource(projection);
    const nextSnapshot: ProjectionRecord = {
        ...(currentSnapshot || {}),
        ...source
    };

    if (completeFriendBucketSource) {
        for (const field of CURRENT_USER_FRIEND_ARRAY_FIELDS) {
            nextSnapshot[field] = completeFriendBucketSource[field];
        }
    }

    if (currentSnapshot) {
        for (const field of CURRENT_USER_FRIEND_ARRAY_FIELDS) {
            if (
                !completeFriendBucketSource &&
                Array.isArray(currentSnapshot[field])
            ) {
                nextSnapshot[field] = currentSnapshot[field];
            }
        }
    }

    return nextSnapshot;
}

function applyFriendPatch(
    userId: string,
    patch: ProjectionRecord,
    stateBucket: string,
    stateBucketAuthority: string
) {
    const normalizedUserId = normalizeUserId(
        userId || patch.id || patch.userId
    );
    if (!normalizedUserId) {
        return;
    }
    useFriendRosterStore.getState().applyFriendPatch({
        userId: normalizedUserId,
        patch,
        stateBucket,
        stateBucketAuthority
    });
}

function pushProjectionFeedEntry(entry: unknown) {
    const feedEntry = asRecord(entry);
    if (!Object.keys(feedEntry).length) {
        return;
    }
    useFeedLiveStore.getState().pushEntry(feedEntry, {
        ownerUserId: useRuntimeStore.getState().auth.currentUserId ?? undefined
    });
    pushSharedFeedNotification(feedEntry).catch((error: unknown) => {
        console.warn('Failed to publish realtime feed notification:', error);
    });
}

function clearNotificationMenuIfNoUnseen() {
    if (useVrcNotificationStore.getState().unseenCount === 0) {
        useShellStore.getState().removeNotify('notification');
    }
}

function notifyNotificationMenu(notification: ProjectionRecord) {
    if (notification.version === 2 && notification.seen !== false) {
        return;
    }
    useShellStore.getState().notifyMenu('notification');
}

function parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeUserId(entry)).filter(Boolean);
    }
    if (typeof value !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.map((entry) => normalizeUserId(entry)).filter(Boolean)
            : [];
    } catch {
        return [];
    }
}

async function shouldNotifyInstanceClosed(): Promise<boolean> {
    try {
        const filters = parseStringArray(
            await configRepository.getString(
                'VRCX_notificationTableFilters',
                '[]'
            )
        );
        return !filters.length || filters.includes('instance.closed');
    } catch {
        return true;
    }
}

function handleRealtimeFriendProjection(payload: unknown) {
    const projection = asRecord(payload);
    for (const userId of Array.isArray(projection.removals)
        ? projection.removals
        : []) {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) {
            continue;
        }
        useFriendRosterStore.getState().removeFriend(normalizedUserId);
    }

    for (const entry of Array.isArray(projection.patches)
        ? projection.patches
        : []) {
        const patchEntry = asRecord(entry);
        const patch = asRecord(patchEntry.patch);
        applyFriendPatch(
            normalizeUserId(patchEntry.userId || patch.id || patch.userId),
            patch,
            normalizeUserId(
                patchEntry.stateBucket || patch.stateBucket || patch.state
            ),
            normalizeUserId(patchEntry.stateBucketAuthority || 'explicit')
        );
    }

    for (const entry of Array.isArray(projection.feedEntries)
        ? projection.feedEntries
        : []) {
        pushProjectionFeedEntry(entry);
    }

    if (projection.friendLogChanged) {
        useShellStore.getState().notifyMenu('friend-log');
        useFriendLogStore.getState().bumpRevision();
    }
}

export function handleRealtimeUserCacheProjection(payload: unknown) {
    const projection = asRecord(payload);
    const users = Array.isArray(projection.users) ? projection.users : [];
    useUserFactsStore.getState().replaceUserFacts(users);
}

async function handleRealtimeNotificationProjection(payload: unknown) {
    const projection = asRecord(payload);
    const store = useVrcNotificationStore.getState();

    if (Array.isArray(projection.expiredIds) && projection.expiredIds.length) {
        store.expireNotifications(projection.expiredIds);
    }
    if (Array.isArray(projection.seenIds) && projection.seenIds.length) {
        store.markNotificationsSeen(projection.seenIds);
    }

    for (const upsert of Array.isArray(projection.upserts)
        ? projection.upserts
        : []) {
        const item = asRecord(upsert);
        let notification = asRecord(item.notification);
        if (!notification.id) {
            continue;
        }
        const existingNotification = store.rows.find(
            (row) => row.id === notification.id
        );
        const insertDefaults = asRecord(item.insertDefaults);
        if (!existingNotification && Object.keys(insertDefaults).length) {
            notification = {
                ...insertDefaults,
                ...notification
            };
        }
        store.upsertNotification(notification);
        const mergedNotification =
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === notification.id) || notification;
        if (item.notifyMenu) {
            notifyNotificationMenu(mergedNotification);
        }
    }

    if (projection.clearMenuIfNoUnseen) {
        clearNotificationMenuIfNoUnseen();
    }
}

function handleRealtimeEntryCorrection(
    payload: Partial<RealtimeEntryCorrection>
) {
    const fields = asRecord(payload.fields);
    const id = trimCorrectionId(payload.id);
    if (!id || !Object.keys(fields).length) {
        return;
    }
    if (payload.stream === 'feed') {
        useFeedLiveStore.getState().patchEntry(id, fields);
    } else if (payload.stream === 'notification') {
        useVrcNotificationStore.getState().patchNotification(id, fields);
    }
}

function handleRealtimeCurrentUserProjection(payload: unknown) {
    const projection = asRecord(payload);
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = mergeCurrentUserProjectionSnapshot(
        runtimeStore,
        projection
    );
    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: snapshot,
        currentUserDisplayName: currentUserDisplayName(
            snapshot,
            runtimeStore.auth.currentUserDisplayName
        )
    });
    const patch = asRecord(projection.patch);
    if (hasOwn(patch, 'queuedInstance')) {
        const queuedInstance = normalizeUserId(patch.queuedInstance);
        if (queuedInstance) {
            handleRealtimeInstanceQueueProjection({
                kind: 'update',
                instanceLocation: queuedInstance
            });
        } else if (useRuntimeStore.getState().instanceQueue.active) {
            useRuntimeStore.getState().clearInstanceQueueState();
        }
    }
    if (isRecord(projection.gameStatePatch)) {
        runtimeStore.setGameState(projection.gameStatePatch);
    }
    recordCurrentUserSnapshot(snapshot, {
        endpoint: runtimeStore.auth.currentUserEndpoint,
        source: 'currentUser'
    });
}

async function handleRealtimeInstanceClosedProjection(payload: unknown) {
    const projection = asRecord(payload);
    const notification = asRecord(projection.notification);
    if (!notification.id) {
        return;
    }
    useVrcNotificationStore.getState().upsertNotification(notification);
    if (await shouldNotifyInstanceClosed()) {
        useShellStore.getState().notifyMenu('notification');
    }
    useFeedLiveStore.getState().pushEntry(asRecord(projection.feedEntry), {
        ownerUserId: useRuntimeStore.getState().auth.currentUserId ?? undefined
    });
    pushSharedFeedNotification(notification).catch((error: unknown) => {
        console.warn(
            'Failed to publish instance-closed shared feed notification:',
            error
        );
    });
}

export {
    handleRealtimeCurrentUserProjection,
    handleRealtimeEntryCorrection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection
};
