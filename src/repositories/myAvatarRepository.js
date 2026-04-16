import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';
import sqliteRepository from './sqliteRepository.js';
import { database } from '@/services/database/index.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/services/entityQueryCacheService.js';

const PAGE_SIZE = 50;
const MAX_OFFSET = 5000;

function normalizeEndpointDomain(endpointDomain) {
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain.trim();
    }

    return DEFAULT_ENDPOINT_DOMAIN;
}

function buildUrl(path, params = {}, endpoint = '') {
    const baseUrl = normalizeEndpointDomain(endpoint).replace(/\/?$/, '/');
    const url = new URL(path, baseUrl);

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
            continue;
        }
        url.searchParams.set(key, String(value));
    }

    return url.toString();
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

    return `VRChat avatar request failed (${status})`;
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

    const response = await webRepository.execute(requestOptions);
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw new Error(unwrapErrorMessage(json, response.status));
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw new Error(unwrapErrorMessage(json, response.status));
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

async function executePut(path, params = {}, { endpoint = '' } = {}) {
    return execute(path, { endpoint, method: 'PUT', params });
}

async function getAvatarsPage({ endpoint = '', offset = 0, n = PAGE_SIZE } = {}) {
    return executeGet(
        'avatars',
        {
            n,
            offset,
            sort: 'updated',
            order: 'descending',
            releaseStatus: 'all',
            user: 'me'
        },
        { endpoint }
    );
}

async function getMyAvatars({
    endpoint = '',
    currentAvatarId = '',
    previousAvatarSwapTime = 0
} = {}) {
    const avatars = [];

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getAvatarsPage({
            endpoint,
            offset,
            n: PAGE_SIZE
        });
        const page = Array.isArray(response.json) ? response.json : [];
        avatars.push(...page);

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    const [tagsMap, avatarTimeSpentMap] = await Promise.all([
        database.getAllAvatarTags(),
        database.getAllAvatarTimeSpent()
    ]);

    return avatars.map((avatar) => {
        const nextAvatar = {
            ...avatar,
            $tags: tagsMap.get(avatar.id) || [],
            $timeSpent: avatarTimeSpentMap.get(avatar.id) || 0
        };

        if (
            currentAvatarId &&
            avatar.id === currentAvatarId &&
            Number.isFinite(previousAvatarSwapTime) &&
            previousAvatarSwapTime > 0
        ) {
            nextAvatar.$timeSpent += Date.now() - previousAvatarSwapTime;
        }

        return nextAvatar;
    });
}

async function updateAvatarTags({ avatarId, previousTags = [], nextTags = [] }) {
    const normalizedAvatarId = typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error('MyAvatarRepository.updateAvatarTags requires an avatar id.');
    }

    const previousMap = new Map(
        (Array.isArray(previousTags) ? previousTags : [])
            .filter((entry) => typeof entry?.tag === 'string' && entry.tag.trim())
            .map((entry) => [entry.tag.trim(), { tag: entry.tag.trim(), color: entry.color || null }])
    );
    const nextMap = new Map(
        (Array.isArray(nextTags) ? nextTags : [])
            .filter((entry) => typeof entry?.tag === 'string' && entry.tag.trim())
            .map((entry) => [entry.tag.trim(), { tag: entry.tag.trim(), color: entry.color || null }])
    );

    await sqliteRepository.transaction(async () => {
        for (const [tag] of previousMap) {
            if (!nextMap.has(tag)) {
                await database.removeAvatarTag(normalizedAvatarId, tag);
            }
        }

        for (const [tag, entry] of nextMap) {
            const previous = previousMap.get(tag);
            if (!previous) {
                await database.addAvatarTag(normalizedAvatarId, tag, entry.color);
            } else if ((previous.color || null) !== (entry.color || null)) {
                await database.updateAvatarTagColor(normalizedAvatarId, tag, entry.color);
            }
        }
    });

    return Array.from(nextMap.values());
}

async function saveAvatar({ avatarId, endpoint = '', params = {} }) {
    const normalizedAvatarId = typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error('MyAvatarRepository.saveAvatar requires an avatar id.');
    }

    const response = await executePut(
        `avatars/${encodeURIComponent(normalizedAvatarId)}`,
        {
            id: normalizedAvatarId,
            ...params
        },
        { endpoint }
    );

    return response.json;
}

async function createImpostor({ avatarId, endpoint = '' } = {}) {
    const normalizedAvatarId = typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error('MyAvatarRepository.createImpostor requires an avatar id.');
    }

    const response = await execute(
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`,
        {
            endpoint,
            method: 'POST'
        }
    );

    return response.json;
}

async function getAvailableAvatarStyles({ endpoint = '', force = false } = {}) {
    return fetchCachedData({
        queryKey: queryKeys.avatarStyles(endpoint),
        policy: entityQueryPolicies.avatarStyles,
        force,
        queryFn: async () => {
            const response = await executeGet('avatarStyles', {}, { endpoint });
            return Array.isArray(response.json) ? response.json : [];
        }
    });
}

const myAvatarRepository = Object.freeze({
    execute,
    executeGet,
    executePut,
    getAvatarsPage,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
});

export {
    execute,
    executeGet,
    executePut,
    getAvatarsPage,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
};
export default myAvatarRepository;
