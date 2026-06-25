import { commands } from '@/platform/tauri/bindings';

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

interface LocalMemoSaveResult {
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
        ((await commands.appMemoGetUser(
            normalizedUserId
        )) as UserMemoEntry | null) ?? createEmptyUserMemo(normalizedUserId)
    );
}

async function getAllUserMemos() {
    const rows = (await commands.appMemoListUsers()) as UserMemoEntry[];
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

    const rows = (await commands.appMemoListUserNotes(
        normalizedOwnerUserId
    )) as Array<{
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
        await commands.appMemoSaveUser(normalizedUserId, '');
        return createEmptyUserMemo(normalizedUserId);
    }

    const entry = (await commands.appMemoSaveUser(
        normalizedUserId,
        nextMemo
    )) as LocalMemoSaveResult;
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
        ((await commands.appMemoGetWorld(
            normalizedWorldId
        )) as WorldMemoEntry | null) ?? createEmptyWorldMemo(normalizedWorldId)
    );
}

async function saveWorldMemo({ worldId, memo }: SaveWorldMemoInput) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error('MemoRepository.saveWorldMemo requires a world id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await commands.appMemoSaveWorld(normalizedWorldId, '');
        return createEmptyWorldMemo(normalizedWorldId);
    }

    const entry = (await commands.appMemoSaveWorld(
        normalizedWorldId,
        nextMemo
    )) as LocalMemoSaveResult;
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
        ((await commands.appMemoGetAvatar(
            normalizedAvatarId
        )) as AvatarMemoEntry | null) ??
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
        await commands.appMemoSaveAvatar(normalizedAvatarId, '');
        return createEmptyAvatarMemo(normalizedAvatarId);
    }

    const entry = (await commands.appMemoSaveAvatar(
        normalizedAvatarId,
        nextMemo
    )) as LocalMemoSaveResult;
    return {
        avatarId: entry.entityId,
        editedAt: entry.editedAt,
        memo: entry.memo
    };
}

const memoPersistenceRepository = Object.freeze({
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
export default memoPersistenceRepository;
