import { backend } from '@/platform/index.js';

import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

interface SaveUserMemoInput {
    userId?: unknown;
    memo?: unknown;
}

interface SaveWorldMemoInput {
    worldId?: unknown;
    memo?: unknown;
}

interface SaveAvatarMemoInput {
    avatarId?: unknown;
    memo?: unknown;
}

interface UserMemoEntry {
    userId: unknown;
    editedAt: unknown;
    memo: unknown;
}

interface WorldMemoEntry {
    worldId: unknown;
    editedAt: unknown;
    memo: unknown;
}

interface AvatarMemoEntry {
    avatarId: unknown;
    editedAt: unknown;
    memo: unknown;
}

interface BackendMemoSaveResult {
    entityId: unknown;
    editedAt: unknown;
    memo: unknown;
}

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function createEmptyUserMemo(userId: unknown = '') {
    return {
        userId,
        editedAt: '',
        memo: ''
    };
}

function createEmptyWorldMemo(worldId: unknown = '') {
    return {
        worldId,
        editedAt: '',
        memo: ''
    };
}

function createEmptyAvatarMemo(avatarId: unknown = '') {
    return {
        avatarId,
        editedAt: '',
        memo: ''
    };
}

async function getUserMemo(userId: unknown) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        return createEmptyUserMemo();
    }

    let row: UserMemoEntry = createEmptyUserMemo(normalizedUserId);
    await sqliteRepository.execute<unknown[]>(
        (dbRow) => {
            row = {
                userId: dbRow[0],
                editedAt: dbRow[1],
                memo: dbRow[2]
            };
        },
        'SELECT user_id, edited_at, memo FROM memos WHERE user_id = @user_id',
        {
            '@user_id': normalizedUserId
        }
    );
    return row;
}

async function getAllUserMemos() {
    const rows: Array<{
        userId: unknown;
        memo: unknown;
    }> = [];
    await sqliteRepository.execute<unknown[]>((dbRow) => {
        rows.push({
            userId: dbRow[0],
            memo: dbRow[1]
        });
    }, 'SELECT user_id, memo FROM memos');
    return rows;
}

async function getAllUserNotes(ownerUserId: unknown = '') {
    const normalizedOwnerUserId = normalizeEntityId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    const userPrefix = normalizeUserTablePrefix(normalizedOwnerUserId);
    const rows: Array<{
        userId: unknown;
        displayName: unknown;
        note: unknown;
        createdAt: unknown;
    }> = [];
    await sqliteRepository.execute<unknown[]>((dbRow) => {
        rows.push({
            userId: dbRow[0],
            displayName: dbRow[1],
            note: dbRow[2],
            createdAt: dbRow[3]
        });
    }, `SELECT user_id, display_name, note, created_at FROM ${userPrefix}_notes`);
    return rows;
}

async function saveUserMemo({ userId, memo }: SaveUserMemoInput) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error('MemoRepository.saveUserMemo requires a user id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await backend.app.MemoSaveUser({
            userId: normalizedUserId,
            memo: ''
        });
        return createEmptyUserMemo(normalizedUserId);
    }

    const entry = (await backend.app.MemoSaveUser({
        userId: normalizedUserId,
        memo: nextMemo
    })) as BackendMemoSaveResult;
    return {
        userId: entry.entityId,
        editedAt: entry.editedAt,
        memo: entry.memo
    };
}

async function getWorldMemo(worldId: unknown) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        return createEmptyWorldMemo();
    }

    let row: WorldMemoEntry = createEmptyWorldMemo(normalizedWorldId);
    await sqliteRepository.execute<unknown[]>(
        (dbRow) => {
            row = {
                worldId: dbRow[0],
                editedAt: dbRow[1],
                memo: dbRow[2]
            };
        },
        'SELECT world_id, edited_at, memo FROM world_memos WHERE world_id = @world_id',
        {
            '@world_id': normalizedWorldId
        }
    );
    return row;
}

async function saveWorldMemo({ worldId, memo }: SaveWorldMemoInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error('MemoRepository.saveWorldMemo requires a world id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await backend.app.MemoSaveWorld({
            worldId: normalizedWorldId,
            memo: ''
        });
        return createEmptyWorldMemo(normalizedWorldId);
    }

    const entry = (await backend.app.MemoSaveWorld({
        worldId: normalizedWorldId,
        memo: nextMemo
    })) as BackendMemoSaveResult;
    return {
        worldId: entry.entityId,
        editedAt: entry.editedAt,
        memo: entry.memo
    };
}

async function getAvatarMemo(avatarId: unknown) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        return createEmptyAvatarMemo();
    }

    let row: AvatarMemoEntry = createEmptyAvatarMemo(normalizedAvatarId);
    await sqliteRepository.execute<unknown[]>(
        (dbRow) => {
            row = {
                avatarId: dbRow[0],
                editedAt: dbRow[1],
                memo: dbRow[2]
            };
        },
        'SELECT avatar_id, edited_at, memo FROM avatar_memos WHERE avatar_id = @avatar_id',
        {
            '@avatar_id': normalizedAvatarId
        }
    );
    return row;
}

async function saveAvatarMemo({ avatarId, memo }: SaveAvatarMemoInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error('MemoRepository.saveAvatarMemo requires an avatar id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await backend.app.MemoSaveAvatar({
            avatarId: normalizedAvatarId,
            memo: ''
        });
        return createEmptyAvatarMemo(normalizedAvatarId);
    }

    const entry = (await backend.app.MemoSaveAvatar({
        avatarId: normalizedAvatarId,
        memo: nextMemo
    })) as BackendMemoSaveResult;
    return {
        avatarId: entry.entityId,
        editedAt: entry.editedAt,
        memo: entry.memo
    };
}

const memoRepository = Object.freeze({
    createEmptyUserMemo,
    createEmptyWorldMemo,
    createEmptyAvatarMemo,
    getUserMemo,
    getAllUserMemos,
    getAllUserNotes,
    saveUserMemo,
    getWorldMemo,
    saveWorldMemo,
    getAvatarMemo,
    saveAvatarMemo
});

export {
    createEmptyUserMemo,
    createEmptyWorldMemo,
    createEmptyAvatarMemo,
    getUserMemo,
    getAllUserMemos,
    getAllUserNotes,
    saveUserMemo,
    getWorldMemo,
    saveWorldMemo,
    getAvatarMemo,
    saveAvatarMemo
};
export default memoRepository;
