import { invalidateEntityQueries } from '@/lib/entityQueryCache';
import {
    commands,
    type AvatarMemoOutput,
    type UserMemoOutput,
    type UserNoteOutput,
    type WorldMemoOutput
} from '@/platform/tauri/bindings';

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

type UserMemoListEntry = Pick<UserMemoOutput, 'userId' | 'memo'>;

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function createEmptyUserMemo(userId = ''): UserMemoOutput {
    return {
        userId,
        editedAt: '',
        memo: ''
    };
}

function createEmptyWorldMemo(worldId = ''): WorldMemoOutput {
    return {
        worldId,
        editedAt: '',
        memo: ''
    };
}

function createEmptyAvatarMemo(avatarId = ''): AvatarMemoOutput {
    return {
        avatarId,
        editedAt: '',
        memo: ''
    };
}

async function getUserMemo(userId: unknown): Promise<UserMemoOutput> {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        return createEmptyUserMemo();
    }

    return (
        (await commands.appMemoGetUser(normalizedUserId)) ??
        createEmptyUserMemo(normalizedUserId)
    );
}

async function getAllUserMemos(): Promise<UserMemoListEntry[]> {
    const rows = await commands.appMemoListUsers();
    return rows.map((row) => ({
        userId: row.userId,
        memo: row.memo
    }));
}

async function getAllUserNotes(
    ownerUserId: unknown = ''
): Promise<UserNoteOutput[]> {
    const normalizedOwnerUserId = normalizeEntityId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    return commands.appMemoListUserNotes(normalizedOwnerUserId);
}

async function saveUserMemo({
    userId,
    memo
}: SaveUserMemoInput): Promise<UserMemoOutput> {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error('MemoRepository.saveUserMemo requires a user id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    let result: UserMemoOutput;
    if (!nextMemo) {
        await commands.appMemoSaveUser(normalizedUserId, '');
        result = createEmptyUserMemo(normalizedUserId);
    } else {
        const entry = await commands.appMemoSaveUser(
            normalizedUserId,
            nextMemo
        );
        result = {
            userId: entry.entityId,
            editedAt: entry.editedAt,
            memo: entry.memo
        };
    }
    void invalidateEntityQueries(['quickSearch']);
    return result;
}

async function getWorldMemo(worldId: unknown): Promise<WorldMemoOutput> {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        return createEmptyWorldMemo();
    }

    return (
        (await commands.appMemoGetWorld(normalizedWorldId)) ??
        createEmptyWorldMemo(normalizedWorldId)
    );
}

async function saveWorldMemo({
    worldId,
    memo
}: SaveWorldMemoInput): Promise<WorldMemoOutput> {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error('MemoRepository.saveWorldMemo requires a world id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await commands.appMemoSaveWorld(normalizedWorldId, '');
        return createEmptyWorldMemo(normalizedWorldId);
    }

    const entry = await commands.appMemoSaveWorld(normalizedWorldId, nextMemo);
    return {
        worldId: entry.entityId,
        editedAt: entry.editedAt,
        memo: entry.memo
    };
}

async function getAvatarMemo(avatarId: unknown): Promise<AvatarMemoOutput> {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        return createEmptyAvatarMemo();
    }

    return (
        (await commands.appMemoGetAvatar(normalizedAvatarId)) ??
        createEmptyAvatarMemo(normalizedAvatarId)
    );
}

async function saveAvatarMemo({
    avatarId,
    memo
}: SaveAvatarMemoInput): Promise<AvatarMemoOutput> {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error('MemoRepository.saveAvatarMemo requires an avatar id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await commands.appMemoSaveAvatar(normalizedAvatarId, '');
        return createEmptyAvatarMemo(normalizedAvatarId);
    }

    const entry = await commands.appMemoSaveAvatar(
        normalizedAvatarId,
        nextMemo
    );
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
