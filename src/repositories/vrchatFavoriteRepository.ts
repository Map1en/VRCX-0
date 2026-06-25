import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

const FAVORITES_PAGE_SIZE = 300;
const FAVORITE_GROUPS_PAGE_SIZE = 50;
const FAVORITE_DETAIL_PAGE_SIZE = 300;

type RequestOptions = {
    endpoint?: string;
};
type RequestPayload = Record<string, unknown>;
type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatFavoriteResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string,
    fallbackMessage: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const message = unwrapErrorMessage(json, response.status, {
            fallbackMessage
        });
        const requestError = createRequestError(
            message,
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

async function getFavoriteLimits({
    endpoint = '',
    force = false
}: RequestOptions & { force?: boolean } = {}) {
    return fetchCachedData({
        queryKey: queryKeys.favoriteLimits(endpoint),
        policy: entityQueryPolicies.favoriteLimits,
        force,
        queryFn: async () => {
            const response = await commands.appVrchatFavoriteLimitsGet({
                endpoint
            });
            return unwrapVrchatFavoriteResponse(
                response,
                'auth/user/favoritelimits',
                'VRChat favorite request failed'
            );
        }
    });
}

async function getFavorites({
    endpoint = '',
    n = FAVORITES_PAGE_SIZE,
    offset = 0
}: FavoritePagingInput = {}) {
    const response = await commands.appVrchatFavoritesGet({
        endpoint,
        n,
        offset
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'favorites',
        'VRChat favorite request failed'
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
    const response = await commands.appVrchatFavoriteAdd({
        endpoint,
        type: typeof type === 'string' ? type : String(type ?? ''),
        favoriteId:
            typeof favoriteId === 'string'
                ? favoriteId
                : String(favoriteId ?? ''),
        tags: typeof tags === 'string' ? tags : String(tags ?? '')
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'favorites',
        'VRChat favorite request failed'
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

    const response = await commands.appVrchatFavoriteDelete({
        endpoint,
        objectId: normalizedObjectId
    });
    return unwrapVrchatFavoriteResponse(
        response,
        `favorites/${encodeURIComponent(normalizedObjectId)}`,
        'VRChat favorite request failed'
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
    const response = await commands.appVrchatFavoriteWorldsGet({
        endpoint,
        n,
        offset,
        ownerId,
        userId,
        tag
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'worlds/favorites',
        'VRChat favorite request failed'
    );
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
    const response = await commands.appVrchatFavoriteAvatarsGet({
        endpoint,
        n,
        offset,
        tag: typeof tag === 'string' ? tag.trim() : ''
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'avatars/favorites',
        'VRChat favorite request failed'
    );
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
    const response = await commands.appVrchatFavoriteGroupsGet({
        endpoint,
        n,
        offset,
        ownerId
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'favorite/groups',
        'VRChat favorite request failed'
    );
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

    const response = await commands.appVrchatFavoriteGroupSave({
        endpoint,
        ownerId: normalizedOwnerId,
        type: normalizedType,
        group: normalizedGroup,
        displayName: typeof displayName === 'string' ? displayName : null,
        visibility: typeof visibility === 'string' ? visibility : null
    });
    return unwrapVrchatFavoriteResponse(
        response,
        `favorite/group/${encodeURIComponent(normalizedType)}/${encodeURIComponent(normalizedGroup)}/${encodeURIComponent(normalizedOwnerId)}`,
        'VRChat favorite request failed'
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

    const response = await commands.appVrchatFavoriteGroupClear({
        endpoint,
        ownerId: normalizedOwnerId,
        type: normalizedType,
        group: normalizedGroup
    });
    return unwrapVrchatFavoriteResponse(
        response,
        `favorite/group/${encodeURIComponent(normalizedType)}/${encodeURIComponent(normalizedGroup)}/${encodeURIComponent(normalizedOwnerId)}`,
        'VRChat favorite request failed'
    );
}

const vrchatFavoriteRepository = Object.freeze({
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
