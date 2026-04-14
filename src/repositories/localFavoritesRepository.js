import sqliteRepository from './sqliteRepository.js';
import configRepository from './configRepository.js';

const LOCAL_FAVORITE_GROUP_CONFIG_KEYS = Object.freeze({
    friend: 'localFavoriteFriendGroups',
    avatar: 'localFavoriteAvatarGroups',
    world: 'localFavoriteWorldGroups'
});

function normalizeWorldCacheRow(row) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: row[7] ?? '',
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    return {
        id: row?.id ?? '',
        authorId: row?.author_id ?? row?.authorId ?? '',
        authorName: row?.author_name ?? row?.authorName ?? '',
        created_at: row?.created_at ?? '',
        description: row?.description ?? '',
        imageUrl: row?.image_url ?? row?.imageUrl ?? '',
        name: row?.name ?? '',
        releaseStatus: row?.release_status ?? row?.releaseStatus ?? '',
        thumbnailImageUrl: row?.thumbnail_image_url ?? row?.thumbnailImageUrl ?? '',
        updated_at: row?.updated_at ?? '',
        version: row?.version ?? 0
    };
}

function normalizeAvatarCacheRow(row) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: row[7] ?? '',
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    return {
        id: row?.id ?? '',
        authorId: row?.author_id ?? row?.authorId ?? '',
        authorName: row?.author_name ?? row?.authorName ?? '',
        created_at: row?.created_at ?? '',
        description: row?.description ?? '',
        imageUrl: row?.image_url ?? row?.imageUrl ?? '',
        name: row?.name ?? '',
        releaseStatus: row?.release_status ?? row?.releaseStatus ?? '',
        thumbnailImageUrl: row?.thumbnail_image_url ?? row?.thumbnailImageUrl ?? '',
        updated_at: row?.updated_at ?? '',
        version: row?.version ?? 0
    };
}

function normalizeWorldFavoriteRow(row) {
    if (Array.isArray(row)) {
        return {
            created_at: row[1] ?? '',
            worldId: row[2] ?? '',
            groupName: row[3] ?? ''
        };
    }

    return {
        created_at: row?.created_at ?? '',
        worldId: row?.world_id ?? row?.worldId ?? '',
        groupName: row?.group_name ?? row?.groupName ?? ''
    };
}

function normalizeAvatarFavoriteRow(row) {
    if (Array.isArray(row)) {
        return {
            created_at: row[1] ?? '',
            avatarId: row[2] ?? '',
            groupName: row[3] ?? ''
        };
    }

    return {
        created_at: row?.created_at ?? '',
        avatarId: row?.avatar_id ?? row?.avatarId ?? '',
        groupName: row?.group_name ?? row?.groupName ?? ''
    };
}

function normalizeFriendFavoriteRow(row) {
    if (Array.isArray(row)) {
        return {
            created_at: row[1] ?? '',
            userId: row[2] ?? '',
            groupName: row[3] ?? ''
        };
    }

    return {
        created_at: row?.created_at ?? '',
        userId: row?.user_id ?? row?.userId ?? '',
        groupName: row?.group_name ?? row?.groupName ?? ''
    };
}

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function resolveLocalFavoriteDeleteTarget(kind) {
    if (kind === 'friend') {
        return {
            table: 'favorite_friend',
            column: 'user_id',
            entityParam: '@user_id'
        };
    }

    if (kind === 'avatar') {
        return {
            table: 'favorite_avatar',
            column: 'avatar_id',
            entityParam: '@avatar_id'
        };
    }

    if (kind === 'world') {
        return {
            table: 'favorite_world',
            column: 'world_id',
            entityParam: '@world_id'
        };
    }

    return null;
}

function normalizeGroupName(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeGroupList(values) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map(normalizeGroupName)
                .filter(Boolean)
        )
    ).sort((left, right) => left.localeCompare(right));
}

class LocalFavoritesRepository {
    async getExplicitLocalFavoriteGroups(kind) {
        const key = LOCAL_FAVORITE_GROUP_CONFIG_KEYS[kind];
        if (!key) {
            return [];
        }

        return normalizeGroupList(await configRepository.getArray(key, []));
    }

    async createLocalFavoriteGroup({ kind, groupName }) {
        const key = LOCAL_FAVORITE_GROUP_CONFIG_KEYS[kind];
        const normalizedGroupName = normalizeGroupName(groupName);
        if (!key || !normalizedGroupName) {
            throw new Error('LocalFavoritesRepository.createLocalFavoriteGroup requires kind and groupName.');
        }

        const groups = normalizeGroupList(await configRepository.getArray(key, []));
        if (!groups.includes(normalizedGroupName)) {
            await configRepository.setArray(key, [...groups, normalizedGroupName].sort());
        }
    }

    async getWorldFavorites() {
        const rows = await sqliteRepository.query('SELECT * FROM favorite_world');
        return Array.isArray(rows) ? rows.map(normalizeWorldFavoriteRow) : [];
    }

    async getAvatarFavorites() {
        const rows = await sqliteRepository.query('SELECT * FROM favorite_avatar');
        return Array.isArray(rows) ? rows.map(normalizeAvatarFavoriteRow) : [];
    }

    async getFriendFavorites() {
        const rows = await sqliteRepository.query('SELECT * FROM favorite_friend');
        return Array.isArray(rows) ? rows.map(normalizeFriendFavoriteRow) : [];
    }

    async getWorldCache() {
        const rows = await sqliteRepository.query('SELECT * FROM cache_world');
        return Array.isArray(rows) ? rows.map(normalizeWorldCacheRow) : [];
    }

    async getAvatarCache() {
        const rows = await sqliteRepository.query('SELECT * FROM cache_avatar');
        return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
    }

    async addLocalFavorite({ kind, entityId, groupName }) {
        const target = resolveLocalFavoriteDeleteTarget(kind);
        const normalizedEntityId = normalizeEntityId(entityId);
        const normalizedGroupName = normalizeGroupName(groupName);

        if (!target || !normalizedEntityId || !normalizedGroupName) {
            throw new Error('LocalFavoritesRepository.addLocalFavorite requires kind, entityId, and groupName.');
        }

        return sqliteRepository.executeNonQuery(
            `INSERT OR REPLACE INTO ${target.table} (${target.column}, group_name, created_at) VALUES (${target.entityParam}, @group_name, @created_at)`,
            {
                [target.entityParam]: normalizedEntityId,
                '@group_name': normalizedGroupName,
                '@created_at': new Date().toJSON()
            }
        );
    }

    async removeLocalFavorite({ kind, entityId, groupName }) {
        const target = resolveLocalFavoriteDeleteTarget(kind);
        const normalizedEntityId = normalizeEntityId(entityId);
        const normalizedGroupName = normalizeEntityId(groupName);

        if (!target || !normalizedEntityId || !normalizedGroupName) {
            throw new Error('LocalFavoritesRepository.removeLocalFavorite requires kind, entityId, and groupName.');
        }

        return sqliteRepository.executeNonQuery(
            `DELETE FROM ${target.table} WHERE ${target.column} = @entity_id AND group_name = @group_name`,
            {
                '@entity_id': normalizedEntityId,
                '@group_name': normalizedGroupName
            }
        );
    }

    async renameLocalFavoriteGroup({ kind, groupName, newGroupName }) {
        const target = resolveLocalFavoriteDeleteTarget(kind);
        const normalizedGroupName = normalizeGroupName(groupName);
        const normalizedNewGroupName = normalizeGroupName(newGroupName);

        if (!target || !normalizedGroupName || !normalizedNewGroupName) {
            throw new Error('LocalFavoritesRepository.renameLocalFavoriteGroup requires kind, groupName, and newGroupName.');
        }

        const result = await sqliteRepository.executeNonQuery(
            `UPDATE ${target.table} SET group_name = @new_group_name WHERE group_name = @group_name`,
            {
                '@new_group_name': normalizedNewGroupName,
                '@group_name': normalizedGroupName
            }
        );

        const key = LOCAL_FAVORITE_GROUP_CONFIG_KEYS[kind];
        if (key) {
            const groups = normalizeGroupList(await configRepository.getArray(key, []))
                .filter((value) => value !== normalizedGroupName);
            await configRepository.setArray(key, [...groups, normalizedNewGroupName].sort());
        }

        return result;
    }

    async deleteLocalFavoriteGroup({ kind, groupName }) {
        const target = resolveLocalFavoriteDeleteTarget(kind);
        const normalizedGroupName = normalizeGroupName(groupName);

        if (!target || !normalizedGroupName) {
            throw new Error('LocalFavoritesRepository.deleteLocalFavoriteGroup requires kind and groupName.');
        }

        const result = await sqliteRepository.executeNonQuery(
            `DELETE FROM ${target.table} WHERE group_name = @group_name`,
            {
                '@group_name': normalizedGroupName
            }
        );

        const key = LOCAL_FAVORITE_GROUP_CONFIG_KEYS[kind];
        if (key) {
            const groups = normalizeGroupList(await configRepository.getArray(key, []))
                .filter((value) => value !== normalizedGroupName);
            await configRepository.setArray(key, groups);
        }

        return result;
    }
}

const localFavoritesRepository = new LocalFavoritesRepository();

export { LocalFavoritesRepository };
export default localFavoritesRepository;
