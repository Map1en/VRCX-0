import { safeJsonParse } from './baseRepository.js';
import configRepository from './configRepository.js';
import sqliteRepository from './sqliteRepository.js';
import userSessionRepository, {
    normalizeUserTablePrefix
} from './userSessionRepository.js';
import {
    buildUrl,
    createRequestError,
    executeVrchatRequest,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest.js';
import webRepository from './webRepository.js';

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

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function readColumn(row, index, key) {
    if (Array.isArray(row)) {
        return row[index];
    }

    if (row && typeof row === 'object') {
        return row[key] ?? row[index];
    }

    return null;
}

function normalizeV1Notification(row) {
    const details = {
        worldId: readColumn(row, 7, 'world_id') || '',
        worldName: readColumn(row, 8, 'world_name') || '',
        imageUrl: readColumn(row, 9, 'image_url') || '',
        inviteMessage: readColumn(row, 10, 'invite_message') || '',
        requestMessage: readColumn(row, 11, 'request_message') || '',
        responseMessage: readColumn(row, 12, 'response_message') || ''
    };

    return {
        id: readColumn(row, 0, 'id') || '',
        version: 1,
        createdAt: readColumn(row, 1, 'created_at') || '',
        created_at: readColumn(row, 1, 'created_at') || '',
        type: readColumn(row, 2, 'type') || '',
        senderUserId: readColumn(row, 3, 'sender_user_id') || '',
        senderUsername: readColumn(row, 4, 'sender_username') || '',
        receiverUserId: readColumn(row, 5, 'receiver_user_id') || '',
        message: readColumn(row, 6, 'message') || '',
        title: '',
        imageUrl: details.imageUrl,
        link: '',
        linkText: '',
        seen: false,
        expired: Number(readColumn(row, 13, 'expired')) === 1,
        data: {},
        responses: [],
        details
    };
}

function isExpiredTimestamp(value) {
    if (!value) {
        return false;
    }
    const expiresAt = Date.parse(value);
    return Number.isFinite(expiresAt) ? expiresAt <= Date.now() : false;
}

function normalizeV2Notification(row) {
    const data = safeJsonParse(readColumn(row, 13, 'data') || '{}', {});
    const responses = safeJsonParse(
        readColumn(row, 14, 'responses') || '[]',
        []
    );
    const details = safeJsonParse(readColumn(row, 15, 'details') || '{}', {});

    return {
        id: readColumn(row, 0, 'id') || '',
        version: 2,
        createdAt: readColumn(row, 1, 'created_at') || '',
        created_at: readColumn(row, 1, 'created_at') || '',
        updatedAt: readColumn(row, 2, 'updated_at') || '',
        expiresAt: readColumn(row, 3, 'expires_at') || '',
        type: readColumn(row, 4, 'type') || '',
        link: readColumn(row, 5, 'link') || '',
        linkText: readColumn(row, 6, 'link_text') || '',
        message: readColumn(row, 7, 'message') || '',
        title: readColumn(row, 8, 'title') || '',
        imageUrl: readColumn(row, 9, 'image_url') || '',
        seen: Number(readColumn(row, 10, 'seen')) === 1,
        senderUserId: readColumn(row, 11, 'sender_user_id') || '',
        senderUsername: readColumn(row, 12, 'sender_username') || '',
        data,
        responses: Array.isArray(responses) ? responses : [],
        details: details && typeof details === 'object' ? details : {},
        expired: isExpiredTimestamp(readColumn(row, 3, 'expires_at'))
    };
}

function matchesSearch(notification, search) {
    const query = String(search || '')
        .trim()
        .toLowerCase();
    if (!query) {
        return true;
    }

    return [
        notification.type,
        notification.senderUsername,
        notification.senderUserId,
        notification.title,
        notification.message,
        notification.linkText,
        notification.link,
        notification.details?.worldName,
        notification.details?.worldId,
        notification.details?.inviteMessage,
        notification.details?.requestMessage,
        notification.details?.responseMessage,
        notification.data?.groupName
    ].some((value) =>
        String(value || '')
            .toLowerCase()
            .includes(query)
    );
}

function matchesFilters(notification, filters) {
    const normalizedFilters = Array.isArray(filters)
        ? filters.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    return (
        !normalizedFilters.length ||
        normalizedFilters.includes(notification.type)
    );
}

async function executeApi(
    path,
    { endpoint = '', method = 'GET', params = null } = {}
) {
    return executeVrchatRequest(path, {
        endpoint,
        method,
        params,
        body: params,
        jsonBody: params !== null,
        fallbackMessage: 'VRChat notification request failed'
    });
}

async function queryNotifications({ userId, search = '', filters = [] } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return [];
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    const [maxTableSize, searchLimit] = await Promise.all([
        configRepository.getInt('maxTableSize_v2', 500),
        configRepository.getInt('searchLimit', 50000)
    ]);
    const limit =
        search || (Array.isArray(filters) && filters.length)
            ? searchLimit
            : maxTableSize;

    const [v1Rows, v2Rows] = await Promise.all([
        sqliteRepository.query(
            `SELECT * FROM ${userPrefix}_notifications ORDER BY created_at DESC`
        ),
        sqliteRepository.query(
            `SELECT * FROM ${userPrefix}_notifications_v2 ORDER BY created_at DESC`
        )
    ]);

    const deduped = new Map();
    for (const notification of [
        ...(Array.isArray(v1Rows) ? v1Rows.map(normalizeV1Notification) : []),
        ...(Array.isArray(v2Rows) ? v2Rows.map(normalizeV2Notification) : [])
    ]) {
        if (!notification.id) {
            continue;
        }
        const existing = deduped.get(notification.id);
        if (
            !existing ||
            Number(notification.version) >= Number(existing.version)
        ) {
            deduped.set(notification.id, notification);
        }
    }

    return Array.from(deduped.values())
        .filter((notification) => notification.id)
        .filter((notification) => matchesFilters(notification, filters))
        .filter((notification) => matchesSearch(notification, search))
        .sort((left, right) => {
            const leftTime = new Date(left.createdAt || 0).valueOf() || 0;
            const rightTime = new Date(right.createdAt || 0).valueOf() || 0;
            if (leftTime !== rightTime) {
                return rightTime - leftTime;
            }
            return String(right.id).localeCompare(String(left.id));
        })
        .slice(0, limit);
}

async function addNotificationToDatabase({ userId, notification } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    const entry = {
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

    await sqliteRepository.executeNonQuery(
        `INSERT OR IGNORE INTO ${userPrefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @expired)`,
        {
            '@id': entry.id,
            '@created_at': entry.created_at,
            '@type': entry.type,
            '@sender_user_id': entry.senderUserId,
            '@sender_username': entry.senderUsername,
            '@receiver_user_id': entry.receiverUserId,
            '@message': entry.message,
            '@world_id': entry.details.worldId,
            '@world_name': entry.details.worldName,
            '@image_url': entry.details.imageUrl,
            '@invite_message': entry.details.inviteMessage,
            '@request_message': entry.details.requestMessage,
            '@response_message': entry.details.responseMessage,
            '@expired': entry.$isExpired ? 1 : 0
        }
    );
}

async function addNotificationV2ToDatabase({ userId, notification } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !notification?.id) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO ${userPrefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details)`,
        {
            '@id': notification.id,
            '@created_at': notification.createdAt,
            '@updated_at': notification.updatedAt,
            '@expires_at': notification.expiresAt,
            '@type': notification.type,
            '@link': notification.link,
            '@link_text': notification.linkText,
            '@message': notification.message,
            '@title': notification.title,
            '@image_url': notification.imageUrl,
            '@seen': notification.seen ? 1 : 0,
            '@sender_user_id': notification.senderUserId,
            '@sender_username': notification.senderUsername,
            '@data': JSON.stringify(notification.data || {}),
            '@responses': JSON.stringify(notification.responses || []),
            '@details': JSON.stringify(notification.details || {})
        }
    );
}

async function expireNotificationV2({ userId, id } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId = normalizeUserId(id);
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.executeNonQuery(
        `UPDATE ${userPrefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id`,
        {
            '@id': normalizedId,
            '@expires_at': new Date().toJSON()
        }
    );
}

async function seenNotificationV2({ userId, id } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId = normalizeUserId(id);
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.executeNonQuery(
        `UPDATE ${userPrefix}_notifications_v2 SET seen = 1 WHERE id = @id`,
        {
            '@id': normalizedId
        }
    );
}

async function updateNotificationExpired({ userId, notification } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !notification?.id) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.executeNonQuery(
        `UPDATE ${userPrefix}_notifications SET expired = @expired WHERE id = @id`,
        {
            '@id': notification.id,
            '@expired': notification.$isExpired ? 1 : 0
        }
    );
}

async function deleteNotification({ userId, id }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.transaction(async (tx) => {
        await tx.executeNonQuery(
            `DELETE FROM ${userPrefix}_notifications WHERE id = @id`,
            {
                '@id': normalizedId
            }
        );
        await tx.executeNonQuery(
            `DELETE FROM ${userPrefix}_notifications_v2 WHERE id = @id`,
            {
                '@id': normalizedId
            }
        );
    });
}

async function expireNotification({ userId, id }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    const now = new Date().toJSON();
    await sqliteRepository.transaction(async (tx) => {
        await tx.executeNonQuery(
            `UPDATE ${userPrefix}_notifications SET expired = 1 WHERE id = @id`,
            {
                '@id': normalizedId
            }
        );
        await tx.executeNonQuery(
            `UPDATE ${userPrefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id`,
            {
                '@id': normalizedId,
                '@expires_at': now
            }
        );
    });
}

async function markSeen({ userId, id, version, endpoint = '' }) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedUserId || !normalizedId) {
        return;
    }

    if (Number(version) >= 2) {
        await executeApi(
            `notifications/${encodeURIComponent(normalizedId)}/see`,
            {
                endpoint,
                method: 'POST'
            }
        );
    } else {
        await executeApi(
            `auth/user/notifications/${encodeURIComponent(normalizedId)}/see`,
            {
                endpoint,
                method: 'PUT'
            }
        );
    }

    if (Number(version) !== 2) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.executeNonQuery(
        `UPDATE ${userPrefix}_notifications_v2 SET seen = 1 WHERE id = @id`,
        {
            '@id': normalizedId
        }
    );
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

    await userSessionRepository.ensureUserTables(normalizedUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedUserId);
    await sqliteRepository.transaction(async (tx) => {
        for (const id of normalizedIds) {
            await tx.executeNonQuery(
                `UPDATE ${userPrefix}_notifications_v2 SET seen = 1 WHERE id = @id`,
                {
                    '@id': id
                }
            );
        }
    });
}

async function acceptFriendRequest({ id, endpoint = '' }) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    if (!normalizedId) {
        return null;
    }

    return executeApi(
        `auth/user/notifications/${encodeURIComponent(normalizedId)}/accept`,
        {
            endpoint,
            method: 'PUT'
        }
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

    if (type === 'ignoredFriendRequest' && normalizedSenderUserId) {
        return executeApi(
            `user/${encodeURIComponent(normalizedSenderUserId)}/friendRequest`,
            {
                endpoint,
                method: 'DELETE',
                params: {
                    notificationId: normalizedId
                }
            }
        );
    }

    if (Number(version) >= 2) {
        return executeApi(`notifications/${encodeURIComponent(normalizedId)}`, {
            endpoint,
            method: 'DELETE'
        });
    }

    return executeApi(
        `auth/user/notifications/${encodeURIComponent(normalizedId)}/hide`,
        {
            endpoint,
            method: 'PUT'
        }
    );
}

async function sendNotificationResponse({
    id,
    responseType,
    responseData = '',
    endpoint = ''
} = {}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedResponseType =
        typeof responseType === 'string'
            ? responseType.trim()
            : String(responseType ?? '').trim();
    if (!normalizedId || !normalizedResponseType) {
        return null;
    }

    return executeApi(
        `notifications/${encodeURIComponent(normalizedId)}/respond`,
        {
            endpoint,
            method: 'POST',
            params: {
                notificationId: normalizedId,
                responseType: normalizedResponseType,
                responseData: responseData ?? ''
            }
        }
    );
}

async function sendInviteResponse({ id, responseSlot, endpoint = '' } = {}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedSlot = Number.parseInt(responseSlot, 10);
    if (!normalizedId || !Number.isFinite(normalizedSlot)) {
        return null;
    }

    return executeApi(`invite/${encodeURIComponent(normalizedId)}/response`, {
        endpoint,
        method: 'POST',
        params: {
            responseSlot: normalizedSlot,
            rsvp: true
        }
    });
}

async function sendInviteResponsePhoto({
    id,
    responseSlot,
    imageData,
    endpoint = ''
} = {}) {
    const normalizedId =
        typeof id === 'string' ? id.trim() : String(id ?? '').trim();
    const normalizedSlot = Number.parseInt(responseSlot, 10);
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
    const response = await webRepository.execute({
        url: buildUrl(path, {}, endpoint),
        uploadImageLegacy: true,
        postData: JSON.stringify({
            responseSlot: normalizedSlot,
            rsvp: true
        }),
        imageData: normalizedImageData
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat notification request failed'
            }),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat notification request failed'
            }),
            response.status,
            path,
            json
        );
    }

    return {
        json,
        status: response.status,
        raw: response.raw
    };
}

async function sendInvite({ receiverUserId, params = {}, endpoint = '' } = {}) {
    const normalizedReceiverUserId =
        typeof receiverUserId === 'string'
            ? receiverUserId.trim()
            : String(receiverUserId ?? '').trim();
    if (!normalizedReceiverUserId) {
        return null;
    }

    return executeApi(
        `invite/${encodeURIComponent(normalizedReceiverUserId)}`,
        {
            endpoint,
            method: 'POST',
            params
        }
    );
}

async function sendRequestInvite({
    receiverUserId,
    params = {},
    endpoint = ''
} = {}) {
    const normalizedReceiverUserId =
        typeof receiverUserId === 'string'
            ? receiverUserId.trim()
            : String(receiverUserId ?? '').trim();
    if (!normalizedReceiverUserId) {
        return null;
    }

    return executeApi(
        `requestInvite/${encodeURIComponent(normalizedReceiverUserId)}`,
        {
            endpoint,
            method: 'POST',
            params
        }
    );
}

async function sendBoop({ userId, emojiId = '', endpoint = '' } = {}) {
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
    return executeApi(`users/${encodeURIComponent(normalizedUserId)}/boop`, {
        endpoint,
        method: 'POST',
        params: normalizedEmojiId ? { emojiId: normalizedEmojiId } : {}
    });
}

const notificationRepository = Object.freeze({
    addNotificationToDatabase,
    addNotificationV2ToDatabase,
    executeApi,
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
    executeApi,
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
