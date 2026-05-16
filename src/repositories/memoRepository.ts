import { backend } from '@/platform/index.js';

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

    return (
        ((await backend.app.MemoGetUser({
            userId: normalizedUserId
        })) as UserMemoEntry | null) ?? createEmptyUserMemo(normalizedUserId)
    );
}

async function getAllUserMemos() {
    const rows = (await backend.app.MemoListUsers()) as UserMemoEntry[];
    return Array.isArray(rows)
        ? rows.map((row) => ({
              userId: row.userId,
              memo: row.memo
          }))
        : [];
}

async function getAllUserNotes(ownerUserId: unknown = '') {
    const normalizedOwnerUserId = normalizeEntityId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    const rows = (await backend.app.MemoListUserNotes({
        ownerUserId: normalizedOwnerUserId
    })) as Array<{
        userId: unknown;
        displayName: unknown;
        note: unknown;
        createdAt: unknown;
    }>;
    return Array.isArray(rows) ? rows : [];
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

    return (
        ((await backend.app.MemoGetWorld({
            worldId: normalizedWorldId
        })) as WorldMemoEntry | null) ?? createEmptyWorldMemo(normalizedWorldId)
    );
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

    return (
        ((await backend.app.MemoGetAvatar({
            avatarId: normalizedAvatarId
        })) as AvatarMemoEntry | null) ??
        createEmptyAvatarMemo(normalizedAvatarId)
    );
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
