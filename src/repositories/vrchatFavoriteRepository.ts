import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';

import { executeVrchatBackendRequest } from './vrchatRequest.js';

const FAVORITES_PAGE_SIZE = 300;
const FAVORITE_GROUPS_PAGE_SIZE = 50;
const FAVORITE_DETAIL_PAGE_SIZE = 300;

type RequestOptions = {
    endpoint?: string;
};
type RequestParams = Record<string, string | number | boolean | undefined>;
type RequestPayload = Record<string, unknown>;

interface FavoritePagingInput extends RequestOptions {
    n?: number;
    offset?: number;
}

interface FavoriteWorldsInput extends FavoritePagingInput {
    ownerId?: string;
    userId?: string;
    tag?: string;
}

interface FavoriteAvatarsInput extends FavoritePagingInput {
    tag?: string;
}

interface FavoriteGroupsInput extends FavoritePagingInput {
    ownerId?: string;
}

interface FavoriteMutationInput extends RequestOptions {
    type?: unknown;
    favoriteId?: unknown;
    tags?: unknown;
}

interface DeleteFavoriteInput extends RequestOptions {
    objectId?: unknown;
}

interface FavoriteGroupMutationInput extends RequestOptions {
    ownerId?: unknown;
    type?: unknown;
    group?: unknown;
    displayName?: unknown;
    visibility?: unknown;
}

async function executeGet(
    path: string,
    params: RequestParams = {},
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatFavoriteExecute', path, {
        endpoint,
        method: 'GET',
        params,
        fallbackMessage: 'VRChat favorite request failed'
    });
}

async function executePost(
    path: string,
    payload: RequestPayload = {},
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatFavoriteExecute', path, {
        endpoint,
        method: 'POST',
        body: payload,
        fallbackMessage: 'VRChat favorite request failed'
    });
}

async function executePut(
    path: string,
    payload: RequestPayload = {},
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatFavoriteExecute', path, {
        endpoint,
        method: 'PUT',
        body: payload,
        fallbackMessage: 'VRChat favorite request failed'
    });
}

async function executeDelete(
    path: string,
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatFavoriteExecute', path, {
        endpoint,
        method: 'DELETE',
        jsonBody: false,
        fallbackMessage: 'VRChat favorite request failed'
    });
}

async function getFavoriteLimits({
    endpoint = '',
    force = false
}: RequestOptions & { force?: boolean } = {}) {
    return fetchCachedData({
        queryKey: queryKeys.favoriteLimits(endpoint),
        policy: entityQueryPolicies.favoriteLimits,
        force,
        queryFn: () => executeGet('auth/user/favoritelimits', {}, { endpoint })
    });
}

async function getFavorites({
    endpoint = '',
    n = FAVORITES_PAGE_SIZE,
    offset = 0
}: FavoritePagingInput = {}) {
    return executeGet(
        'favorites',
        {
            n,
            offset
        },
        { endpoint }
    );
}

async function getAllFavorites({ endpoint = '' }: RequestOptions = {}) {
    const favorites = [];

    for (let offset = 0; ; offset += FAVORITES_PAGE_SIZE) {
        const response = await getFavorites({
            endpoint,
            n: FAVORITES_PAGE_SIZE,
            offset
        });
        const page = Array.isArray(response.json) ? response.json : [];
        favorites.push(...page);

        if (page.length < FAVORITES_PAGE_SIZE) {
            break;
        }
    }

    return favorites;
}

async function addFavorite({
    endpoint = '',
    type,
    favoriteId,
    tags
}: FavoriteMutationInput = {}) {
    return executePost(
        'favorites',
        {
            type,
            favoriteId,
            tags
        },
        { endpoint }
    );
}

async function deleteFavorite({
    endpoint = '',
    objectId
}: DeleteFavoriteInput = {}) {
    const normalizedObjectId =
        typeof objectId === 'string'
            ? objectId.trim()
            : String(objectId ?? '').trim();
    if (!normalizedObjectId) {
        throw new Error(
            'VrchatFavoriteRepository.deleteFavorite requires an object id.'
        );
    }

    return executeDelete(
        `favorites/${encodeURIComponent(normalizedObjectId)}`,
        { endpoint }
    );
}

async function getFavoriteWorlds({
    endpoint = '',
    n = FAVORITE_DETAIL_PAGE_SIZE,
    offset = 0,
    ownerId = '',
    userId = '',
    tag = ''
}: FavoriteWorldsInput = {}) {
    const params: RequestParams = { n, offset };
    if (ownerId) {
        params.ownerId = ownerId;
    }
    if (userId) {
        params.userId = userId;
    }
    if (tag) {
        params.tag = tag;
    }

    return executeGet('worlds/favorites', params, { endpoint });
}

async function getAllFavoriteWorlds({
    endpoint = '',
    ownerId = '',
    userId = '',
    tag = ''
}: FavoriteWorldsInput = {}) {
    const worlds = [];

    for (let offset = 0; ; offset += FAVORITE_DETAIL_PAGE_SIZE) {
        const response = await getFavoriteWorlds({
            endpoint,
            n: FAVORITE_DETAIL_PAGE_SIZE,
            offset,
            ownerId,
            userId,
            tag
        });
        const page = Array.isArray(response.json) ? response.json : [];
        worlds.push(...page);

        if (page.length < FAVORITE_DETAIL_PAGE_SIZE) {
            break;
        }
    }

    return worlds;
}

async function getFavoriteAvatars({
    endpoint = '',
    n = FAVORITE_DETAIL_PAGE_SIZE,
    offset = 0,
    tag
}: FavoriteAvatarsInput = {}) {
    const params: RequestParams = {
        n,
        offset
    };

    if (typeof tag === 'string' && tag.trim()) {
        params.tag = tag.trim();
    }

    return executeGet('avatars/favorites', params, { endpoint });
}

async function getAllFavoriteAvatars({
    endpoint = '',
    tags = []
}: RequestOptions & { tags?: unknown[] } = {}) {
    const avatars = [];
    const seenIds = new Set();
    const normalizedTags = Array.from(
        new Set(
            (Array.isArray(tags) ? tags : [])
                .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
                .filter(Boolean)
        )
    );
    const tagQueue = normalizedTags.length > 0 ? normalizedTags : [undefined];

    for (const tag of tagQueue) {
        for (let offset = 0; ; offset += FAVORITE_DETAIL_PAGE_SIZE) {
            const response = await getFavoriteAvatars({
                endpoint,
                n: FAVORITE_DETAIL_PAGE_SIZE,
                offset,
                tag
            });
            const page = Array.isArray(response.json) ? response.json : [];

            for (const avatar of page) {
                const avatarId =
                    typeof avatar?.id === 'string'
                        ? avatar.id.trim()
                        : String(avatar?.id ?? '').trim();
                if (!avatarId || seenIds.has(avatarId)) {
                    continue;
                }
                seenIds.add(avatarId);
                avatars.push(avatar);
            }

            if (page.length < FAVORITE_DETAIL_PAGE_SIZE) {
                break;
            }
        }
    }

    return avatars;
}

async function getFavoriteGroups({
    endpoint = '',
    n = FAVORITE_GROUPS_PAGE_SIZE,
    offset = 0,
    ownerId = ''
}: FavoriteGroupsInput = {}) {
    const params: RequestParams = { n, offset };
    if (ownerId) {
        params.ownerId = ownerId;
    }

    return executeGet('favorite/groups', params, { endpoint });
}

async function getAllFavoriteGroups({
    endpoint = '',
    ownerId = ''
}: RequestOptions & { ownerId?: string } = {}) {
    const groups = [];

    for (let offset = 0; ; offset += FAVORITE_GROUPS_PAGE_SIZE) {
        const response = await getFavoriteGroups({
            endpoint,
            n: FAVORITE_GROUPS_PAGE_SIZE,
            offset,
            ownerId
        });
        const page = Array.isArray(response.json) ? response.json : [];
        groups.push(...page);

        if (page.length < FAVORITE_GROUPS_PAGE_SIZE) {
            break;
        }
    }

    return groups;
}

async function saveFavoriteGroup({
    endpoint = '',
    ownerId = '',
    type,
    group,
    displayName,
    visibility
}: FavoriteGroupMutationInput = {}) {
    const normalizedOwnerId =
        typeof ownerId === 'string'
            ? ownerId.trim()
            : String(ownerId ?? '').trim();
    const normalizedType =
        typeof type === 'string' ? type.trim() : String(type ?? '').trim();
    const normalizedGroup =
        typeof group === 'string' ? group.trim() : String(group ?? '').trim();

    if (!normalizedOwnerId || !normalizedType || !normalizedGroup) {
        throw new Error(
            'VrchatFavoriteRepository.saveFavoriteGroup requires ownerId, type, and group.'
        );
    }

    const payload: RequestPayload = {
        type: normalizedType,
        group: normalizedGroup
    };
    if (typeof displayName === 'string') {
        payload.displayName = displayName;
    }
    if (typeof visibility === 'string') {
        payload.visibility = visibility;
    }

    return executePut(
        `favorite/group/${encodeURIComponent(normalizedType)}/${encodeURIComponent(normalizedGroup)}/${encodeURIComponent(normalizedOwnerId)}`,
        payload,
        { endpoint }
    );
}

async function clearFavoriteGroup({
    endpoint = '',
    ownerId = '',
    type,
    group
}: FavoriteGroupMutationInput = {}) {
    const normalizedOwnerId =
        typeof ownerId === 'string'
            ? ownerId.trim()
            : String(ownerId ?? '').trim();
    const normalizedType =
        typeof type === 'string' ? type.trim() : String(type ?? '').trim();
    const normalizedGroup =
        typeof group === 'string' ? group.trim() : String(group ?? '').trim();

    if (!normalizedOwnerId || !normalizedType || !normalizedGroup) {
        throw new Error(
            'VrchatFavoriteRepository.clearFavoriteGroup requires ownerId, type, and group.'
        );
    }

    return executeDelete(
        `favorite/group/${encodeURIComponent(normalizedType)}/${encodeURIComponent(normalizedGroup)}/${encodeURIComponent(normalizedOwnerId)}`,
        { endpoint }
    );
}

const vrchatFavoriteRepository = Object.freeze({
    executeGet,
    executePost,
    executePut,
    executeDelete,
    getFavoriteLimits,
    getFavorites,
    getAllFavorites,
    addFavorite,
    deleteFavorite,
    getFavoriteWorlds,
    getAllFavoriteWorlds,
    getFavoriteAvatars,
    getAllFavoriteAvatars,
    getFavoriteGroups,
    getAllFavoriteGroups,
    saveFavoriteGroup,
    clearFavoriteGroup
});

export {
    executeGet,
    executePost,
    executePut,
    executeDelete,
    getFavoriteLimits,
    getFavorites,
    getAllFavorites,
    addFavorite,
    deleteFavorite,
    getFavoriteWorlds,
    getAllFavoriteWorlds,
    getFavoriteAvatars,
    getAllFavoriteAvatars,
    getFavoriteGroups,
    getAllFavoriteGroups,
    saveFavoriteGroup,
    clearFavoriteGroup
};
export default vrchatFavoriteRepository;
