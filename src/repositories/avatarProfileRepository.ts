import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache.js';
import { storeAvatarImage } from '@/shared/utils/avatar.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';

import avatarLocalRepository from './avatarLocalRepository.js';
import memoRepository from './memoRepository.js';
import {
    executeVrchatBackendRequest,
    type QueryParams
} from './vrchatRequest.js';

type AvatarRecord = Record<string, any>;

interface AvatarProfileExtras extends AvatarRecord {
    cachedAvatar?: AvatarRecord | null;
    localTags?: unknown[];
    timeSpent?: unknown;
    memo?: unknown;
}

interface AvatarListOptions {
    userId?: unknown;
    user?: string;
    endpoint?: string;
    n?: number;
    offset?: number;
    sort?: string;
    order?: string;
    releaseStatus?: string;
}

const cachedAvatarNames = new Map<string, any>();

function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeMemoString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function normalizeArray(values: unknown): string[] {
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

function normalizeLocalTags(
    values: unknown
): Array<{ tag: string; color: string | null }> {
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

function normalizeUnityPackages(values: unknown): AvatarRecord[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values.filter((value) => value && typeof value === 'object');
}

function parseInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAvatarProfile(
    avatar: AvatarRecord | null | undefined,
    extras: AvatarProfileExtras = {}
) {
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

async function collectPages<T>(
    fetchPage: (page: { n: number; offset: number }) => Promise<T[]>,
    { pageSize = 100, maxPages = 50 } = {}
): Promise<T[]> {
    const rows: T[] = [];

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

function normalize(avatar: AvatarRecord, extras: AvatarProfileExtras = {}) {
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

async function executeGet(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<AvatarRecord | AvatarRecord[]>(
        'VrchatAvatarExecute',
        path,
        {
            endpoint,
            method: 'GET',
            params,
            fallbackMessage: 'VRChat avatar request failed'
        }
    );
}

async function executePut(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<AvatarRecord>(
        'VrchatAvatarExecute',
        path,
        {
            endpoint,
            method: 'PUT',
            body: params,
            jsonBody: params !== null,
            fallbackMessage: 'VRChat avatar request failed'
        }
    );
}

async function executePost(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<AvatarRecord>(
        'VrchatAvatarExecute',
        path,
        {
            endpoint,
            method: 'POST',
            body: params,
            fallbackMessage: 'VRChat avatar request failed'
        }
    );
}

async function executeDelete(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<AvatarRecord>(
        'VrchatAvatarExecute',
        path,
        {
            endpoint,
            method: 'DELETE',
            params,
            queryParams: params,
            jsonBody: false,
            fallbackMessage: 'VRChat avatar request failed'
        }
    );
}

async function getLocalSnapshot(
    avatarId: unknown,
    currentUserId = ''
): Promise<AvatarProfileExtras> {
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
    dialog = false,
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
                policy: dialog
                    ? entityQueryPolicies.avatarDialog
                    : entityQueryPolicies.avatar,
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

async function getAvatarGallery({
    avatarId,
    endpoint = '',
    force = false
}: {
    avatarId?: unknown;
    endpoint?: string;
    force?: boolean;
}) {
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
}: AvatarListOptions = {}) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarsByUser requires a user id.'
        );
    }

    const params: QueryParams = { n, offset, sort, order, releaseStatus };
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
}: Omit<AvatarListOptions, 'n' | 'offset'> = {}) {
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
