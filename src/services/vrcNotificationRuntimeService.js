import notificationRepository from '@/repositories/notificationRepository.js';
import {
    applyBoopLegacyHandling,
    createDefaultNotificationRef,
    createDefaultNotificationV2Ref,
    parseNotificationDetails,
    sanitizeNotificationJson
} from '@/shared/utils/notificationTransforms.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { deliverRuntimeNotification } from './notificationDeliveryService.js';

function parseObject(value) {
    if (!value) {
        return {};
    }
    if (value && typeof value === 'object') {
        return value;
    }
    if (typeof value !== 'string') {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function parseArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeV1Notification(data) {
    const ref = createDefaultNotificationRef(
        sanitizeNotificationJson({ ...data })
    );
    ref.createdAt = ref.createdAt || ref.created_at || new Date().toISOString();
    ref.created_at = ref.createdAt;
    ref.details = parseNotificationDetails(ref.details);
    return ref;
}

function normalizeV2Notification(data, endpoint = '') {
    const ref = createDefaultNotificationV2Ref(
        sanitizeNotificationJson({ ...data })
    );
    ref.createdAt = ref.createdAt || ref.created_at || new Date().toISOString();
    ref.created_at = ref.createdAt;
    ref.data = parseObject(ref.data);
    ref.responses = parseArray(ref.responses);
    ref.details = parseObject(ref.details);
    applyBoopLegacyHandling(ref, normalizeVrchatEndpointDomain(endpoint));
    return ref;
}

function getCurrentAuth() {
    return useRuntimeStore.getState().auth || {};
}

function notifyNotificationMenu(notification) {
    if (notification?.version === 2 && notification.seen !== false) {
        return;
    }
    useShellStore.getState().notifyMenu('notification');
}

function clearNotificationMenuIfNoUnseen() {
    if (useVrcNotificationStore.getState().unseenCount === 0) {
        useShellStore.getState().removeNotify('notification');
    }
}

async function ensureNotificationTables() {
    const currentUserId = getCurrentAuth().currentUserId;
    return currentUserId;
}

function shouldPersistV1(notification, currentUserId) {
    return (
        notification.senderUserId !== currentUserId &&
        notification.type !== 'friendRequest' &&
        notification.type !== 'ignoredFriendRequest' &&
        !String(notification.type || '').includes('.')
    );
}

async function persistV1Notification(notification) {
    const currentUserId = await ensureNotificationTables();
    if (!currentUserId || !shouldPersistV1(notification, currentUserId)) {
        return;
    }
    await notificationRepository.addNotificationToDatabase({
        userId: currentUserId,
        notification
    });
}

async function persistV2Notification(notification) {
    const currentUserId = await ensureNotificationTables();
    if (!currentUserId) {
        return;
    }
    await notificationRepository.addNotificationV2ToDatabase({
        userId: currentUserId,
        notification
    });
}

async function expireNotificationById(id) {
    const currentUserId = await ensureNotificationTables();
    if (!id || !currentUserId) {
        return;
    }
    await notificationRepository.expireNotificationV2({
        userId: currentUserId,
        id
    });
    const row = useVrcNotificationStore
        .getState()
        .rows.find((entry) => entry.id === id);
    if (row && (!row.version || row.version < 2)) {
        await notificationRepository.updateNotificationExpired({
            userId: currentUserId,
            notification: {
                ...row,
                $isExpired: true
            }
        });
    }
}

async function markV2NotificationSeen(id) {
    const currentUserId = await ensureNotificationTables();
    if (!id || !currentUserId) {
        return;
    }
    await notificationRepository.seenNotificationV2({
        userId: currentUserId,
        id
    });
}

export async function handleRealtimeNotificationEvent(type, content) {
    const store = useVrcNotificationStore.getState();
    const auth = getCurrentAuth();

    switch (type) {
        case 'notification': {
            const notification = normalizeV1Notification(content);
            store.upsertNotification(notification);
            notifyNotificationMenu(notification);
            void deliverRuntimeNotification(notification).catch((error) => {
                console.warn('Failed to deliver runtime notification:', error);
            });
            await persistV1Notification(notification);
            return true;
        }
        case 'notification-v2': {
            const notification = normalizeV2Notification(
                content,
                auth.currentUserEndpoint
            );
            store.upsertNotification(notification);
            notifyNotificationMenu(notification);
            void deliverRuntimeNotification(notification).catch((error) => {
                console.warn('Failed to deliver runtime notification:', error);
            });
            await persistV2Notification(notification);
            return true;
        }
        case 'notification-v2-update': {
            const id = content?.id;
            if (!id) {
                return true;
            }
            const existing = store.rows.find((row) => row.id === id) || {};
            const notification = normalizeV2Notification(
                {
                    ...existing,
                    ...content.updates,
                    id
                },
                auth.currentUserEndpoint
            );
            store.upsertNotification(notification);
            notifyNotificationMenu(notification);
            await persistV2Notification(notification);
            if (notification.seen) {
                store.markNotificationsSeen(id);
                clearNotificationMenuIfNoUnseen();
            }
            return true;
        }
        case 'notification-v2-delete': {
            const ids = Array.isArray(content?.ids) ? content.ids : [];
            store.expireNotifications(ids);
            for (const id of ids) {
                await expireNotificationById(id);
                store.markNotificationsSeen(id);
            }
            clearNotificationMenuIfNoUnseen();
            return true;
        }
        case 'see-notification': {
            store.markNotificationsSeen(content);
            clearNotificationMenuIfNoUnseen();
            await markV2NotificationSeen(content);
            return true;
        }
        case 'hide-notification':
        case 'response-notification': {
            const id =
                typeof content === 'string' ? content : content?.notificationId;
            store.expireNotifications(id);
            await expireNotificationById(id);
            store.markNotificationsSeen(id);
            clearNotificationMenuIfNoUnseen();
            return true;
        }
        default:
            return false;
    }
}
