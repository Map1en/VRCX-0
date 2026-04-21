import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys,
    setCachedQueryData
} from '@/services/entityQueryCacheService.js';
import { storeAvatarImage } from '@/shared/utils/avatar.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import {
    getVrchatEndpointBase,
    normalizeVrchatEndpointDomain
} from '@/shared/vrchatEndpoint.js';

import { safeJsonParse } from './baseRepository.js';
import avatarLocalRepository from './avatarLocalRepository.js';
import memoRepository from './memoRepository.js';
import webRepository from './webRepository.js';

const cachedAvatarNames = new Map();

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

    return `VRChat avatar request failed (${status})`;
}

function createAvatarRequestError(message, status, path, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = path;
    error.payload = payload;
    return error;
}

function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeMemoString(value) {
    return typeof value === 'string' ? value : '';
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

function normalizeLocalTags(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((entry) => ({
            tag: normalizeString(entry?.tag),
            color: normalizeString(entry?.color) || null
        }))
        .filter((entry) => entry.tag);
}

function normalizeUnityPackages(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values.filter((value) => value && typeof value === 'object');
}

function parseInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAvatarProfile(avatar, extras = {}) {
    return {
        ...avatar,
        id: normalizeEntityId(avatar?.id),
        name: normalizeString(avatar?.name),
        description: normalizeString(avatar?.description),
        authorId: normalizeEntityId(avatar?.authorId ?? avatar?.author_id),
        authorName:
            normalizeEntityId(avatar?.authorName ?? avatar?.author_name) ||
            normalizeEntityId(avatar?.authorId ?? avatar?.author_id) ||
            'Unknown author',
        releaseStatus:
            normalizeEntityId(
                avatar?.releaseStatus ?? avatar?.release_status
            ) || 'unknown',
        thumbnailImageUrl: normalizeString(
            avatar?.thumbnailImageUrl ?? avatar?.thumbnail_image_url
        ),
        imageUrl: normalizeString(avatar?.imageUrl ?? avatar?.image_url),
        created_at: avatar?.created_at ?? avatar?.createdAt ?? '',
        updated_at: avatar?.updated_at ?? avatar?.updatedAt ?? '',
        version: parseInteger(avatar?.version),
        tags: normalizeArray(avatar?.tags),
        unityPackages: normalizeUnityPackages(avatar?.unityPackages),
        $tags: normalizeLocalTags(extras.localTags ?? avatar?.$tags),
        $timeSpent: Math.max(
            0,
            parseInteger(extras.timeSpent ?? avatar?.$timeSpent)
        ),
        $memo: normalizeMemoString(extras.memo ?? avatar?.$memo),
        $isCached: Boolean(extras.cachedAvatar)
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

function normalize(avatar, extras = {}) {
    return normalizeAvatarProfile(avatar, extras);
}

function clearAvatarNameCache() {
    const size = cachedAvatarNames.size;
    cachedAvatarNames.clear();
    return size;
}

function getAvatarNameCacheSize() {
    return cachedAvatarNames.size;
}

async function executeGet(path, params = {}, { endpoint = '' } = {}) {
    const response = await webRepository.execute({
        url: buildUrl(path, params, endpoint),
        method: 'GET'
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createAvatarRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createAvatarRequestError(
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
    const requestOptions = {
        url: buildUrl(path, {}, endpoint),
        method: 'PUT'
    };

    if (params !== null) {
        requestOptions.headers = {
            'Content-Type': 'application/json;charset=utf-8'
        };
        requestOptions.body = JSON.stringify(
            params && typeof params === 'object' ? params : {}
        );
    }

    const response = await webRepository.execute(requestOptions);
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createAvatarRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createAvatarRequestError(
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

async function executePost(path, params = {}, { endpoint = '' } = {}) {
    const requestOptions = {
        url: buildUrl(path, {}, endpoint),
        method: 'POST',
        headers: {
            'Content-Type': 'application/json;charset=utf-8'
        },
        body: JSON.stringify(params && typeof params === 'object' ? params : {})
    };

    const response = await webRepository.execute(requestOptions);
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw createAvatarRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createAvatarRequestError(
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
        throw createAvatarRequestError(
            unwrapErrorMessage(json, response.status),
            response.status,
            path,
            json
        );
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw createAvatarRequestError(
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

async function getLocalSnapshot(avatarId, currentUserId = '') {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        return {
            cachedAvatar: null,
            localTags: [],
            timeSpent: 0,
            memo: ''
        };
    }

    const [cachedAvatar, localTags, timeSpentEntry, memoEntry] =
        await Promise.all([
            avatarLocalRepository
                .getCachedAvatarById(normalizedAvatarId)
                .catch(() => null),
            avatarLocalRepository
                .getAvatarTags(normalizedAvatarId)
                .catch(() => []),
            currentUserId
                ? avatarLocalRepository
                      .getAvatarTimeSpent(currentUserId, normalizedAvatarId)
                      .catch(() => null)
                : Promise.resolve(null),
            memoRepository.getAvatarMemo(normalizedAvatarId).catch(() => null)
        ]);

    return {
        cachedAvatar: cachedAvatar || null,
        localTags: normalizeLocalTags(localTags),
        timeSpent: parseInteger(timeSpentEntry?.timeSpent),
        memo: normalizeString(memoEntry?.memo)
    };
}

async function getAvatarProfile({
    avatarId,
    endpoint = '',
    force = false,
    allowLocalFallback = true,
    currentUserId = ''
}) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarProfile requires an avatar id.'
        );
    }

    const localSnapshotPromise = getLocalSnapshot(
        normalizedAvatarId,
        currentUserId
    );

    try {
        const [json, localSnapshot] = await Promise.all([
            fetchCachedData({
                queryKey: queryKeys.avatar(normalizedAvatarId, endpoint),
                policy: entityQueryPolicies.avatar,
                force,
                queryFn: async () => {
                    const response = await executeGet(
                        `avatars/${encodeURIComponent(normalizedAvatarId)}`,
                        {},
                        { endpoint }
                    );
                    return response.json;
                }
            }),
            localSnapshotPromise
        ]);

        return normalize(json, localSnapshot);
    } catch (error) {
        const localSnapshot = await localSnapshotPromise;
        if (allowLocalFallback && localSnapshot.cachedAvatar) {
            return normalize(localSnapshot.cachedAvatar, localSnapshot);
        }

        throw error;
    }
}

async function getAvatarGallery({ avatarId, endpoint = '', force = false }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarGallery requires an avatar id.'
        );
    }

    const rows = await fetchCachedData({
        queryKey: queryKeys.avatarGallery(normalizedAvatarId, endpoint),
        policy: entityQueryPolicies.avatarGallery,
        force,
        queryFn: async () => {
            const response = await executeGet(
                'files',
                {
                    tag: 'avatargallery',
                    galleryId: normalizedAvatarId,
                    n: 100,
                    offset: 0
                },
                { endpoint }
            );
            return Array.isArray(response.json)
                ? response.json
                : Array.isArray(response.json?.files)
                  ? response.json.files
                  : [];
        }
    });
    return rows.slice().sort((a, b) => {
        if (!a?.order && !b?.order) {
            return 0;
        }
        return (Number(a?.order) || 0) - (Number(b?.order) || 0);
    });
}

async function getAvatarsByUser({
    userId,
    user = '',
    endpoint = '',
    n = 100,
    offset = 0,
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all'
} = {}) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarsByUser requires a user id.'
        );
    }

    const params = { n, offset, sort, order, releaseStatus };
    if (user) {
        params.user = user;
    } else {
        params.userId = normalizedUserId;
    }

    const response = await executeGet('avatars', params, { endpoint });
    return Array.isArray(response.json)
        ? response.json.map((avatar) => normalize(avatar))
        : [];
}

async function getAllAvatarsByUser({
    userId,
    user = '',
    endpoint = '',
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all'
} = {}) {
    return collectPages(({ n, offset }) =>
        getAvatarsByUser({
            userId,
            user,
            endpoint,
            n,
            offset,
            sort,
            order,
            releaseStatus
        })
    );
}

async function selectAvatar({ avatarId, endpoint = '' }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.selectAvatar requires an avatar id.'
        );
    }

    const response = await executePut(
        `avatars/${encodeURIComponent(normalizedAvatarId)}/select`,
        null,
        { endpoint }
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.avatar(normalizedAvatarId, endpoint),
            response.json
        );
    }
    return response;
}

async function selectFallbackAvatar({ avatarId, endpoint = '' }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.selectFallbackAvatar requires an avatar id.'
        );
    }

    const response = await executePut(
        `avatars/${encodeURIComponent(normalizedAvatarId)}/selectfallback`,
        null,
        { endpoint }
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.avatar(normalizedAvatarId, endpoint),
            response.json
        );
    }
    return response;
}

async function saveAvatar({ avatarId, params = {}, endpoint = '' }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.saveAvatar requires an avatar id.'
        );
    }

    const response = await executePut(
        `avatars/${encodeURIComponent(normalizedAvatarId)}`,
        params,
        { endpoint }
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.avatar(normalizedAvatarId, endpoint),
            response.json
        );
    }
    return response;
}

async function getAvatarStyles({ endpoint = '', force = false } = {}) {
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

async function deleteAvatar({ avatarId, endpoint = '' }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.deleteAvatar requires an avatar id.'
        );
    }

    const response = await executeDelete(
        `avatars/${encodeURIComponent(normalizedAvatarId)}`,
        {},
        { endpoint }
    );
    await Promise.allSettled([
        invalidateEntityQueries(queryKeys.avatar(normalizedAvatarId, endpoint)),
        invalidateEntityQueries(
            queryKeys.avatarGallery(normalizedAvatarId, endpoint)
        )
    ]);
    return response;
}

async function createImposter({ avatarId, endpoint = '' }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.createImposter requires an avatar id.'
        );
    }

    return executePost(
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`,
        {},
        { endpoint }
    );
}

async function deleteImposter({ avatarId, endpoint = '' }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.deleteImposter requires an avatar id.'
        );
    }

    return executeDelete(
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor`,
        {},
        { endpoint }
    );
}

async function getAvatarModerations({ endpoint = '' } = {}) {
    return executeGet('auth/user/avatarmoderations', {}, { endpoint });
}

async function sendAvatarModeration({
    avatarId,
    type = 'block',
    endpoint = ''
}) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    const normalizedType = normalizeString(type) || 'block';
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.sendAvatarModeration requires an avatar id.'
        );
    }

    return executePost(
        'auth/user/avatarmoderations',
        {
            avatarModerationType: normalizedType,
            targetAvatarId: normalizedAvatarId
        },
        { endpoint }
    );
}

async function deleteAvatarModeration({
    avatarId,
    type = 'block',
    endpoint = ''
}) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    const normalizedType = normalizeString(type) || 'block';
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.deleteAvatarModeration requires an avatar id.'
        );
    }

    return executeDelete(
        'auth/user/avatarmoderations',
        {
            avatarModerationType: normalizedType,
            targetAvatarId: normalizedAvatarId
        },
        { endpoint }
    );
}

async function getAvatarNameFromImageUrl(imageUrl, { endpoint = '' } = {}) {
    const fileId = extractFileId(imageUrl || '');
    if (!fileId) {
        return {
            ownerId: '',
            avatarName: '-'
        };
    }

    const cacheKey = `${normalizeVrchatEndpointDomain(endpoint)}\u0000${fileId}`;
    if (cachedAvatarNames.has(cacheKey)) {
        return cachedAvatarNames.get(cacheKey);
    }

    try {
        const response = await fetchCachedData({
            queryKey: queryKeys.file(fileId, endpoint),
            policy: entityQueryPolicies.fileObject,
            queryFn: () =>
                executeGet(
                    `file/${encodeURIComponent(fileId)}`,
                    {},
                    { endpoint }
                )
        });
        const nextInfo = storeAvatarImage(
            {
                json: response.json,
                params: { fileId }
            },
            new Map()
        );
        cachedAvatarNames.set(cacheKey, nextInfo);
        return nextInfo;
    } catch {
        return {
            ownerId: '',
            avatarName: '-'
        };
    }
}

const avatarProfileRepository = Object.freeze({
    normalize,
    clearAvatarNameCache,
    getAvatarNameCacheSize,
    executeGet,
    executePut,
    executePost,
    executeDelete,
    getLocalSnapshot,
    getAvatarProfile,
    getAvatarGallery,
    getAvatarsByUser,
    getAllAvatarsByUser,
    selectAvatar,
    selectFallbackAvatar,
    saveAvatar,
    getAvatarStyles,
    deleteAvatar,
    createImposter,
    deleteImposter,
    getAvatarModerations,
    sendAvatarModeration,
    deleteAvatarModeration,
    getAvatarNameFromImageUrl
});

export {
    normalize,
    clearAvatarNameCache,
    getAvatarNameCacheSize,
    executeGet,
    executePut,
    executePost,
    executeDelete,
    getLocalSnapshot,
    getAvatarProfile,
    getAvatarGallery,
    getAvatarsByUser,
    getAllAvatarsByUser,
    selectAvatar,
    selectFallbackAvatar,
    saveAvatar,
    getAvatarStyles,
    deleteAvatar,
    createImposter,
    deleteImposter,
    getAvatarModerations,
    sendAvatarModeration,
    deleteAvatarModeration,
    getAvatarNameFromImageUrl
};
export default avatarProfileRepository;
