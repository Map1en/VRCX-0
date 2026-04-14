import { safeJsonParse } from './baseRepository.js';
import configRepository from './configRepository.js';
import sqliteRepository from './sqliteRepository.js';
import userSessionRepository, { normalizeUserTablePrefix } from './userSessionRepository.js';
import webRepository from './webRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';

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
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeEndpointDomain(endpointDomain) {
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain.trim();
    }

    return DEFAULT_ENDPOINT_DOMAIN;
}

function appendParams(url, params) {
    if (!params || typeof params !== 'object') {
        return url;
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
            continue;
        }
        url.searchParams.set(key, String(value));
    }

    return url;
}

function buildUrl(path, params = {}, endpoint = '') {
    const baseUrl = normalizeEndpointDomain(endpoint).replace(/\/?$/, '/');
    return appendParams(new URL(path, baseUrl), params).toString();
}

function parseJsonResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

function unwrapErrorMessage(json, status) {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `VRChat notification request failed (${status})`;
}

function createNotificationError(message, status, path, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = path;
    error.payload = payload;
    return error;
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
    const responses = safeJsonParse(readColumn(row, 14, 'responses') || '[]', []);
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
    const query = String(search || '').trim().toLowerCase();
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
    ].some((value) => String(value || '').toLowerCase().includes(query));
}

function matchesFilters(notification, filters) {
    const normalizedFilters = Array.isArray(filters)
        ? filters.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    return !normalizedFilters.length || normalizedFilters.includes(notification.type);
}

class NotificationRepository {
    async executeApi(path, { endpoint = '', method = 'GET', params = null } = {}) {
        const requestOptions = {
            url: buildUrl(path, method === 'GET' ? params : {}, endpoint),
            method
        };

        if (method !== 'GET' && params !== null) {
            requestOptions.headers = {
                'Content-Type': 'application/json;charset=utf-8'
            };
            requestOptions.body = JSON.stringify(params ?? {});
        }

        const response = await webRepository.execute(requestOptions);
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createNotificationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createNotificationError(
                unwrapErrorMessage(json, response.status),
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

    async queryNotifications({ userId, search = '', filters = [] } = {}) {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) {
            return [];
        }

        await userSessionRepository.initUserTables(normalizedUserId);
        const userPrefix = normalizeUserTablePrefix(normalizedUserId);
        const [maxTableSize, searchLimit] = await Promise.all([
            configRepository.getInt('maxTableSize_v2', 500),
            configRepository.getInt('searchLimit', 50000)
        ]);
        const limit = search || (Array.isArray(filters) && filters.length) ? searchLimit : maxTableSize;

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
            if (!existing || Number(notification.version) >= Number(existing.version)) {
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

    async deleteNotification({ userId, id }) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        if (!normalizedUserId || !normalizedId) {
            return;
        }

        await userSessionRepository.initUserTables(normalizedUserId);
        const userPrefix = normalizeUserTablePrefix(normalizedUserId);
        await sqliteRepository.transaction(async (tx) => {
            await tx.executeNonQuery(`DELETE FROM ${userPrefix}_notifications WHERE id = @id`, {
                '@id': normalizedId
            });
            await tx.executeNonQuery(`DELETE FROM ${userPrefix}_notifications_v2 WHERE id = @id`, {
                '@id': normalizedId
            });
        });
    }

    async expireNotification({ userId, id }) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        if (!normalizedUserId || !normalizedId) {
            return;
        }

        await userSessionRepository.initUserTables(normalizedUserId);
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

    async markSeen({ userId, id, version, endpoint = '' }) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        if (!normalizedUserId || !normalizedId) {
            return;
        }

        if (Number(version) >= 2) {
            await this.executeApi(`notifications/${encodeURIComponent(normalizedId)}/see`, {
                endpoint,
                method: 'POST'
            });
        } else {
            await this.executeApi(
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

        await userSessionRepository.initUserTables(normalizedUserId);
        const userPrefix = normalizeUserTablePrefix(normalizedUserId);
        await sqliteRepository.executeNonQuery(
            `UPDATE ${userPrefix}_notifications_v2 SET seen = 1 WHERE id = @id`,
            {
                '@id': normalizedId
            }
        );
    }

    async markSeenLocalBulk({ userId, ids }) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedIds = (Array.isArray(ids) ? ids : [ids])
            .map((id) => (typeof id === 'string' ? id.trim() : String(id ?? '').trim()))
            .filter(Boolean);
        if (!normalizedUserId || !normalizedIds.length) {
            return;
        }

        await userSessionRepository.initUserTables(normalizedUserId);
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

    async acceptFriendRequest({ id, endpoint = '' }) {
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        if (!normalizedId) {
            return null;
        }

        return this.executeApi(
            `auth/user/notifications/${encodeURIComponent(normalizedId)}/accept`,
            {
                endpoint,
                method: 'PUT'
            }
        );
    }

    async hideRemoteNotification({ id, version, type = '', senderUserId = '', endpoint = '' }) {
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        const normalizedSenderUserId =
            typeof senderUserId === 'string' ? senderUserId.trim() : String(senderUserId ?? '').trim();
        if (!normalizedId) {
            return null;
        }

        if (type === 'ignoredFriendRequest' && normalizedSenderUserId) {
            return this.executeApi(
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
            return this.executeApi(`notifications/${encodeURIComponent(normalizedId)}`, {
                endpoint,
                method: 'DELETE'
            });
        }

        return this.executeApi(
            `auth/user/notifications/${encodeURIComponent(normalizedId)}/hide`,
            {
                endpoint,
                method: 'PUT'
            }
        );
    }

    async sendNotificationResponse({
        id,
        responseType,
        responseData = '',
        endpoint = ''
    } = {}) {
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        const normalizedResponseType =
            typeof responseType === 'string' ? responseType.trim() : String(responseType ?? '').trim();
        if (!normalizedId || !normalizedResponseType) {
            return null;
        }

        return this.executeApi(
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

    async sendInviteResponse({ id, responseSlot, endpoint = '' } = {}) {
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        const normalizedSlot = Number.parseInt(responseSlot, 10);
        if (!normalizedId || !Number.isFinite(normalizedSlot)) {
            return null;
        }

        return this.executeApi(
            `invite/${encodeURIComponent(normalizedId)}/response`,
            {
                endpoint,
                method: 'POST',
                params: {
                    responseSlot: normalizedSlot,
                    rsvp: true
                }
            }
        );
    }

    async sendInviteResponsePhoto({ id, responseSlot, imageData, endpoint = '' } = {}) {
        const normalizedId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
        const normalizedSlot = Number.parseInt(responseSlot, 10);
        const normalizedImageData =
            typeof imageData === 'string' ? imageData.trim() : String(imageData ?? '').trim();
        if (!normalizedId || !Number.isFinite(normalizedSlot) || !normalizedImageData) {
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
            throw createNotificationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createNotificationError(
                unwrapErrorMessage(json, response.status),
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

    async sendInvite({ receiverUserId, params = {}, endpoint = '' } = {}) {
        const normalizedReceiverUserId =
            typeof receiverUserId === 'string'
                ? receiverUserId.trim()
                : String(receiverUserId ?? '').trim();
        if (!normalizedReceiverUserId) {
            return null;
        }

        return this.executeApi(
            `invite/${encodeURIComponent(normalizedReceiverUserId)}`,
            {
                endpoint,
                method: 'POST',
                params
            }
        );
    }

    async sendRequestInvite({ receiverUserId, params = {}, endpoint = '' } = {}) {
        const normalizedReceiverUserId =
            typeof receiverUserId === 'string'
                ? receiverUserId.trim()
                : String(receiverUserId ?? '').trim();
        if (!normalizedReceiverUserId) {
            return null;
        }

        return this.executeApi(
            `requestInvite/${encodeURIComponent(normalizedReceiverUserId)}`,
            {
                endpoint,
                method: 'POST',
                params
            }
        );
    }

    async sendBoop({ userId, emojiId = '', endpoint = '' } = {}) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            return null;
        }

        const normalizedEmojiId =
            typeof emojiId === 'string' ? emojiId.trim() : String(emojiId ?? '').trim();
        return this.executeApi(
            `users/${encodeURIComponent(normalizedUserId)}/boop`,
            {
                endpoint,
                method: 'POST',
                params: normalizedEmojiId ? { emojiId: normalizedEmojiId } : {}
            }
        );
    }
}

const notificationRepository = new NotificationRepository();

export { NotificationRepository };
export default notificationRepository;
