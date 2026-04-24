import { executeVrchatRequest } from './vrchatRequest.js';

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
    return executeVrchatRequest(path, {
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

    return executeDelete(
        `auth/user/friends/${encodeURIComponent(normalizedUserId)}`,
        null,
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

    return executePost(
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`,
        null,
        { endpoint }
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
