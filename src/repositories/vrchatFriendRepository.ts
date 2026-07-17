import { commands } from '@/platform/tauri/bindings';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

const PAGE_SIZE = 50;

type FriendRecord = Record<string, unknown> & { id: string };

interface FriendsPageInput {
    endpoint?: string;
    offline?: boolean;
    n?: number;
    offset?: number;
}

interface FriendEndpointInput {
    userId?: unknown;
    endpoint?: string;
    isFriend?: boolean | null;
}

function isValidFriendUser(user: unknown): user is FriendRecord {
    return Boolean(
        user &&
        typeof user === 'object' &&
        'id' in user &&
        typeof user.id === 'string' &&
        user.id.trim()
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatFriendResponse<TJson = unknown>(
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
        json: json as TJson,
        status: response.status,
        raw: response.raw
    };
}

async function getFriends({
    endpoint = '',
    offline = false,
    n = PAGE_SIZE,
    offset = 0
}: FriendsPageInput = {}) {
    const response = await commands.appVrchatFriendsGet({
        endpoint,
        offline: Boolean(offline),
        n,
        offset
    });
    return unwrapVrchatFriendResponse<FriendRecord[]>(
        response,
        'auth/user/friends'
    );
}

async function getAllFriends({
    endpoint = '',
    offline = false
}: Pick<FriendsPageInput, 'endpoint' | 'offline'> = {}) {
    const friends: FriendRecord[] = [];

    for (let offset = 0; ; offset += PAGE_SIZE) {
        const response = await getFriends({
            endpoint,
            offline,
            n: PAGE_SIZE,
            offset
        });
        const rawPage = Array.isArray(response.json) ? response.json : [];
        const page = rawPage.filter(isValidFriendUser);
        friends.push(...page);

        if (!rawPage.length || rawPage.length < PAGE_SIZE) {
            break;
        }
    }

    return friends;
}

async function getUser({
    userId,
    endpoint = '',
    isFriend = null
}: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.getUser requires a user id.');
    }

    const response = await commands.appVrchatUserGet({
        userId: normalizedUserId,
        endpoint,
        isFriend
    });
    return unwrapVrchatFriendResponse<FriendRecord>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    );
}

async function getFriendStatus({ userId, endpoint = '' }: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.getFriendStatus requires a user id.'
        );
    }

    const response = await commands.appVrchatFriendStatusGet({
        userId: normalizedUserId,
        endpoint
    });
    return unwrapVrchatFriendResponse<Record<string, unknown>>(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendStatus`
    );
}

const vrchatFriendRepository = Object.freeze({
    getFriends,
    getAllFriends,
    getUser,
    getFriendStatus
});

export { getFriends, getAllFriends, getUser, getFriendStatus };
export default vrchatFriendRepository;
