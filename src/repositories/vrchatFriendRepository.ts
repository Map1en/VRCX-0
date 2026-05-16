import { backend } from '@/platform/index.js';

import {
    createRequestError,
    executeVrchatBackendRequest,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest.js';

const PAGE_SIZE = 50;
const MAX_OFFSET = 7500;

function isValidFriendUser(user) {
    return Boolean(
        user &&
        typeof user === 'object' &&
        typeof user.id === 'string' &&
        user.id.trim()
    );
}

async function execute(
    path,
    { endpoint = '', method = 'GET', params = null } = {}
) {
    return executeVrchatBackendRequest('VrchatFriendExecute', path, {
        endpoint,
        method,
        params,
        body: params,
        jsonBody: method !== 'GET' && params !== null,
        fallbackMessage: 'VRChat friend request failed'
    });
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendFriendResponse(
    response: { status: number; data: unknown; raw: unknown },
    path: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat friend request failed'
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

async function getFriends({
    endpoint = '',
    offline = false,
    n = PAGE_SIZE,
    offset = 0
} = {}) {
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
        const page = Array.isArray(response.json)
            ? response.json.filter(isValidFriendUser)
            : [];
        friends.push(...page);

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    return friends;
}

async function getUser({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.getUser requires a user id.');
    }

    return executeGet(
        `users/${encodeURIComponent(normalizedUserId)}`,
        {},
        { endpoint }
    );
}

async function deleteFriend({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.deleteFriend requires a user id.'
        );
    }

    const response = await backend.app.BackendFriendDelete({
        userId: normalizedUserId,
        endpoint
    });
    return unwrapBackendFriendResponse(
        response,
        `auth/user/friends/${encodeURIComponent(normalizedUserId)}`
    );
}

async function getFriendStatus({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.getFriendStatus requires a user id.'
        );
    }

    return executeGet(
        `user/${encodeURIComponent(normalizedUserId)}/friendStatus`,
        {},
        { endpoint }
    );
}

async function sendFriendRequest({ userId, endpoint = '' }) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.sendFriendRequest requires a user id.'
        );
    }

    const response = await backend.app.BackendFriendRequestSend({
        userId: normalizedUserId,
        endpoint
    });
    return unwrapBackendFriendResponse(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`
    );
}

async function cancelFriendRequest({
    userId,
    notificationId = '',
    endpoint = ''
}) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.cancelFriendRequest requires a user id.'
        );
    }

    const params =
        typeof notificationId === 'string' && notificationId.trim()
            ? { notificationId: notificationId.trim() }
            : null;

    const response = await backend.app.BackendFriendRequestCancel({
        userId: normalizedUserId,
        notificationId: params?.notificationId || '',
        endpoint
    });
    return unwrapBackendFriendResponse(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`
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
    getFriendStatus,
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
    getFriendStatus,
    sendFriendRequest,
    cancelFriendRequest
};
export default vrchatFriendRepository;
