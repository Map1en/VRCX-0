import { commands } from '@/platform/tauri/bindings';

import { unwrapVrchatResponse } from './vrchatRequest';

const PAGE_SIZE = 50;

type FriendRecord = Record<string, unknown> & { id: string };

interface FriendsPageInput {
    offline?: boolean;
    n?: number;
    offset?: number;
}

interface FriendEndpointInput {
    userId?: unknown;
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

function unwrapVrchatFriendResponse<TJson = unknown>(
    response: { status: number; data: unknown },
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat friend request failed'
    });
}

async function getFriends({
    offline = false,
    n = PAGE_SIZE,
    offset = 0
}: FriendsPageInput = {}) {
    const response = await commands.appVrchatFriendsGet({
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
    offline = false
}: Pick<FriendsPageInput, 'offline'> = {}) {
    const friends: FriendRecord[] = [];

    for (let offset = 0; ; offset += PAGE_SIZE) {
        const response = await getFriends({
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

async function getUser({ userId, isFriend = null }: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.getUser requires a user id.');
    }

    const response = await commands.appVrchatUserGet({
        userId: normalizedUserId,
        isFriend
    });
    return unwrapVrchatFriendResponse<FriendRecord>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    );
}

async function getFriendStatus({ userId }: FriendEndpointInput) {
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
        userId: normalizedUserId
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
