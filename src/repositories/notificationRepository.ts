import { backend } from '@/platform/index.js';

import configRepository from './configRepository.js';
import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    type QueryParams,
    unwrapErrorMessage
} from './vrchatRequest.js';

type NotificationRecord = Record<string, any>;

interface NotificationUserOptions {
    userId?: unknown;
}

interface NotificationActionOptions {
    id?: unknown;
    responseSlot?: unknown;
    responseType?: unknown;
    responseData?: unknown;
    imageData?: unknown;
    receiverUserId?: unknown;
    userId?: unknown;
    emojiId?: unknown;
    params?: QueryParams;
    endpoint?: string;
}

export const NOTIFICATION_TYPES = Object.freeze([
    'requestInvite',
    'invite',
    'requestInviteResponse',
    'inviteResponse',
    'friendRequest',
    'ignoredFriendRequest',
    'message',
    'boop',
    'event.announcement',
    'groupChange',
    'group.announcement',
    'group.informative',
    'group.invite',
    'group.joinRequest',
    'group.transfer',
    'group.queueReady',
    'moderation.warning.group',
    'moderation.report.closed',
    'moderation.contentrestriction',
    'instance.closed',
    'economy.alert'
]);

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeNotificationFilters(filters: unknown): string[] {
    return Array.isArray(filters)
        ? filters.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
}

function normalizeNotificationLimit(value: unknown, fallback: number): number {
    const limit = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(limit) && limit > 0 ? limit : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendNotificationResponse(
    response: { status: number; data: unknown; raw: unknown },
    path: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat notification request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json,
        status: response.status,
        raw: response.raw
    };
}

async function queryNotifications({
    userId,
    search = '',
    filters = []
}: NotificationUserOptions & {
    search?: string;
    filters?: unknown[];
} = {}): Promise<NotificationRecord[]> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return [];
    }

    const normalizedSearch = String(search || '').trim();
    const normalizedFilters = normalizeNotificationFilters(filters);
    const [maxTableSize, searchLimit] = await Promise.all([
        configRepository.getInt('maxTableSize_v2', 500),
        configRepository.getInt('searchLimit', 50000)
    ]);
    const isSearchOrFiltered =
        Boolean(normalizedSearch) || normalizedFilters.length > 0;
    const limit = isSearchOrFiltered
        ? normalizeNotificationLimit(searchLimit, 50000)
        : normalizeNotificationLimit(maxTableSize, 500);
    const perTableLimit = isSearchOrFiltered ? limit : limit * 2;
    const isDefaultList = !normalizedSearch && normalizedFilters.length === 0;
    const rows = await backend.app.NotificationListQuery({
        query: {
            userId: normalizedUserId,
            search: normalizedSearch,
            filters: normalizedFilters,
            perTableLimit,
            limit,
            includeUnseen: isDefaultList
        }
    });
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
}

async function addNotificationToDatabase({
    userId,
    notification
}: NotificationUserOptions & { notification?: NotificationRecord } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }

    const entry: NotificationRecord = {
        id: '',
        created_at: '',
        type: '',
        senderUserId: '',
        senderUsername: '',
        receiverUserId: '',
        message: '',
        ...(notification || {}),
        details: {
            worldId: '',
            worldName: '',
            imageUrl: '',
            inviteMessage: '',
            requestMessage: '',
            responseMessage: '',
            ...(notification?.details || {})
        }
    };
    if (entry.imageUrl && !entry.details.imageUrl) {
        entry.details.imageUrl = entry.imageUrl;
    }
    if (!entry.created_at || !entry.type || !entry.id) {
        throw new Error('Notification is missing required field');
    }

    await backend.app.NotificationAddV1({
        userId: normalizedUserId,
        notification: entry
    });
}

async function addNotificationV2ToDatabase({
    userId,
    notification
}: NotificationUserOptions & { notification?: NotificationRecord } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !notification?.id) {
        return;
    }

    await backend.app.NotificationAddV2({
        userId: normalizedUserId,
        notification
    });
}

async function expireNotificationV2({
    userId,
    id
}: NotificationUserOptions & { id?: unknown } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId = normalizeUserId(id);
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await backend.app.NotificationV2Expire({
        userId: normalizedUserId,
        id: normalizedId
    });
}

async function seenNotificationV2({
    userId,
    id
}: NotificationUserOptions & { id?: unknown } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId = normalizeUserId(id);
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await backend.app.NotificationV2MarkSeen({
        userId: normalizedUserId,
        id: normalizedId
    });
}

async function updateNotificationExpired({
    userId,
    notification
}: NotificationUserOptions & { notification?: NotificationRecord } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !notification?.id) {
        return;
    }

    await backend.app.NotificationUpdateExpired({
        userId: normalizedUserId,
        id: notification.id,
        expired: Boolean(notification.$isExpired)
    });
}

async function deleteNotification({ userId, id }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await backend.app.NotificationDelete({
        userId: normalizedUserId,
        id: normalizedId
    });
}

async function expireNotification({ userId, id }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await backend.app.NotificationExpire({
        userId: normalizedUserId,
        id: normalizedId
    });
}

async function markSeen({ userId, id, version, endpoint = '' }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    const numericVersion = Number(version) || 0;
    const response = await backend.app.BackendNotificationMarkSeen({
        userId: normalizedUserId,
        id: normalizedId,
        version: numericVersion,
        endpoint
    });
    const path =
        numericVersion >= 2
            ? `notifications/${encodeURIComponent(normalizedId)}/see`
            : `auth/user/notifications/${encodeURIComponent(normalizedId)}/see`;
    unwrapBackendNotificationResponse(response, path);
}

async function markSeenLocalBulk({ userId, ids }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedIds = (Array.isArray(ids) ? ids : [ids])
        .map((id) =>
            typeof id === 'string' ? id.trim() : String(id ?? '').trim()
        )
        .filter(Boolean);
    if (!normalizedUserId || !normalizedIds.length) {
        return;
    }

    await backend.app.NotificationMarkSeenLocalBulk({
        userId: normalizedUserId,
        ids: normalizedIds
    });
}

async function acceptFriendRequest({ id, endpoint = '' }) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedId) {
        return null;
    }

    const response = await backend.app.BackendNotificationAcceptFriendRequest({
        id: normalizedId,
        endpoint
    });
    return unwrapBackendNotificationResponse(
        response,
        `auth/user/notifications/${encodeURIComponent(normalizedId)}/accept`
    );
}

async function hideRemoteNotification({
    id,
    version,
    type = '',
    senderUserId = '',
    endpoint = ''
}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedSenderUserId =
        typeof senderUserId === 'string'
            ? senderUserId.trim()
            : String(senderUserId ?? '').trim();
    if (!normalizedId) {
        return null;
    }

    const response = await backend.app.BackendNotificationHideRemote({
        id: normalizedId,
        version: Number(version) || 0,
        type,
        senderUserId: normalizedSenderUserId,
        endpoint
    });
    const path =
        type === 'ignoredFriendRequest' && normalizedSenderUserId
            ? `user/${encodeURIComponent(normalizedSenderUserId)}/friendRequest`
            : Number(version) >= 2
              ? `notifications/${encodeURIComponent(normalizedId)}`
              : `auth/user/notifications/${encodeURIComponent(normalizedId)}/hide`;
    return unwrapBackendNotificationResponse(response, path);
}

async function sendNotificationResponse({
    id,
    responseType,
    responseData = '',
    endpoint = ''
}: NotificationActionOptions = {}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedResponseType =
        typeof responseType === 'string'
            ? responseType.trim()
            : String(responseType ?? '').trim();
    if (!normalizedId || !normalizedResponseType) {
        return null;
    }

    const response = await backend.app.BackendNotificationRespond({
        id: normalizedId,
        responseType: normalizedResponseType,
        responseData: responseData ?? '',
        endpoint
    });
    return unwrapBackendNotificationResponse(
        response,
        `notifications/${encodeURIComponent(normalizedId)}/respond`
    );
}

async function sendInviteResponse({
    id,
    responseSlot,
    endpoint = ''
}: NotificationActionOptions = {}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedSlot = Number.parseInt(String(responseSlot), 10);
    if (!normalizedId || !Number.isFinite(normalizedSlot)) {
        return null;
    }

    const response = await backend.app.BackendInviteResponseSend({
        id: normalizedId,
        responseSlot: normalizedSlot,
        endpoint
    });
    return unwrapBackendNotificationResponse(
        response,
        `invite/${encodeURIComponent(normalizedId)}/response`
    );
}

async function sendInviteResponsePhoto({
    id,
    responseSlot,
    imageData,
    endpoint = ''
}: NotificationActionOptions = {}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedSlot = Number.parseInt(String(responseSlot), 10);
    const normalizedImageData =
        typeof imageData === 'string'
            ? imageData.trim()
            : String(imageData ?? '').trim();
    if (
        !normalizedId ||
        !Number.isFinite(normalizedSlot) ||
        !normalizedImageData
    ) {
        return null;
    }

    const path = `invite/${encodeURIComponent(normalizedId)}/response/photo`;
    const response = await backend.app.BackendInviteResponsePhotoSend({
        id: normalizedId,
        responseSlot: normalizedSlot,
        imageData: normalizedImageData,
        endpoint
    });
    return unwrapBackendNotificationResponse(response, path);
}

async function sendInvite({
    receiverUserId,
    params = {},
    endpoint = ''
}: NotificationActionOptions = {}) {
    const normalizedReceiverUserId =
        typeof receiverUserId === 'string'
            ? receiverUserId.trim()
            : String(receiverUserId ?? '').trim();
    if (!normalizedReceiverUserId) {
        return null;
    }

    const response = await backend.app.BackendInviteSend({
        receiverUserId: normalizedReceiverUserId,
        params,
        endpoint
    });
    return unwrapBackendNotificationResponse(
        response,
        `invite/${encodeURIComponent(normalizedReceiverUserId)}`
    );
}

async function sendRequestInvite({
    receiverUserId,
    params = {},
    endpoint = ''
}: NotificationActionOptions = {}) {
    const normalizedReceiverUserId =
        typeof receiverUserId === 'string'
            ? receiverUserId.trim()
            : String(receiverUserId ?? '').trim();
    if (!normalizedReceiverUserId) {
        return null;
    }

    const response = await backend.app.BackendRequestInviteSend({
        receiverUserId: normalizedReceiverUserId,
        params,
        endpoint
    });
    return unwrapBackendNotificationResponse(
        response,
        `requestInvite/${encodeURIComponent(normalizedReceiverUserId)}`
    );
}

async function sendBoop({
    userId,
    emojiId = '',
    endpoint = ''
}: NotificationActionOptions = {}) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        return null;
    }

    const normalizedEmojiId =
        typeof emojiId === 'string'
            ? emojiId.trim()
            : String(emojiId ?? '').trim();
    const response = await backend.app.BackendBoopSend({
        userId: normalizedUserId,
        emojiId: normalizedEmojiId,
        endpoint
    });
    return unwrapBackendNotificationResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/boop`
    );
}

const notificationRepository = Object.freeze({
    addNotificationToDatabase,
    addNotificationV2ToDatabase,
    expireNotificationV2,
    queryNotifications,
    deleteNotification,
    expireNotification,
    markSeen,
    markSeenLocalBulk,
    acceptFriendRequest,
    hideRemoteNotification,
    sendNotificationResponse,
    sendInviteResponse,
    sendInviteResponsePhoto,
    sendInvite,
    sendRequestInvite,
    sendBoop,
    seenNotificationV2,
    updateNotificationExpired
});

export {
    addNotificationToDatabase,
    addNotificationV2ToDatabase,
    expireNotificationV2,
    queryNotifications,
    deleteNotification,
    expireNotification,
    markSeen,
    markSeenLocalBulk,
    acceptFriendRequest,
    hideRemoteNotification,
    sendNotificationResponse,
    sendInviteResponse,
    sendInviteResponsePhoto,
    sendInvite,
    sendRequestInvite,
    sendBoop,
    seenNotificationV2,
    updateNotificationExpired
};
export default notificationRepository;
