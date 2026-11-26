import {
    commands,
    type FavoriteEntityKind,
    type FavoriteRow,
    type LocalFavoriteGroup
} from '@/platform/tauri/bindings';

type LocalFavoriteKind = FavoriteEntityKind;

interface WorldFavoriteRow {
    created_at: string;
    worldId: string;
    groupName: string;
}

interface LocalFavoriteInput {
    kind: LocalFavoriteKind;
    entityId?: string;
    groupId: number;
}

interface RenameLocalFavoriteGroupInput {
    kind: LocalFavoriteKind;
    groupId: number;
    name?: string;
}

function normalizeWorldFavoriteRow(row: FavoriteRow): WorldFavoriteRow {
    return {
        created_at: normalizeText(row.createdAt),
        worldId: normalizeText(row.worldId),
        groupName: normalizeText(row.groupName)
    };
}

function normalizeText(value?: string | null) {
    return value?.trim() ?? '';
}

async function createLocalFavoriteGroup({
    kind,
    name
}: {
    kind: LocalFavoriteKind;
    name?: string;
}): Promise<LocalFavoriteGroup> {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
        throw new Error(
            'LocalFavoritesRepository.createLocalFavoriteGroup requires kind and name.'
        );
    }
    return commands.appLocalFavoriteGroupCreate({
        kind,
        name: normalizedName
    });
}

async function getWorldFavorites() {
    return (await commands.appFavoriteList('world')).map(
        normalizeWorldFavoriteRow
    );
}

async function addLocalFavorite({
    kind,
    entityId,
    groupId
}: LocalFavoriteInput) {
    const normalizedEntityId = normalizeText(entityId);
    if (!normalizedEntityId) {
        throw new Error(
            'LocalFavoritesRepository.addLocalFavorite requires kind, entityId, and groupId.'
        );
    }
    return commands.appLocalFavoriteAdd({
        kind,
        entityId: normalizedEntityId,
        groupId
    });
}

async function removeLocalFavorite({
    kind,
    entityId,
    groupId
}: LocalFavoriteInput) {
    const normalizedEntityId = normalizeText(entityId);
    if (!normalizedEntityId) {
        throw new Error(
            'LocalFavoritesRepository.removeLocalFavorite requires kind, entityId, and groupId.'
        );
    }
    return commands.appLocalFavoriteRemove({
        kind,
        entityId: normalizedEntityId,
        groupId
    });
}

async function renameLocalFavoriteGroup({
    kind,
    groupId,
    name
}: RenameLocalFavoriteGroupInput) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
        throw new Error(
            'LocalFavoritesRepository.renameLocalFavoriteGroup requires kind, groupId, and name.'
        );
    }
    return commands.appLocalFavoriteGroupRename({
        kind,
        groupId,
        name: normalizedName
    });
}

const favoritePersistenceRepository = Object.freeze({
    createLocalFavoriteGroup,
    getWorldFavorites,
    addLocalFavorite,
    removeLocalFavorite,
    renameLocalFavoriteGroup
});

export default favoritePersistenceRepository;
