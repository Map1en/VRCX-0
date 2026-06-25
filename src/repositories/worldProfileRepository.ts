import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { useWorldFactsStore } from '@/state/worldFactsStore';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

interface WorldRepositoryOptions {
    endpoint?: string;
    force?: boolean;
    [key: string]: unknown;
}

interface WorldsByUserOptions extends WorldRepositoryOptions {
    userId?: unknown;
    n?: number;
    offset?: number;
    sort?: string;
    order?: string;
    releaseStatus?: string;
}

interface PageRequest {
    n: number;
    offset: number;
}

interface CollectPagesOptions {
    pageSize?: number;
    maxPages?: number;
}

interface WorldIdInput extends WorldRepositoryOptions {
    worldId?: unknown;
}

interface WorldProfileInput extends WorldIdInput {
    dialog?: boolean;
    location?: boolean;
}

interface WorldSaveInput extends WorldIdInput {
    params?: Record<string, unknown>;
}

interface WorldPersistentDataInput extends WorldIdInput {
    userId?: unknown;
}

type WorldRecord = Record<string, unknown>;
type WorldProfileRecord = WorldRecord & {
    id: string;
    name: string;
    description: string;
    authorId: string;
    authorName: string;
    releaseStatus: string;
    thumbnailImageUrl: string;
    imageUrl: string;
    occupants: number;
    capacity: number;
    recommendedCapacity: number;
    favorites: number;
    visits: number;
    popularity: number;
    heat: number;
    tags: string[];
    isLabs: boolean;
    createdAt: unknown;
    updatedAt: unknown;
    publicationDate: unknown;
    platforms: string[];
    created_at?: unknown;
    updated_at?: unknown;
    unityPackages?: unknown;
    version?: unknown;
    hasPersistData?: unknown;
};

type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatWorldResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat world request failed'
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

function normalizeEntityId(value: unknown) {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (isRecord(value)) {
        return normalizeEntityId(
            value.id ??
                value.worldId ??
                value.world_id ??
                value.userId ??
                value.user_id ??
                value.avatarId ??
                value.avatar_id ??
                value.groupId ??
                value.group_id
        );
    }

    return String(value ?? '').trim();
}

function normalizeArray(values: unknown) {
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

function parseNumber(value: unknown) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveWorldPlatforms(world: unknown) {
    const source = isRecord(world) ? world : {};
    const names = new Set<string>();
    const candidates: unknown[] = [];

    if (Array.isArray(source.platforms)) {
        candidates.push(...source.platforms);
    }

    if (Array.isArray(source.unityPackages)) {
        for (const pkg of source.unityPackages) {
            const packageRecord = isRecord(pkg) ? pkg : {};
            const assetVersion = isRecord(packageRecord.assetVersion)
                ? packageRecord.assetVersion
                : {};
            candidates.push(
                packageRecord.platform,
                packageRecord.platformName,
                assetVersion.platform
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

function normalizeWorldProfile(world: unknown): WorldProfileRecord {
    const source = isRecord(world) ? world : {};
    const tags = normalizeArray(source.tags);

    return {
        ...source,
        id: normalizeEntityId(source.id),
        name: normalizeEntityId(source.name),
        description:
            typeof source.description === 'string'
                ? source.description.trim()
                : '',
        authorId: normalizeEntityId(source.authorId),
        authorName:
            normalizeEntityId(source.authorName) ||
            normalizeEntityId(source.authorId) ||
            'Unknown author',
        releaseStatus: normalizeEntityId(source.releaseStatus) || 'unknown',
        thumbnailImageUrl:
            typeof source.thumbnailImageUrl === 'string'
                ? source.thumbnailImageUrl.trim()
                : '',
        imageUrl:
            typeof source.imageUrl === 'string' ? source.imageUrl.trim() : '',
        occupants: parseNumber(source.occupants),
        capacity: parseNumber(source.capacity),
        recommendedCapacity: parseNumber(source.recommendedCapacity),
        favorites: parseNumber(source.favorites),
        visits: parseNumber(source.visits),
        popularity: parseNumber(source.popularity),
        heat: parseNumber(source.heat),
        tags,
        isLabs: tags.includes('system_labs'),
        createdAt: source.created_at ?? source.createdAt ?? '',
        updatedAt: source.updated_at ?? source.updatedAt ?? '',
        publicationDate: source.publicationDate ?? '',
        platforms: resolveWorldPlatforms(source)
    };
}

async function collectPages<T>(
    fetchPage: (page: PageRequest) => Promise<T[]>,
    { pageSize = 100, maxPages = 50 }: CollectPagesOptions = {}
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

function normalize(world: unknown): WorldProfileRecord {
    return normalizeWorldProfile(world);
}

function recordWorldFact(world: unknown) {
    if (world && typeof world === 'object') {
        useWorldFactsStore.getState().upsertWorldFacts(world as WorldRecord);
    }
}

function getMirroredWorldProfile(worldId: string): WorldProfileRecord | null {
    const world = useWorldFactsStore.getState().getWorldFact(worldId);
    return world ? normalize(world) : null;
}

async function getLocalCachedWorldProfile(
    worldId: string
): Promise<WorldProfileRecord | null> {
    try {
        const world = await commands.appWorldCacheGet(worldId);
        return world ? normalize(world) : null;
    } catch (error) {
        console.warn('Failed to read local world cache:', error);
        return null;
    }
}

async function fetchWorldProfile({ worldId, endpoint = '' }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.fetchWorldProfile requires a world id.'
        );
    }

    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldGet({
            worldId: normalizedWorldId,
            endpoint
        }),
        `worlds/${encodeURIComponent(normalizedWorldId)}`
    );
    const world = normalize(response.json);
    recordWorldFact(world);
    return world;
}

async function getWorldProfile({
    worldId,
    endpoint = '',
    force = false,
    dialog = false,
    location = false
}: WorldProfileInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.getWorldProfile requires a world id.'
        );
    }

    if (!force && !dialog) {
        const mirroredWorld = getMirroredWorldProfile(normalizedWorldId);
        if (mirroredWorld) {
            return mirroredWorld;
        }
        const localWorld = await getLocalCachedWorldProfile(normalizedWorldId);
        if (localWorld) {
            return localWorld;
        }
    }

    const json = await fetchCachedData({
        queryKey: queryKeys.world(normalizedWorldId, endpoint),
        policy: location
            ? entityQueryPolicies.worldLocation
            : dialog
              ? entityQueryPolicies.worldDialog
              : entityQueryPolicies.world,
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
}: WorldsByUserOptions = {}) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'WorldProfileRepository.getWorldsByUser requires a user id.'
        );
    }

    const params: Record<string, unknown> = {
        n,
        offset,
        sort,
        order,
        userId: normalizedUserId,
        releaseStatus
    };
    const rows = await fetchCachedData<unknown[]>({
        queryKey: queryKeys.worldsByUser(params, endpoint),
        policy: entityQueryPolicies.worldCollection,
        force,
        queryFn: async () => {
            const response = unwrapVrchatWorldResponse<unknown[]>(
                await commands.appVrchatWorldListByUserGet({
                    endpoint,
                    userId: normalizedUserId,
                    n,
                    offset,
                    sort,
                    order,
                    releaseStatus
                }),
                'worlds'
            );
            return Array.isArray(response.json) ? response.json : [];
        }
    });

    const worlds = rows.map((world) => normalize(world));
    useWorldFactsStore.getState().upsertWorldFacts(worlds);
    return worlds;
}

async function saveWorld({
    worldId,
    params = {},
    endpoint = ''
}: WorldSaveInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.saveWorld requires a world id.'
        );
    }

    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldSave({
            worldId: normalizedWorldId,
            params,
            endpoint
        }),
        `worlds/${encodeURIComponent(normalizedWorldId)}`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, endpoint),
            response.json
        );
        recordWorldFact(normalize(response.json));
    }
    return response;
}

async function deleteWorld({ worldId, endpoint = '' }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.deleteWorld requires a world id.'
        );
    }

    return unwrapVrchatWorldResponse(
        await commands.appVrchatWorldDelete({
            worldId: normalizedWorldId,
            endpoint
        }),
        `worlds/${encodeURIComponent(normalizedWorldId)}`
    );
}

async function publishWorld({ worldId, endpoint = '' }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.publishWorld requires a world id.'
        );
    }

    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldPublish({
            worldId: normalizedWorldId,
            endpoint
        }),
        `worlds/${encodeURIComponent(normalizedWorldId)}/publish`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, endpoint),
            response.json
        );
        recordWorldFact(normalize(response.json));
    }
    return response;
}

async function unpublishWorld({ worldId, endpoint = '' }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.unpublishWorld requires a world id.'
        );
    }

    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldUnpublish({
            worldId: normalizedWorldId,
            endpoint
        }),
        `worlds/${encodeURIComponent(normalizedWorldId)}/publish`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, endpoint),
            response.json
        );
        recordWorldFact(normalize(response.json));
    }
    return response;
}

async function deleteWorldPersistentData({
    userId,
    worldId,
    endpoint = ''
}: WorldPersistentDataInput) {
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedUserId || !normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.deleteWorldPersistentData requires user and world ids.'
        );
    }

    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldPersistentDataDelete({
            userId: normalizedUserId,
            worldId: normalizedWorldId,
            endpoint
        }),
        `users/${encodeURIComponent(normalizedUserId)}/${encodeURIComponent(normalizedWorldId)}/persist`
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
}: WorldPersistentDataInput) {
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
            const response = unwrapVrchatWorldResponse(
                await commands.appVrchatWorldPersistentDataExists({
                    userId: normalizedUserId,
                    worldId: normalizedWorldId,
                    endpoint
                }),
                `users/${encodeURIComponent(normalizedUserId)}/${encodeURIComponent(normalizedWorldId)}/persist/exists`
            );
            if (typeof response.json === 'boolean') {
                return response.json;
            }
            if (
                isRecord(response.json) &&
                typeof response.json.exists === 'boolean'
            ) {
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
}: WorldsByUserOptions = {}) {
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
