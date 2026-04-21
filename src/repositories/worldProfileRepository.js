import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/services/entityQueryCacheService.js';
import { getVrchatEndpointBase } from '@/shared/vrchatEndpoint.js';

import { safeJsonParse } from './baseRepository.js';
import webRepository from './webRepository.js';

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
    const url = new URL(path, getVrchatEndpointBase(endpoint));
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

    return `VRChat world request failed (${status})`;
}

function createWorldRequestError(message, status, path, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = path;
    error.payload = payload;
    return error;
}

function normalizeEntityId(value) {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (value && typeof value === 'object') {
        return normalizeEntityId(
            value.id ||
                value.worldId ||
                value.world_id ||
                value.userId ||
                value.user_id ||
                value.avatarId ||
                value.avatar_id ||
                value.groupId ||
                value.group_id
        );
    }

    return String(value ?? '').trim();
}

function normalizeArray(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) =>
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim()
        )
        .filter(Boolean);
}

function parseNumber(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveWorldPlatforms(world) {
    const names = new Set();
    const candidates = [];

    if (Array.isArray(world?.platforms)) {
        candidates.push(...world.platforms);
    }

    if (Array.isArray(world?.unityPackages)) {
        for (const pkg of world.unityPackages) {
            candidates.push(
                pkg?.platform,
                pkg?.platformName,
                pkg?.assetVersion?.platform
            );
        }
    }

    for (const candidate of candidates) {
        const normalized = normalizeEntityId(candidate).toLowerCase();
        if (!normalized) {
            continue;
        }

        if (
            normalized === 'standalonewindows' ||
            normalized === 'pc' ||
            normalized === 'windows'
        ) {
            names.add('PC');
            continue;
        }

        if (normalized === 'android' || normalized === 'quest') {
            names.add('Quest');
            continue;
        }

        if (normalized === 'ios') {
            names.add('iOS');
        }
    }

    return Array.from(names);
}

function normalizeWorldProfile(world) {
    const tags = normalizeArray(world?.tags);

    return {
        ...world,
        id: normalizeEntityId(world?.id),
        name: normalizeEntityId(world?.name),
        description:
            typeof world?.description === 'string'
                ? world.description.trim()
                : '',
        authorId: normalizeEntityId(world?.authorId),
        authorName:
            normalizeEntityId(world?.authorName) ||
            normalizeEntityId(world?.authorId) ||
            'Unknown author',
        releaseStatus: normalizeEntityId(world?.releaseStatus) || 'unknown',
        thumbnailImageUrl:
            typeof world?.thumbnailImageUrl === 'string'
                ? world.thumbnailImageUrl.trim()
                : '',
        imageUrl:
            typeof world?.imageUrl === 'string' ? world.imageUrl.trim() : '',
        occupants: parseNumber(world?.occupants),
        capacity: parseNumber(world?.capacity),
        recommendedCapacity: parseNumber(world?.recommendedCapacity),
        favorites: parseNumber(world?.favorites),
        visits: parseNumber(world?.visits),
        popularity: parseNumber(world?.popularity),
        heat: parseNumber(world?.heat),
        tags,
        isLabs: tags.includes('system_labs'),
        createdAt: world?.created_at ?? world?.createdAt ?? '',
        updatedAt: world?.updated_at ?? world?.updatedAt ?? '',
        publicationDate: world?.publicationDate ?? '',
        platforms: resolveWorldPlatforms(world)
    };
}

async function collectPages(fetchPage, { pageSize = 100, maxPages = 50 } = {}) {
    const rows = [];

    for (let page = 0; page < maxPages; page += 1) {
        const nextRows = await fetchPage({
            n: pageSize,
            offset: page * pageSize
        });
        rows.push(...nextRows);

        if (nextRows.length < pageSize) {
            break;
        }
    }

    return rows;
}

function normalize(world) {
    return normalizeWorldProfile(world);
}

async function fetchWorldProfile({ worldId, endpoint = '' }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.fetchWorldProfile requires a world id.'
        );
    }

    const response = await executeGet(
        `worlds/${encodeURIComponent(normalizedWorldId)}`,
        {},
        { endpoint }
    );
    return normalize(response.json);
}

async function executeGet(path, params = {}, { endpoint = '' } = {}) {
    const response = await webRepository.execute({
        url: buildUrl(path, params, endpoint),
        method: 'GET'
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createWorldRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createWorldRequestError(
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

async function executePut(path, params = {}, { endpoint = '' } = {}) {
    const response = await webRepository.execute({
        url: buildUrl(path, {}, endpoint),
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json;charset=utf-8'
        },
        body: JSON.stringify(params && typeof params === 'object' ? params : {})
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createWorldRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createWorldRequestError(
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

async function executeDelete(path, params = {}, { endpoint = '' } = {}) {
    const response = await webRepository.execute({
        url: buildUrl(path, params, endpoint),
        method: 'DELETE'
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createWorldRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createWorldRequestError(
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

async function getWorldProfile({ worldId, endpoint = '', force = false }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.getWorldProfile requires a world id.'
        );
    }

    const json = await fetchCachedData({
        queryKey: queryKeys.world(normalizedWorldId, endpoint),
        policy: entityQueryPolicies.world,
        force,
        queryFn: () =>
            fetchWorldProfile({ worldId: normalizedWorldId, endpoint })
    });

    return normalize(json);
}

async function getWorldsByUser({
    userId,
    endpoint = '',
    n = 50,
    offset = 0,
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all',
    force = false
} = {}) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'WorldProfileRepository.getWorldsByUser requires a user id.'
        );
    }

    const params = {
        n,
        offset,
        sort,
        order,
        userId: normalizedUserId,
        releaseStatus
    };
    const rows = await fetchCachedData({
        queryKey: queryKeys.worldsByUser(params, endpoint),
        policy: entityQueryPolicies.worldCollection,
        force,
        queryFn: async () => {
            const response = await executeGet('worlds', params, { endpoint });
            return Array.isArray(response.json) ? response.json : [];
        }
    });

    return rows.map((world) => normalize(world));
}

async function saveWorld({ worldId, params = {}, endpoint = '' }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.saveWorld requires a world id.'
        );
    }

    const response = await executePut(
        `worlds/${encodeURIComponent(normalizedWorldId)}`,
        params,
        { endpoint }
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, endpoint),
            response.json
        );
    }
    return response;
}

async function deleteWorld({ worldId, endpoint = '' }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.deleteWorld requires a world id.'
        );
    }

    return executeDelete(
        `worlds/${encodeURIComponent(normalizedWorldId)}`,
        {},
        { endpoint }
    );
}

async function publishWorld({ worldId, endpoint = '' }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.publishWorld requires a world id.'
        );
    }

    const response = await executePut(
        `worlds/${encodeURIComponent(normalizedWorldId)}/publish`,
        { worldId: normalizedWorldId },
        { endpoint }
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, endpoint),
            response.json
        );
    }
    return response;
}

async function unpublishWorld({ worldId, endpoint = '' }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.unpublishWorld requires a world id.'
        );
    }

    const response = await executeDelete(
        `worlds/${encodeURIComponent(normalizedWorldId)}/publish`,
        {},
        { endpoint }
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, endpoint),
            response.json
        );
    }
    return response;
}

async function deleteWorldPersistentData({ userId, worldId, endpoint = '' }) {
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedUserId || !normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.deleteWorldPersistentData requires user and world ids.'
        );
    }

    const response = await executeDelete(
        `users/${encodeURIComponent(normalizedUserId)}/${encodeURIComponent(normalizedWorldId)}/persist`,
        {},
        { endpoint }
    );
    setCachedQueryData(
        queryKeys.worldPersistData(
            { userId: normalizedUserId, worldId: normalizedWorldId },
            endpoint
        ),
        false
    );
    return response;
}

async function hasWorldPersistentData({
    userId,
    worldId,
    endpoint = '',
    force = false
}) {
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedUserId || !normalizedWorldId) {
        return false;
    }

    return fetchCachedData({
        queryKey: queryKeys.worldPersistData(
            { userId: normalizedUserId, worldId: normalizedWorldId },
            endpoint
        ),
        policy: entityQueryPolicies.worldPersistData,
        force,
        queryFn: async () => {
            const response = await executeGet(
                `users/${encodeURIComponent(normalizedUserId)}/${encodeURIComponent(normalizedWorldId)}/persist/exists`,
                {},
                { endpoint }
            );
            if (typeof response.json === 'boolean') {
                return response.json;
            }
            if (typeof response.json?.exists === 'boolean') {
                return response.json.exists;
            }
            return String(response.json ?? '').toLowerCase() === 'true';
        }
    });
}

async function getAllWorldsByUser({
    userId,
    endpoint = '',
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all',
    force = false
} = {}) {
    return collectPages(({ n, offset }) =>
        getWorldsByUser({
            userId,
            endpoint,
            n,
            offset,
            sort,
            order,
            releaseStatus,
            force
        })
    );
}

const worldProfileRepository = Object.freeze({
    normalize,
    fetchWorldProfile,
    executeGet,
    executePut,
    executeDelete,
    getWorldProfile,
    getWorldsByUser,
    saveWorld,
    deleteWorld,
    publishWorld,
    unpublishWorld,
    deleteWorldPersistentData,
    hasWorldPersistentData,
    getAllWorldsByUser
});

export {
    normalize,
    fetchWorldProfile,
    executeGet,
    executePut,
    executeDelete,
    getWorldProfile,
    getWorldsByUser,
    saveWorld,
    deleteWorld,
    publishWorld,
    unpublishWorld,
    deleteWorldPersistentData,
    hasWorldPersistentData,
    getAllWorldsByUser
};
export default worldProfileRepository;
