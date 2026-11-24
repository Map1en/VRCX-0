import configRepository from '@/repositories/configRepository';
import type {
    RealtimeCurrentUserProjectionPayload,
    RealtimeEntryCorrectionPayload,
    RealtimeFeedProjectionPayload,
    RealtimeFriendProjectionPayload,
    RealtimeInstanceClosedProjectionPayload,
    RealtimeNotificationProjectionPayload,
    RealtimeUserProjectionPayload
} from '@/services/runtime-event-bridge/realtimeProjectionTypes';
import { isRecord } from '@/shared/utils/record';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import { recordCurrentUserSnapshot } from './domainIngestionService';
import { handleQueuedInstancePatch } from './realtimeInstanceQueueService';
import {
    flushRealtimeRosterUpdates,
    queueRealtimeFriendRosterUpdate,
    queueRealtimeUserFactsUpdate
} from './realtimeRosterUpdateQueue';
import {
    notifyShellMenu,
    removeShellMenuNotify
} from './shellNotificationDotService';
import {
    expireVrcNotifications,
    markVrcNotificationsSeen,
    patchVrcNotification,
    upsertVrcNotification
} from './vrcNotificationService';

type ProjectionRecord = Record<string, unknown>;
type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
const CURRENT_USER_FRIEND_ARRAY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends'
];

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

function currentUserDisplayName(snapshot: ProjectionRecord, fallback = '') {
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

function getCurrentUserProjectionFriendBucketSource(
    payload: RealtimeCurrentUserProjectionPayload
) {
    const patch = payload.patch;
    return hasCompleteCurrentUserFriendBucketSnapshot(patch) ? patch : null;
}

function mergeCurrentUserProjectionSnapshot(
    runtimeState: RuntimeState,
    payload: RealtimeCurrentUserProjectionPayload
) {
    const currentSnapshot = getCurrentUserSnapshot(runtimeState);
    const completeFriendBucketSource =
        getCurrentUserProjectionFriendBucketSource(payload);
    const nextSnapshot: ProjectionRecord = {
        ...currentSnapshot,
        ...payload.patch
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

function handleRealtimeFeedProjection(payload: RealtimeFeedProjectionPayload) {
    const currentUserId = useRuntimeStore.getState().auth.currentUserId ?? '';
    if (payload.ownerUserId !== currentUserId) {
        return;
    }
    const upserts = payload.upserts.filter(
        (upsert) => Object.keys(upsert.entry).length > 0
    );
    useFeedLiveStore.getState().pushEntries(upserts, {
        ownerUserId: payload.ownerUserId
    });
    useFeedLiveStore.getState().pushPatches(payload.patches);
}

function clearNotificationMenuIfNoUnseen() {
    if (useVrcNotificationStore.getState().unseenCount === 0) {
        removeShellMenuNotify('notification');
    }
}

function notifyNotificationMenu(notification: ProjectionRecord) {
    if (notification.version === 2 && notification.seen !== false) {
        return;
    }
    notifyShellMenu('notification');
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

function handleRealtimeFriendProjection(
    payload: RealtimeFriendProjectionPayload
) {
    const removalIds = payload.removals
        .map((userId) => normalizeUserId(userId))
        .filter(Boolean);
    if (removalIds.length) {
        flushRealtimeRosterUpdates();
        for (const userId of removalIds) {
            useFriendRosterStore.getState().removeFriend(userId);
        }
    }

    const patchEntries = payload.patches.map((patchEntry) => {
        const record = patchEntry.record;
        return {
            userId: normalizeUserId(
                patchEntry.userId || record.id || record.userId
            ),
            patch: record,
            presence: patchEntry.presence,
            generation: payload.generation
        };
    });
    queueRealtimeFriendRosterUpdate(
        patchEntries,
        payload.friendLogChanged,
        payload.locationTimeSnapshot ?? undefined
    );
}

export function handleRealtimeUserCacheProjection(
    payload: RealtimeUserProjectionPayload
) {
    queueRealtimeUserFactsUpdate(payload.users);
}

async function handleRealtimeNotificationProjection(
    payload: RealtimeNotificationProjectionPayload
) {
    const store = useVrcNotificationStore.getState();

    if (payload.expiredIds.length) {
        expireVrcNotifications(payload.expiredIds);
    }
    if (payload.seenIds.length) {
        markVrcNotificationsSeen(payload.seenIds);
    }

    for (const upsert of payload.upserts) {
        let notification = upsert.notification;
        if (!notification.id) {
            continue;
        }
        const existingNotification = store.rows.find(
            (row) => row.id === notification.id
        );
        const insertDefaults = upsert.insertDefaults;
        if (
            !existingNotification &&
            insertDefaults &&
            Object.keys(insertDefaults).length
        ) {
            notification = {
                ...insertDefaults,
                ...notification
            };
        }
        upsertVrcNotification(notification);
        const mergedNotification =
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === notification.id) || notification;
        if (upsert.notifyMenu) {
            notifyNotificationMenu(mergedNotification);
        }
    }

    if (payload.clearMenuIfNoUnseen) {
        clearNotificationMenuIfNoUnseen();
    }
}

function handleRealtimeEntryCorrection(
    payload: RealtimeEntryCorrectionPayload
) {
    const id = trimCorrectionId(payload.id);
    if (!id || !Object.keys(payload.fields).length) {
        return;
    }
    if (payload.stream === 'notification') {
        patchVrcNotification(id, payload.fields);
    }
}

function handleRealtimeCurrentUserProjection(
    payload: RealtimeCurrentUserProjectionPayload
) {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = mergeCurrentUserProjectionSnapshot(runtimeStore, payload);
    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: snapshot,
        currentUserDisplayName: currentUserDisplayName(
            snapshot,
            runtimeStore.auth.currentUserDisplayName
        )
    });
    const patch = payload.patch;
    if (hasOwn(patch, 'queuedInstance')) {
        const queuedInstance = normalizeUserId(patch.queuedInstance);
        if (queuedInstance) {
            handleQueuedInstancePatch(queuedInstance);
        } else if (useRuntimeStore.getState().instanceQueue.active) {
            useRuntimeStore.getState().clearInstanceQueueState();
        }
    }
    if (payload.gameStatePatch) {
        runtimeStore.setGameState(payload.gameStatePatch);
    }
    recordCurrentUserSnapshot(snapshot, {
        endpoint: runtimeStore.auth.currentUserEndpoint,
        source: 'currentUser'
    });
}

async function handleRealtimeInstanceClosedProjection(
    payload: RealtimeInstanceClosedProjectionPayload
) {
    const notification = payload.notification;
    if (!notification.id) {
        return;
    }
    upsertVrcNotification(notification);
    if (await shouldNotifyInstanceClosed()) {
        notifyShellMenu('notification');
    }
}

export {
    handleRealtimeCurrentUserProjection,
    handleRealtimeEntryCorrection,
    handleRealtimeFeedProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection
};
