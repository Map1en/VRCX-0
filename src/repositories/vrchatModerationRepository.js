import sqliteRepository from './sqliteRepository.js';
import userSessionRepository, {
    normalizeUserTablePrefix
} from './userSessionRepository.js';
import { executeVrchatRequest } from './vrchatRequest.js';

function normalizePlayerModerationRow(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    const id =
        typeof row.id === 'string'
            ? row.id.trim()
            : String(row.id ?? '').trim();
    const type =
        typeof row.type === 'string'
            ? row.type.trim()
            : String(row.type ?? '').trim();
    const sourceUserId =
        typeof row.sourceUserId === 'string'
            ? row.sourceUserId.trim()
            : String(row.sourceUserId ?? '').trim();
    const targetUserId =
        typeof row.targetUserId === 'string'
            ? row.targetUserId.trim()
            : String(row.targetUserId ?? '').trim();

    if (!id || !type || !targetUserId) {
        return null;
    }

    return {
        id,
        type,
        sourceUserId,
        sourceDisplayName:
            typeof row.sourceDisplayName === 'string'
                ? row.sourceDisplayName
                : '',
        targetUserId,
        targetDisplayName:
            typeof row.targetDisplayName === 'string'
                ? row.targetDisplayName
                : '',
        created: typeof row.created === 'string' ? row.created : ''
    };
}

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

async function executeGet(path, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
        endpoint,
        method: 'GET',
        fallbackMessage: 'VRChat moderation request failed'
    });
}

async function executePut(path, payload = {}, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
        endpoint,
        method: 'PUT',
        body: payload,
        fallbackMessage: 'VRChat moderation request failed'
    });
}

async function executePost(path, payload = {}, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
        endpoint,
        method: 'POST',
        body: payload,
        fallbackMessage: 'VRChat moderation request failed'
    });
}

async function getPlayerModerations({ endpoint = '' } = {}) {
    const response = await executeGet('auth/user/playermoderations', {
        endpoint
    });
    const rows = Array.isArray(response.json)
        ? response.json.map(normalizePlayerModerationRow).filter(Boolean)
        : [];

    return {
        ...response,
        json: rows
    };
}

async function getAllLocalModerations(ownerUserId) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    await userSessionRepository.ensureUserTables(normalizedOwnerUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedOwnerUserId);
    const rows = await sqliteRepository.query(
        `SELECT user_id, updated_at, display_name, block, mute FROM ${userPrefix}_moderation`
    );
    return Array.isArray(rows)
        ? rows.map((row) => ({
              userId: Array.isArray(row) ? row[0] : row.user_id,
              updatedAt: Array.isArray(row) ? row[1] : row.updated_at,
              displayName: Array.isArray(row) ? row[2] : row.display_name,
              block: Number(Array.isArray(row) ? row[3] : row.block) === 1,
              mute: Number(Array.isArray(row) ? row[4] : row.mute) === 1
          }))
        : [];
}

async function getLocalModerationRow(ownerUserId, userId) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedOwnerUserId || !normalizedUserId) {
        return {};
    }

    await userSessionRepository.ensureUserTables(normalizedOwnerUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedOwnerUserId);
    const rows = await sqliteRepository.query(
        `SELECT user_id, updated_at, display_name, block, mute FROM ${userPrefix}_moderation WHERE user_id = @userId LIMIT 1`,
        {
            '@userId': normalizedUserId
        }
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) {
        return {};
    }
    return {
        userId: Array.isArray(row) ? row[0] : row.user_id,
        updatedAt: Array.isArray(row) ? row[1] : row.updated_at,
        displayName: Array.isArray(row) ? row[2] : row.display_name,
        block: Number(Array.isArray(row) ? row[3] : row.block) === 1,
        mute: Number(Array.isArray(row) ? row[4] : row.mute) === 1
    };
}

async function setLocalModerationRow(ownerUserId, entry) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId || !entry?.userId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedOwnerUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedOwnerUserId);
    await sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO ${userPrefix}_moderation (user_id, updated_at, display_name, block, mute) VALUES (@user_id, @updated_at, @display_name, @block, @mute)`,
        {
            '@user_id': entry.userId,
            '@updated_at': entry.updatedAt,
            '@display_name': entry.displayName,
            '@block': entry.block ? 1 : 0,
            '@mute': entry.mute ? 1 : 0
        }
    );
}

async function deleteLocalModerationRow(ownerUserId, userId) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedOwnerUserId || !normalizedUserId) {
        return;
    }

    await userSessionRepository.ensureUserTables(normalizedOwnerUserId);
    const userPrefix = normalizeUserTablePrefix(normalizedOwnerUserId);
    await sqliteRepository.executeNonQuery(
        `DELETE FROM ${userPrefix}_moderation WHERE user_id = @user_id`,
        {
            '@user_id': normalizedUserId
        }
    );
}

async function syncLocalModerationSnapshot({ ownerUserId, rows = [] } = {}) {
    const moderationByUserId = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.type !== 'block' && row?.type !== 'mute') {
            continue;
        }

        const targetUserId =
            typeof row.targetUserId === 'string'
                ? row.targetUserId.trim()
                : String(row.targetUserId ?? '').trim();
        if (!targetUserId) {
            continue;
        }

        const existing = moderationByUserId.get(targetUserId) ?? {
            userId: targetUserId,
            updatedAt: row.created || new Date().toISOString(),
            displayName: row.targetDisplayName || '',
            block: false,
            mute: false
        };

        moderationByUserId.set(targetUserId, {
            ...existing,
            updatedAt: row.created || existing.updatedAt,
            displayName: row.targetDisplayName || existing.displayName,
            block: existing.block || row.type === 'block',
            mute: existing.mute || row.type === 'mute'
        });
    }

    const existingRows = await getAllLocalModerations(ownerUserId);
    const writes = [];

    for (const row of existingRows) {
        if (row.userId && !moderationByUserId.has(row.userId)) {
            writes.push(deleteLocalModerationRow(ownerUserId, row.userId));
        }
    }

    for (const row of moderationByUserId.values()) {
        writes.push(setLocalModerationRow(ownerUserId, row));
    }

    await Promise.all(writes);
    return Array.from(moderationByUserId.values());
}

async function sendPlayerModeration({ endpoint = '', moderated, type } = {}) {
    const normalizedModerated =
        typeof moderated === 'string'
            ? moderated.trim()
            : String(moderated ?? '').trim();
    const normalizedType =
        typeof type === 'string' ? type.trim() : String(type ?? '').trim();

    if (!normalizedModerated || !normalizedType) {
        throw new Error(
            'VrchatModerationRepository.sendPlayerModeration requires moderated and type.'
        );
    }

    return executePost(
        'auth/user/playermoderations',
        {
            moderated: normalizedModerated,
            type: normalizedType
        },
        { endpoint }
    );
}

async function deletePlayerModeration({ endpoint = '', moderated, type } = {}) {
    const normalizedModerated =
        typeof moderated === 'string'
            ? moderated.trim()
            : String(moderated ?? '').trim();
    const normalizedType =
        typeof type === 'string' ? type.trim() : String(type ?? '').trim();

    if (!normalizedModerated || !normalizedType) {
        throw new Error(
            'VrchatModerationRepository.deletePlayerModeration requires moderated and type.'
        );
    }

    return executePut(
        'auth/user/unplayermoderate',
        {
            moderated: normalizedModerated,
            type: normalizedType
        },
        { endpoint }
    );
}

async function getLocalModeration({ ownerUserId = '', userId } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return {
            userId: '',
            block: false,
            mute: false
        };
    }

    const row = await getLocalModerationRow(ownerUserId, normalizedUserId);
    return {
        userId: normalizedUserId,
        block: Boolean(row?.block),
        mute: Boolean(row?.mute)
    };
}

async function saveLocalModeration({
    userId,
    ownerUserId = '',
    displayName = '',
    block = false,
    mute = false
} = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'VrchatModerationRepository.saveLocalModeration requires a user id.'
        );
    }

    if (!block && !mute) {
        await deleteLocalModerationRow(ownerUserId, normalizedUserId);
        return {
            userId: normalizedUserId,
            block: false,
            mute: false
        };
    }

    const entry = {
        userId: normalizedUserId,
        updatedAt: new Date().toJSON(),
        displayName,
        block,
        mute
    };
    await setLocalModerationRow(ownerUserId, entry);
    return entry;
}

const vrchatModerationRepository = Object.freeze({
    deleteLocalModerationRow,
    executeGet,
    executePut,
    executePost,
    getAllLocalModerations,
    getPlayerModerations,
    syncLocalModerationSnapshot,
    sendPlayerModeration,
    deletePlayerModeration,
    getLocalModeration,
    saveLocalModeration,
    setLocalModerationRow
});

export {
    deleteLocalModerationRow,
    executeGet,
    executePut,
    executePost,
    getAllLocalModerations,
    getPlayerModerations,
    syncLocalModerationSnapshot,
    sendPlayerModeration,
    deletePlayerModeration,
    getLocalModeration,
    saveLocalModeration,
    setLocalModerationRow
};
export default vrchatModerationRepository;
