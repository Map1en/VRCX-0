import { configRepository } from '@/repositories/index.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { recordCurrentUserSnapshot, recordFriendPatch } from './domainIngestionService.js';
import { handleInviteAutomationNotification } from './inviteAutomationService.js';
import { deliverRuntimeNotification } from './notificationDeliveryService.js';
import { pushSharedFeedNotification } from './sharedFeedFilterService.js';

type AnyRecord = Record<string, any>;
const CURRENT_USER_FRIEND_ARRAY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends'
];

function isRecord(value: unknown): value is AnyRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord(value: unknown): AnyRecord {
    return isRecord(value) ? value : {};
}

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function removeFromArray(values: unknown, userId: string): string[] {
    return Array.isArray(values)
        ? values.filter((value) => normalizeUserId(value) !== userId)
        : [];
}

function ensureArrayMembership(values: unknown, userId: string): string[] {
    const list = Array.isArray(values)
        ? values.map((value) => normalizeUserId(value)).filter(Boolean)
        : [];
    return list.includes(userId) ? list : [...list, userId];
}

function getCurrentUserSnapshot(runtimeState = useRuntimeStore.getState()) {
    return isRecord(runtimeState.auth.currentUserSnapshot)
        ? runtimeState.auth.currentUserSnapshot
        : null;
}

function currentUserDisplayName(snapshot: AnyRecord, fallback = '') {
    return (
        normalizeUserId(snapshot.displayName) ||
        normalizeUserId(snapshot.username) ||
        normalizeUserId(snapshot.id) ||
        fallback
    );
}

function mergeCurrentUserProjectionSnapshot(
    runtimeState: ReturnType<typeof useRuntimeStore.getState>,
    projection: AnyRecord
) {
    const currentSnapshot = getCurrentUserSnapshot(runtimeState);
    const patch = asRecord(projection.patch);
    const source = Object.keys(patch).length
        ? patch
        : isRecord(projection.snapshot)
          ? projection.snapshot
          : {};
    const nextSnapshot = {
        ...(currentSnapshot || {}),
        ...source
    };

    if (currentSnapshot) {
        for (const field of CURRENT_USER_FRIEND_ARRAY_FIELDS) {
            if (Array.isArray(currentSnapshot[field])) {
                nextSnapshot[field] = currentSnapshot[field];
            }
        }
    }

    return nextSnapshot;
}

function syncCurrentUserFriendState(userId: string, stateBucket: string) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }
    const nextStateBucket = normalizeUserId(stateBucket) || 'offline';
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = getCurrentUserSnapshot(runtimeStore);
    if (!snapshot) {
        return;
    }

    const nextSnapshot = {
        ...snapshot,
        friends: ensureArrayMembership(snapshot.friends, normalizedUserId),
        onlineFriends: removeFromArray(snapshot.onlineFriends, normalizedUserId),
        activeFriends: removeFromArray(snapshot.activeFriends, normalizedUserId),
        offlineFriends: removeFromArray(snapshot.offlineFriends, normalizedUserId)
    };

    if (nextStateBucket === 'online') {
        nextSnapshot.onlineFriends = ensureArrayMembership(
            nextSnapshot.onlineFriends,
            normalizedUserId
        );
    } else if (nextStateBucket === 'active') {
        nextSnapshot.activeFriends = ensureArrayMembership(
            nextSnapshot.activeFriends,
            normalizedUserId
        );
    } else {
        nextSnapshot.offlineFriends = ensureArrayMembership(
            nextSnapshot.offlineFriends,
            normalizedUserId
        );
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: nextSnapshot
    });
    recordCurrentUserSnapshot(nextSnapshot, {
        endpoint: runtimeStore.auth.currentUserEndpoint,
        source: 'currentUser'
    });
}

function removeCurrentUserFriend(userId: string) {
    const normalizedUserId = normalizeUserId(userId);
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = getCurrentUserSnapshot(runtimeStore);
    if (!normalizedUserId || !snapshot) {
        return;
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...snapshot,
            friends: removeFromArray(snapshot.friends, normalizedUserId),
            onlineFriends: removeFromArray(snapshot.onlineFriends, normalizedUserId),
            activeFriends: removeFromArray(snapshot.activeFriends, normalizedUserId),
            offlineFriends: removeFromArray(snapshot.offlineFriends, normalizedUserId)
        }
    });
}

function applyFriendPatch(userId: string, patch: AnyRecord, stateBucket: string) {
    const normalizedUserId = normalizeUserId(userId || patch.id || patch.userId);
    if (!normalizedUserId) {
        return;
    }
    useFriendRosterStore.getState().applyFriendPatch({
        userId: normalizedUserId,
        patch,
        stateBucket
    });
    recordFriendPatch({
        endpoint: useRuntimeStore.getState().auth.currentUserEndpoint,
        userId: normalizedUserId,
        patch,
        stateBucket
    });
    syncCurrentUserFriendState(normalizedUserId, stateBucket);
}

function pushProjectionFeedEntry(entry: unknown) {
    const feedEntry = asRecord(entry);
    if (!Object.keys(feedEntry).length) {
        return;
    }
    useFeedLiveStore.getState().pushEntry(feedEntry, {
        ownerUserId: useRuntimeStore.getState().auth.currentUserId
    });
    void pushSharedFeedNotification(feedEntry).catch((error) => {
        console.warn('Failed to publish realtime feed notification:', error);
    });
}

function clearNotificationMenuIfNoUnseen() {
    if (useVrcNotificationStore.getState().unseenCount === 0) {
        useShellStore.getState().removeNotify('notification');
    }
}

function notifyNotificationMenu(notification: AnyRecord) {
    if (notification.version === 2 && notification.seen !== false) {
        return;
    }
    useShellStore.getState().notifyMenu('notification');
}

async function runInviteAutomation(notification: AnyRecord) {
    return handleInviteAutomationNotification(notification).catch((error) => {
        console.warn('Failed to handle invite automation notification:', error);
        return { handled: false, reason: 'error' };
    });
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
        removeCurrentUserFriend(normalizedUserId);
    }

    for (const entry of Array.isArray(projection.patches)
        ? projection.patches
        : []) {
        const patchEntry = asRecord(entry);
        const patch = asRecord(patchEntry.patch);
        applyFriendPatch(
            normalizeUserId(patchEntry.userId || patch.id || patch.userId),
            patch,
            normalizeUserId(patchEntry.stateBucket || patch.stateBucket || patch.state)
        );
    }

    for (const entry of Array.isArray(projection.feedEntries)
        ? projection.feedEntries
        : []) {
        pushProjectionFeedEntry(entry);
    }

    if (projection.friendLogChanged) {
        useShellStore.getState().notifyMenu('friend-log');
    }
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
                .rows.find((row) => row.id === notification.id) ||
            notification;
        const automationResult = item.runAutomation
            ? await runInviteAutomation(mergedNotification)
            : { handled: false };
        if (automationResult.handled) {
            clearNotificationMenuIfNoUnseen();
            continue;
        }
        if (item.notifyMenu) {
            notifyNotificationMenu(mergedNotification);
        }
        if (item.deliverRuntime) {
            void deliverRuntimeNotification(mergedNotification).catch((error) => {
                console.warn('Failed to deliver runtime notification:', error);
            });
        }
    }

    if (projection.clearMenuIfNoUnseen) {
        clearNotificationMenuIfNoUnseen();
    }
}

function handleRealtimeCurrentUserProjection(payload: unknown) {
    const projection = asRecord(payload);
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = mergeCurrentUserProjectionSnapshot(runtimeStore, projection);
    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: snapshot,
        currentUserDisplayName: currentUserDisplayName(
            snapshot,
            runtimeStore.auth.currentUserDisplayName
        )
    });
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
        ownerUserId: useRuntimeStore.getState().auth.currentUserId
    });
    void pushSharedFeedNotification(notification).catch((error) => {
        console.warn(
            'Failed to publish instance-closed shared feed notification:',
            error
        );
    });
}

export {
    handleRealtimeCurrentUserProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection
};
