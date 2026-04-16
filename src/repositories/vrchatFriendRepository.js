import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';

const PAGE_SIZE = 50;
const MAX_OFFSET = 7500;

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

        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === null || item === undefined) {
                    continue;
                }
                url.searchParams.append(key, String(item));
            }
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url;
}

function buildUrl(path, params = {}, endpoint = '') {
    const baseUrl = normalizeEndpointDomain(endpoint).replace(/\/?$/, '/');
    const url = new URL(path, baseUrl);
    return appendParams(url, params).toString();
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

    return `VRChat friend request failed (${status})`;
}

function createFriendRequestError(message, status, path, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = path;
    error.payload = payload;
    return error;
}

function isValidFriendUser(user) {
    return Boolean(user && typeof user === 'object' && typeof user.id === 'string' && user.id.trim());
}

async function execute(path, { endpoint = '', method = 'GET', params = null } = {}) {
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

    const response = await webRepository.execute({
        ...requestOptions
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createFriendRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createFriendRequestError(
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

async function executeGet(path, params = {}, { endpoint = '' } = {}) {
    return execute(path, { endpoint, method: 'GET', params });
}

async function executeDelete(path, params = null, { endpoint = '' } = {}) {
    return execute(path, { endpoint, method: 'DELETE', params });
}

async function executePost(path, params = null, { endpoint = '' } = {}) {
    return execute(path, { endpoint, method: 'POST', params });
}

async function getFriends({ endpoint = '', offline = false, n = PAGE_SIZE, offset = 0 } = {}) {
    return executeGet(
        'auth/user/friends',
        {
            offline: Boolean(offline),
            n,
            offset
        },
        { endpoint }
    );
}

async function getAllFriends({ endpoint = '', offline = false } = {}) {
    const friends = [];

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getFriends({
            endpoint,
            offline,
            n: PAGE_SIZE,
            offset
        });
        const page = Array.isArray(response.json) ? response.json.filter(isValidFriendUser) : [];
        friends.push(...page);

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    return friends;
}

async function getUser({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.getUser requires a user id.');
    }

    return executeGet(`users/${encodeURIComponent(normalizedUserId)}`, {}, { endpoint });
}

async function deleteFriend({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.deleteFriend requires a user id.');
    }

    return executeDelete(
        `auth/user/friends/${encodeURIComponent(normalizedUserId)}`,
        null,
        { endpoint }
    );
}

async function sendFriendRequest({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.sendFriendRequest requires a user id.');
    }

    return executePost(
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`,
        null,
        { endpoint }
    );
}

async function cancelFriendRequest({ userId, notificationId = '', endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.cancelFriendRequest requires a user id.');
    }

    const params =
        typeof notificationId === 'string' && notificationId.trim()
            ? { notificationId: notificationId.trim() }
            : null;

    return executeDelete(
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`,
        params,
        { endpoint }
    );
}

const vrchatFriendRepository = Object.freeze({
    execute,
    executeGet,
    executeDelete,
    executePost,
    getFriends,
    getAllFriends,
    getUser,
    deleteFriend,
    sendFriendRequest,
    cancelFriendRequest
});

export {
    execute,
    executeGet,
    executeDelete,
    executePost,
    getFriends,
    getAllFriends,
    getUser,
    deleteFriend,
    sendFriendRequest,
    cancelFriendRequest
};
export default vrchatFriendRepository;
