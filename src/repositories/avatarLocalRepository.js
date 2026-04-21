import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

function normalizeId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function avatarHistoryTableName(userId) {
    return `${normalizeUserTablePrefix(userId)}_avatar_history`;
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
        thumbnailImageUrl:
            row?.thumbnail_image_url ?? row?.thumbnailImageUrl ?? '',
        updated_at: row?.updated_at ?? '',
        version: row?.version ?? 0
    };
}

async function addAvatarToCache(entry) {
    return sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO cache_avatar (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES (@id, @added_at, @author_id, @author_name, @created_at, @description, @image_url, @name, @release_status, @thumbnail_image_url, @updated_at, @version)`,
        {
            '@id': entry.id,
            '@added_at': new Date().toJSON(),
            '@author_id': entry.authorId,
            '@author_name': entry.authorName,
            '@created_at': entry.created_at,
            '@description': entry.description,
            '@image_url': entry.imageUrl,
            '@name': entry.name,
            '@release_status': entry.releaseStatus,
            '@thumbnail_image_url': entry.thumbnailImageUrl,
            '@updated_at': entry.updated_at,
            '@version': entry.version
        }
    );
}

async function getCachedAvatarById(id) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
        return null;
    }

    const rows = await sqliteRepository.query(
        'SELECT * FROM cache_avatar WHERE id = @id LIMIT 1',
        {
            '@id': normalizedId
        }
    );
    return Array.isArray(rows) && rows.length
        ? normalizeAvatarCacheRow(rows[0])
        : null;
}

async function getAvatarCache() {
    const rows = await sqliteRepository.query('SELECT * FROM cache_avatar');
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function removeAvatarFromCache(avatarId) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }
    await sqliteRepository.executeNonQuery(
        'DELETE FROM cache_avatar WHERE id = @avatar_id',
        {
            '@avatar_id': normalizedAvatarId
        }
    );
}

async function addAvatarToHistory(userId, avatarId) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }

    await sqliteRepository.executeNonQuery(
        `INSERT INTO ${avatarHistoryTableName(userId)} (avatar_id, created_at, time)
         VALUES (@avatar_id, @created_at, 0)
         ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at`,
        {
            '@avatar_id': normalizedAvatarId,
            '@created_at': new Date().toJSON()
        }
    );
}

async function addAvatarTimeSpent(userId, avatarId, timeSpent) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }

    await sqliteRepository.executeNonQuery(
        `UPDATE ${avatarHistoryTableName(userId)} SET time = time + @timeSpent WHERE avatar_id = @avatarId`,
        {
            '@avatarId': normalizedAvatarId,
            '@timeSpent': Number.parseInt(timeSpent ?? 0, 10) || 0
        }
    );
}

async function getAvatarTimeSpent(userId, avatarId) {
    const normalizedAvatarId = normalizeId(avatarId);
    const ref = {
        timeSpent: 0,
        avatarId: normalizedAvatarId
    };
    if (!normalizedAvatarId) {
        return ref;
    }

    await sqliteRepository.execute(
        (row) => {
            ref.timeSpent = Number.parseInt(row[0] ?? 0, 10) || 0;
        },
        `SELECT time FROM ${avatarHistoryTableName(userId)} WHERE avatar_id = @avatarId`,
        {
            '@avatarId': normalizedAvatarId
        }
    );
    return ref;
}

async function getAllAvatarTimeSpent(userId) {
    const map = new Map();
    await sqliteRepository.execute((row) => {
        map.set(row[0], Number.parseInt(row[1] ?? 0, 10) || 0);
    }, `SELECT avatar_id, time FROM ${avatarHistoryTableName(userId)}`);
    return map;
}

async function getAvatarHistory(userId, limit = 100) {
    const tableName = avatarHistoryTableName(userId);
    const rows = await sqliteRepository.query(
        `SELECT cache_avatar.*
         FROM ${tableName}
         INNER JOIN cache_avatar ON cache_avatar.id = ${tableName}.avatar_id
         WHERE author_id != @currentUserId
         ORDER BY ${tableName}.created_at DESC
         LIMIT @limit`,
        {
            '@currentUserId': normalizeId(userId),
            '@limit': Number.parseInt(limit ?? 100, 10) || 100
        }
    );
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function clearAvatarHistory(userId) {
    await sqliteRepository.executeNonQuery(
        `DELETE FROM ${avatarHistoryTableName(userId)}`
    );
    await sqliteRepository.executeNonQuery('DELETE FROM cache_avatar');
}

async function getAvatarTags(avatarId) {
    const tags = [];
    await sqliteRepository.execute(
        (row) => {
            tags.push({ tag: row[0], color: row[1] || null });
        },
        'SELECT tag, color FROM avatar_tags WHERE avatar_id = @avatar_id',
        {
            '@avatar_id': normalizeId(avatarId)
        }
    );
    return tags;
}

async function getAllAvatarTags() {
    const map = new Map();
    await sqliteRepository.execute((row) => {
        const avatarId = row[0];
        const tag = row[1];
        const color = row[2] || null;
        if (!map.has(avatarId)) {
            map.set(avatarId, []);
        }
        map.get(avatarId).push({ tag, color });
    }, 'SELECT avatar_id, tag, color FROM avatar_tags');
    return map;
}

async function getAllDistinctTags() {
    const tags = [];
    await sqliteRepository.execute((row) => {
        tags.push(row[0]);
    }, 'SELECT DISTINCT tag FROM avatar_tags ORDER BY tag');
    return tags;
}

async function addAvatarTag(avatarId, tag, color = null) {
    await sqliteRepository.executeNonQuery(
        'INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)',
        {
            '@avatar_id': normalizeId(avatarId),
            '@tag': tag,
            '@color': color
        }
    );
}

async function updateAvatarTagColor(avatarId, tag, color) {
    await sqliteRepository.executeNonQuery(
        'UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag',
        {
            '@avatar_id': normalizeId(avatarId),
            '@tag': tag,
            '@color': color
        }
    );
}

async function removeAvatarTag(avatarId, tag) {
    await sqliteRepository.executeNonQuery(
        'DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag',
        {
            '@avatar_id': normalizeId(avatarId),
            '@tag': tag
        }
    );
}

async function removeAllAvatarTags(avatarId) {
    await sqliteRepository.executeNonQuery(
        'DELETE FROM avatar_tags WHERE avatar_id = @avatar_id',
        {
            '@avatar_id': normalizeId(avatarId)
        }
    );
}

const avatarLocalRepository = Object.freeze({
    addAvatarTag,
    addAvatarTimeSpent,
    addAvatarToCache,
    addAvatarToHistory,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarCache,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    getCachedAvatarById,
    removeAllAvatarTags,
    removeAvatarFromCache,
    removeAvatarTag,
    updateAvatarTagColor
});

export {
    addAvatarTag,
    addAvatarTimeSpent,
    addAvatarToCache,
    addAvatarToHistory,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarCache,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    getCachedAvatarById,
    removeAllAvatarTags,
    removeAvatarFromCache,
    removeAvatarTag,
    updateAvatarTagColor
};
export default avatarLocalRepository;
