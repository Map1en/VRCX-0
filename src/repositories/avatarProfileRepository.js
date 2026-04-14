import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';
import { database } from '@/services/database/index.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { storeAvatarImage } from '@/shared/utils/avatar.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys,
    setCachedQueryData
} from '@/services/entityQueryCacheService.js';

const cachedAvatarNames = new Map();

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
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
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
        .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim()))
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
            normalizeEntityId(avatar?.releaseStatus ?? avatar?.release_status) || 'unknown',
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
        $timeSpent: Math.max(0, parseInteger(extras.timeSpent ?? avatar?.$timeSpent)),
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

class AvatarProfileRepository {
    normalize(avatar, extras = {}) {
        return normalizeAvatarProfile(avatar, extras);
    }

    clearAvatarNameCache() {
        const size = cachedAvatarNames.size;
        cachedAvatarNames.clear();
        return size;
    }

    getAvatarNameCacheSize() {
        return cachedAvatarNames.size;
    }

    async executeGet(path, params = {}, { endpoint = '' } = {}) {
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

    async executePut(path, params = {}, { endpoint = '' } = {}) {
        const requestOptions = {
            url: buildUrl(path, {}, endpoint),
            method: 'PUT'
        };

        if (params !== null) {
            requestOptions.headers = {
                'Content-Type': 'application/json;charset=utf-8'
            };
            requestOptions.body = JSON.stringify(params && typeof params === 'object' ? params : {});
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

    async executePost(path, params = {}, { endpoint = '' } = {}) {
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

    async executeDelete(path, params = {}, { endpoint = '' } = {}) {
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

    async getLocalSnapshot(avatarId) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            return {
                cachedAvatar: null,
                localTags: [],
                timeSpent: 0,
                memo: ''
            };
        }

        const [cachedAvatar, localTags, timeSpentEntry, memoEntry] = await Promise.all([
            database.getCachedAvatarById(normalizedAvatarId).catch(() => null),
            database.getAvatarTags(normalizedAvatarId).catch(() => []),
            database.getAvatarTimeSpent(normalizedAvatarId).catch(() => null),
            database.getAvatarMemoDB(normalizedAvatarId).catch(() => null)
        ]);

        return {
            cachedAvatar: cachedAvatar || null,
            localTags: normalizeLocalTags(localTags),
            timeSpent: parseInteger(timeSpentEntry?.timeSpent),
            memo: normalizeString(memoEntry?.memo)
        };
    }

    async getAvatarProfile({ avatarId, endpoint = '', force = false, allowLocalFallback = true }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.getAvatarProfile requires an avatar id.');
        }

        const localSnapshotPromise = this.getLocalSnapshot(normalizedAvatarId);

        try {
            const [json, localSnapshot] = await Promise.all([
                fetchCachedData({
                    queryKey: queryKeys.avatar(normalizedAvatarId, endpoint),
                    policy: entityQueryPolicies.avatar,
                    force,
                    queryFn: async () => {
                        const response = await this.executeGet(
                            `avatars/${encodeURIComponent(normalizedAvatarId)}`,
                            {},
                            { endpoint }
                        );
                        return response.json;
                    }
                }),
                localSnapshotPromise
            ]);

            return this.normalize(json, localSnapshot);
        } catch (error) {
            const localSnapshot = await localSnapshotPromise;
            if (allowLocalFallback && localSnapshot.cachedAvatar) {
                return this.normalize(localSnapshot.cachedAvatar, localSnapshot);
            }

            throw error;
        }
    }

    async getAvatarGallery({ avatarId, endpoint = '', force = false }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.getAvatarGallery requires an avatar id.');
        }

        const rows = await fetchCachedData({
            queryKey: queryKeys.avatarGallery(normalizedAvatarId, endpoint),
            policy: entityQueryPolicies.avatarGallery,
            force,
            queryFn: async () => {
                const response = await this.executeGet(
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
        return rows
            .slice()
            .sort((a, b) => {
                if (!a?.order && !b?.order) {
                    return 0;
                }
                return (Number(a?.order) || 0) - (Number(b?.order) || 0);
            });
    }

    async getAvatarsByUser({
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
            throw new Error('AvatarProfileRepository.getAvatarsByUser requires a user id.');
        }

        const params = { n, offset, sort, order, releaseStatus };
        if (user) {
            params.user = user;
        } else {
            params.userId = normalizedUserId;
        }

        const response = await this.executeGet('avatars', params, { endpoint });
        return Array.isArray(response.json) ? response.json.map((avatar) => this.normalize(avatar)) : [];
    }

    async getAllAvatarsByUser({
        userId,
        user = '',
        endpoint = '',
        sort = 'updated',
        order = 'descending',
        releaseStatus = 'all'
    } = {}) {
        return collectPages(({ n, offset }) =>
            this.getAvatarsByUser({
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

    async selectAvatar({ avatarId, endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.selectAvatar requires an avatar id.');
        }

        const response = await this.executePut(
            `avatars/${encodeURIComponent(normalizedAvatarId)}/select`,
            null,
            { endpoint }
        );
        if (response.json && typeof response.json === 'object') {
            setCachedQueryData(queryKeys.avatar(normalizedAvatarId, endpoint), response.json);
        }
        return response;
    }

    async selectFallbackAvatar({ avatarId, endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.selectFallbackAvatar requires an avatar id.');
        }

        const response = await this.executePut(
            `avatars/${encodeURIComponent(normalizedAvatarId)}/selectfallback`,
            null,
            { endpoint }
        );
        if (response.json && typeof response.json === 'object') {
            setCachedQueryData(queryKeys.avatar(normalizedAvatarId, endpoint), response.json);
        }
        return response;
    }

    async saveAvatar({ avatarId, params = {}, endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.saveAvatar requires an avatar id.');
        }

        const response = await this.executePut(
            `avatars/${encodeURIComponent(normalizedAvatarId)}`,
            params,
            { endpoint }
        );
        if (response.json && typeof response.json === 'object') {
            setCachedQueryData(queryKeys.avatar(normalizedAvatarId, endpoint), response.json);
        }
        return response;
    }

    async getAvatarStyles({ endpoint = '', force = false } = {}) {
        return fetchCachedData({
            queryKey: queryKeys.avatarStyles(endpoint),
            policy: entityQueryPolicies.avatarStyles,
            force,
            queryFn: async () => {
                const response = await this.executeGet('avatarStyles', {}, { endpoint });
                return Array.isArray(response.json) ? response.json : [];
            }
        });
    }

    async deleteAvatar({ avatarId, endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.deleteAvatar requires an avatar id.');
        }

        const response = await this.executeDelete(
            `avatars/${encodeURIComponent(normalizedAvatarId)}`,
            {},
            { endpoint }
        );
        await Promise.allSettled([
            invalidateEntityQueries(queryKeys.avatar(normalizedAvatarId, endpoint)),
            invalidateEntityQueries(queryKeys.avatarGallery(normalizedAvatarId, endpoint))
        ]);
        return response;
    }

    async createImposter({ avatarId, endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.createImposter requires an avatar id.');
        }

        return this.executePost(
            `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`,
            {},
            { endpoint }
        );
    }

    async deleteImposter({ avatarId, endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.deleteImposter requires an avatar id.');
        }

        return this.executeDelete(
            `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor`,
            {},
            { endpoint }
        );
    }

    async getAvatarModerations({ endpoint = '' } = {}) {
        return this.executeGet('auth/user/avatarmoderations', {}, { endpoint });
    }

    async sendAvatarModeration({ avatarId, type = 'block', endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        const normalizedType = normalizeString(type) || 'block';
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.sendAvatarModeration requires an avatar id.');
        }

        return this.executePost(
            'auth/user/avatarmoderations',
            {
                avatarModerationType: normalizedType,
                targetAvatarId: normalizedAvatarId
            },
            { endpoint }
        );
    }

    async deleteAvatarModeration({ avatarId, type = 'block', endpoint = '' }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        const normalizedType = normalizeString(type) || 'block';
        if (!normalizedAvatarId) {
            throw new Error('AvatarProfileRepository.deleteAvatarModeration requires an avatar id.');
        }

        return this.executeDelete(
            'auth/user/avatarmoderations',
            {
                avatarModerationType: normalizedType,
                targetAvatarId: normalizedAvatarId
            },
            { endpoint }
        );
    }

    async getAvatarNameFromImageUrl(imageUrl, { endpoint = '' } = {}) {
        const fileId = extractFileId(imageUrl || '');
        if (!fileId) {
            return {
                ownerId: '',
                avatarName: '-'
            };
        }

        const cacheKey = `${normalizeEndpointDomain(endpoint)}\u0000${fileId}`;
        if (cachedAvatarNames.has(cacheKey)) {
            return cachedAvatarNames.get(cacheKey);
        }

        try {
            const response = await fetchCachedData({
                queryKey: queryKeys.file(fileId, endpoint),
                policy: entityQueryPolicies.fileObject,
                queryFn: () => this.executeGet(`file/${encodeURIComponent(fileId)}`, {}, { endpoint })
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
}

const avatarProfileRepository = new AvatarProfileRepository();

export { AvatarProfileRepository };
export default avatarProfileRepository;
