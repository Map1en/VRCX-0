import type { WorldProfileRecord } from '@/domain/entities/profileEntities';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import {
    commands,
    type HttpApiExecuteResponse,
    type VrchatWorldIdInput as IpcVrchatWorldIdInput,
    type VrchatWorldListByUserInput,
    type VrchatWorldPersistentDataDeleteInput,
    type VrchatWorldSaveInput
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';
import { useWorldFactsStore } from '@/state/worldFactsStore';

import {
    VRCHAT_API_DEFAULT_PAGE_SIZE,
    VRCHAT_PROFILE_MAX_PAGES
} from './paginationConstants';
import { isVrchatRequestError, unwrapVrchatResponse } from './vrchatRequest';

interface WorldRepositoryOptions {
    force?: boolean;
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
    full?: boolean;
    location?: boolean;
}

interface WorldSaveInput extends WorldIdInput {
    params?: Record<string, unknown>;
}

interface WorldPersistentDataInput extends WorldIdInput {
    userId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatWorldResponse<TJson = unknown>(
    response: HttpApiExecuteResponse,
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat world request failed'
    });
}

function worldIdInput(worldId: string): IpcVrchatWorldIdInput {
    return { worldId };
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
        createdAt:
            typeof (source.created_at ?? source.createdAt) === 'string'
                ? String(source.created_at ?? source.createdAt)
                : '',
        updatedAt:
            typeof (source.updated_at ?? source.updatedAt) === 'string'
                ? String(source.updated_at ?? source.updatedAt)
                : '',
        publicationDate:
            source.publicationDate === null
                ? null
                : typeof source.publicationDate === 'string'
                  ? source.publicationDate
                  : '',
        platforms: resolveWorldPlatforms(source)
    };
}

async function collectPages<T>(
    fetchPage: (page: PageRequest) => Promise<T[]>,
    {
        pageSize = VRCHAT_API_DEFAULT_PAGE_SIZE,
        maxPages = VRCHAT_PROFILE_MAX_PAGES
    }: CollectPagesOptions = {}
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
    if (isRecord(world)) {
        useWorldFactsStore.getState().upsertWorldFacts(world);
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

async function fetchWorldProfile({
    worldId
}: WorldIdInput): Promise<WorldProfileRecord> {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.fetchWorldProfile requires a world id.'
        );
    }

    const input = worldIdInput(normalizedWorldId);
    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldGet(input),
        `worlds/${encodeURIComponent(normalizedWorldId)}`
    );
    const world = normalize(response.json);
    recordWorldFact(world);
    return world;
}

async function getWorldProfile({
    worldId,
    force = false,
    dialog = false,
    full = false,
    location = false
}: WorldProfileInput): Promise<WorldProfileRecord> {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.getWorldProfile requires a world id.'
        );
    }

    if (!force && !dialog && !full) {
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
        queryKey: queryKeys.world(
            normalizedWorldId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: location
            ? entityQueryPolicies.worldLocation
            : dialog
              ? entityQueryPolicies.worldDialog
              : entityQueryPolicies.world,
        force,
        queryFn: () => fetchWorldProfile({ worldId: normalizedWorldId })
    });

    return normalize(json);
}

async function getWorldsByUser({
    userId,
    n = 50,
    offset = 0,
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all',
    force = false
}: WorldsByUserOptions = {}): Promise<WorldProfileRecord[]> {
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
        queryKey: queryKeys.worldsByUser(params, DEFAULT_VRCHAT_API_ENDPOINT),
        policy: entityQueryPolicies.worldCollection,
        force,
        queryFn: async () => {
            const input = {
                userId: normalizedUserId,
                n,
                offset,
                sort,
                order,
                releaseStatus
            } satisfies VrchatWorldListByUserInput;
            const response = unwrapVrchatWorldResponse<unknown[]>(
                await commands.appVrchatWorldListByUserGet(input),
                'worlds'
            );
            return Array.isArray(response.json) ? response.json : [];
        }
    });
    const worlds = rows.map((world) => normalize(world));
    useWorldFactsStore.getState().upsertWorldFacts(worlds);
    return worlds;
}

async function saveWorld({ worldId, params = {} }: WorldSaveInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.saveWorld requires a world id.'
        );
    }

    const input = {
        worldId: normalizedWorldId,
        params
    } satisfies VrchatWorldSaveInput;
    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldSave(input),
        `worlds/${encodeURIComponent(normalizedWorldId)}`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, DEFAULT_VRCHAT_API_ENDPOINT),
            response.json
        );
        recordWorldFact(normalize(response.json));
    }
    return response;
}

async function deleteWorld({ worldId }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.deleteWorld requires a world id.'
        );
    }

    return unwrapVrchatWorldResponse(
        await commands.appVrchatWorldDelete(worldIdInput(normalizedWorldId)),
        `worlds/${encodeURIComponent(normalizedWorldId)}`
    );
}

async function publishWorld({ worldId }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.publishWorld requires a world id.'
        );
    }

    const input = worldIdInput(normalizedWorldId);
    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldPublish(input),
        `worlds/${encodeURIComponent(normalizedWorldId)}/publish`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, DEFAULT_VRCHAT_API_ENDPOINT),
            response.json
        );
        recordWorldFact(normalize(response.json));
    }
    return response;
}

async function unpublishWorld({ worldId }: WorldIdInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.unpublishWorld requires a world id.'
        );
    }

    const input = worldIdInput(normalizedWorldId);
    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldUnpublish(input),
        `worlds/${encodeURIComponent(normalizedWorldId)}/publish`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.world(normalizedWorldId, DEFAULT_VRCHAT_API_ENDPOINT),
            response.json
        );
        recordWorldFact(normalize(response.json));
    }
    return response;
}

async function deleteWorldPersistentData({
    userId,
    worldId
}: WorldPersistentDataInput) {
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedUserId || !normalizedWorldId) {
        throw new Error(
            'WorldProfileRepository.deleteWorldPersistentData requires user and world ids.'
        );
    }

    const input = {
        userId: normalizedUserId,
        worldId: normalizedWorldId
    } satisfies VrchatWorldPersistentDataDeleteInput;
    const response = unwrapVrchatWorldResponse(
        await commands.appVrchatWorldPersistentDataDelete(input),
        `users/${encodeURIComponent(normalizedUserId)}/${encodeURIComponent(normalizedWorldId)}/persist`
    );
    setCachedQueryData(
        queryKeys.worldPersistData(
            { userId: normalizedUserId, worldId: normalizedWorldId },
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        false
    );
    return response;
}

async function hasWorldPersistentData({
    userId,
    worldId,
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
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.worldPersistData,
        force,
        queryFn: async () => {
            const input = {
                userId: normalizedUserId,
                worldId: normalizedWorldId
            } satisfies VrchatWorldPersistentDataDeleteInput;
            try {
                const response = unwrapVrchatWorldResponse(
                    await commands.appVrchatWorldPersistentDataExists(input),
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
            } catch (error) {
                if (isVrchatRequestError(error) && error.status === 404) {
                    return false;
                }
                throw error;
            }
        }
    });
}

async function getAllWorldsByUser({
    userId,
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all',
    force = false
}: WorldsByUserOptions = {}) {
    return collectPages(({ n, offset }) =>
        getWorldsByUser({
            userId,
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
export type { WorldProfileRecord } from '@/domain/entities/profileEntities';
export default worldProfileRepository;
