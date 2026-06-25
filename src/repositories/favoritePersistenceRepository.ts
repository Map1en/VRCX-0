import { commands } from '@/platform/tauri/bindings';

import configRepository from './configRepository';

type ObjectRow = Record<string, unknown>;
export type LocalFavoriteKind = 'friend' | 'avatar' | 'world';

export interface FavoriteCacheEntity {
    id: string;
    authorId: string;
    authorName: string;
    created_at: string;
    description: string;
    imageUrl: string;
    name: string;
    releaseStatus: string;
    thumbnailImageUrl: string;
    updated_at: string;
    version: number;
}

export interface WorldFavoriteRow {
    created_at: string;
    worldId: string;
    groupName: string;
}

export interface AvatarFavoriteRow {
    created_at: string;
    avatarId: string;
    groupName: string;
}

export interface FriendFavoriteRow {
    created_at: string;
    userId: string;
    groupName: string;
}

interface CacheEntryInput {
    id?: unknown;
    authorId?: unknown;
    authorName?: unknown;
    created_at?: unknown;
    description?: unknown;
    imageUrl?: unknown;
    name?: unknown;
    releaseStatus?: unknown;
    thumbnailImageUrl?: unknown;
    updated_at?: unknown;
    version?: unknown;
}

interface LocalFavoriteInput {
    kind?: LocalFavoriteKind;
    entityId?: unknown;
    groupName?: unknown;
}

interface LocalFavoriteGroupInput {
    kind?: LocalFavoriteKind;
    groupName?: unknown;
}

interface RenameLocalFavoriteGroupInput extends LocalFavoriteGroupInput {
    newGroupName?: unknown;
}

const LOCAL_FAVORITE_GROUP_CONFIG_KEYS = Object.freeze({
    friend: 'localFavoriteFriendGroups',
    avatar: 'localFavoriteAvatarGroups',
    world: 'localFavoriteWorldGroups'
} satisfies Record<LocalFavoriteKind, string>);

function asObjectRow(row: ObjectRow | null | undefined): ObjectRow {
    return row ?? {};
}

function isLocalFavoriteKind(kind: unknown): kind is LocalFavoriteKind {
    return kind === 'friend' || kind === 'avatar' || kind === 'world';
}

function getLocalFavoriteGroupConfigKey(kind: unknown): string | undefined {
    return isLocalFavoriteKind(kind)
        ? LOCAL_FAVORITE_GROUP_CONFIG_KEYS[kind]
        : undefined;
}

function normalizeCacheRow(
    row: ObjectRow | null | undefined
): FavoriteCacheEntity {
    const record = asObjectRow(row);
    return {
        id: normalizeEntityId(record.id),
        authorId: normalizeEntityId(record.authorId),
        authorName: normalizeEntityId(record.authorName),
        created_at: normalizeEntityId(record.created_at),
        description: normalizeEntityId(record.description),
        imageUrl: normalizeEntityId(record.imageUrl),
        name: normalizeEntityId(record.name),
        releaseStatus: normalizeEntityId(record.releaseStatus),
        thumbnailImageUrl: normalizeEntityId(record.thumbnailImageUrl),
        updated_at: normalizeEntityId(record.updated_at),
        version: Number(record.version) || 0
    };
}

function normalizeWorldFavoriteRow(
    row: ObjectRow | null | undefined
): WorldFavoriteRow {
    const record = asObjectRow(row);
    return {
        created_at: normalizeEntityId(record.created_at),
        worldId: normalizeEntityId(record.worldId),
        groupName: normalizeGroupName(record.groupName)
    };
}

function normalizeAvatarFavoriteRow(
    row: ObjectRow | null | undefined
): AvatarFavoriteRow {
    const record = asObjectRow(row);
    return {
        created_at: normalizeEntityId(record.created_at),
        avatarId: normalizeEntityId(record.avatarId),
        groupName: normalizeGroupName(record.groupName)
    };
}

function normalizeFriendFavoriteRow(
    row: ObjectRow | null | undefined
): FriendFavoriteRow {
    const record = asObjectRow(row);
    return {
        created_at: normalizeEntityId(record.created_at),
        userId: normalizeEntityId(record.userId),
        groupName: normalizeGroupName(record.groupName)
    };
}

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeGroupName(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeGroupList(values: unknown) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map(normalizeGroupName)
                .filter(Boolean)
        )
    ).sort((left, right) => left.localeCompare(right));
}

async function getExplicitLocalFavoriteGroups(kind: unknown) {
    const key = getLocalFavoriteGroupConfigKey(kind);
    if (!key) {
        return [];
    }

    return normalizeGroupList(await configRepository.getArray(key, []));
}

async function createLocalFavoriteGroup({
    kind,
    groupName
}: LocalFavoriteGroupInput) {
    const key = getLocalFavoriteGroupConfigKey(kind);
    const normalizedGroupName = normalizeGroupName(groupName);
    if (!key || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.createLocalFavoriteGroup requires kind and groupName.'
        );
    }
    if (!isLocalFavoriteKind(kind)) {
        throw new Error('Local favorite kind is invalid.');
    }

    await commands.appLocalFavoriteGroupCreate({
        kind,
        groupName: normalizedGroupName
    });
    await configRepository.reload();
}

async function getWorldFavorites() {
    const rows = (await commands.appFavoriteList('world')) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeWorldFavoriteRow) : [];
}

async function getAvatarFavorites() {
    const rows = (await commands.appFavoriteList('avatar')) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeAvatarFavoriteRow) : [];
}

async function getFriendFavorites() {
    const rows = (await commands.appFavoriteList('friend')) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeFriendFavoriteRow) : [];
}

async function getWorldCache() {
    const rows = (await commands.appWorldCacheList()) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeCacheRow) : [];
}

async function getAvatarCache() {
    const rows = (await commands.appAvatarCacheList()) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeCacheRow) : [];
}

async function addWorldToCache(entry: CacheEntryInput) {
    return commands.appWorldCacheUpsert({
        id: entry.id,
        authorId: entry.authorId,
        authorName: entry.authorName,
        createdAt: entry.created_at,
        description: entry.description,
        imageUrl: entry.imageUrl,
        name: entry.name,
        releaseStatus: entry.releaseStatus,
        thumbnailImageUrl: entry.thumbnailImageUrl,
        updatedAt: entry.updated_at,
        version: entry.version
    });
}

async function getCachedWorldById(id: unknown) {
    const normalizedId = normalizeEntityId(id);
    if (!normalizedId) {
        return null;
    }
    const row = (await commands.appWorldCacheGet(
        normalizedId
    )) as ObjectRow | null;
    return row ? normalizeCacheRow(row) : null;
}

async function removeWorldFromCache(worldId: unknown) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        return;
    }
    await commands.appWorldCacheRemove(normalizedWorldId);
}

async function addLocalFavorite({
    kind,
    entityId,
    groupName
}: LocalFavoriteInput) {
    const validKind = isLocalFavoriteKind(kind);
    const normalizedEntityId = normalizeEntityId(entityId);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!validKind || !normalizedEntityId || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.addLocalFavorite requires kind, entityId, and groupName.'
        );
    }

    return commands.appLocalFavoriteAdd({
        kind,
        entityId: normalizedEntityId,
        groupName: normalizedGroupName
    });
}

function addAvatarToFavorites(avatarId: unknown, groupName: unknown) {
    return addLocalFavorite({
        kind: 'avatar',
        entityId: avatarId,
        groupName
    });
}

function addWorldToFavorites(worldId: unknown, groupName: unknown) {
    return addLocalFavorite({
        kind: 'world',
        entityId: worldId,
        groupName
    });
}

function addFriendToLocalFavorites(userId: unknown, groupName: unknown) {
    return addLocalFavorite({
        kind: 'friend',
        entityId: userId,
        groupName
    });
}

async function removeLocalFavorite({
    kind,
    entityId,
    groupName
}: LocalFavoriteInput) {
    const validKind = isLocalFavoriteKind(kind);
    const normalizedEntityId = normalizeEntityId(entityId);
    const normalizedGroupName = normalizeEntityId(groupName);

    if (!validKind || !normalizedEntityId || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.removeLocalFavorite requires kind, entityId, and groupName.'
        );
    }

    return commands.appLocalFavoriteRemove({
        kind,
        entityId: normalizedEntityId,
        groupName: normalizedGroupName
    });
}

async function renameLocalFavoriteGroup({
    kind,
    groupName,
    newGroupName
}: RenameLocalFavoriteGroupInput) {
    const validKind = isLocalFavoriteKind(kind);
    const normalizedGroupName = normalizeGroupName(groupName);
    const normalizedNewGroupName = normalizeGroupName(newGroupName);

    if (!validKind || !normalizedGroupName || !normalizedNewGroupName) {
        throw new Error(
            'LocalFavoritesRepository.renameLocalFavoriteGroup requires kind, groupName, and newGroupName.'
        );
    }

    const result = await commands.appLocalFavoriteGroupRename({
        kind,
        groupName: normalizedGroupName,
        newGroupName: normalizedNewGroupName
    });

    await configRepository.reload();

    return result;
}

async function deleteLocalFavoriteGroup({
    kind,
    groupName
}: LocalFavoriteGroupInput) {
    const validKind = isLocalFavoriteKind(kind);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!validKind || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.deleteLocalFavoriteGroup requires kind and groupName.'
        );
    }

    const result = await commands.appLocalFavoriteGroupDelete({
        kind,
        groupName: normalizedGroupName
    });

    await configRepository.reload();

    return result;
}

const favoritePersistenceRepository = Object.freeze({
    addAvatarToFavorites,
    addFriendToLocalFavorites,
    addWorldToCache,
    addWorldToFavorites,
    getExplicitLocalFavoriteGroups,
    createLocalFavoriteGroup,
    getCachedWorldById,
    getWorldFavorites,
    getAvatarFavorites,
    getFriendFavorites,
    getWorldCache,
    getAvatarCache,
    addLocalFavorite,
    removeLocalFavorite,
    renameLocalFavoriteGroup,
    deleteLocalFavoriteGroup,
    removeWorldFromCache
});

export {
    addAvatarToFavorites,
    addFriendToLocalFavorites,
    addWorldToCache,
    addWorldToFavorites,
    getExplicitLocalFavoriteGroups,
    createLocalFavoriteGroup,
    getCachedWorldById,
    getWorldFavorites,
    getAvatarFavorites,
    getFriendFavorites,
    getWorldCache,
    getAvatarCache,
    addLocalFavorite,
    removeLocalFavorite,
    renameLocalFavoriteGroup,
    deleteLocalFavoriteGroup,
    removeWorldFromCache
};
export default favoritePersistenceRepository;
