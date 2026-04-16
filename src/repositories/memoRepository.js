import { database } from '@/services/database/index.js';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function createEmptyUserMemo(userId = '') {
    return {
        userId,
        editedAt: '',
        memo: ''
    };
}

function createEmptyWorldMemo(worldId = '') {
    return {
        worldId,
        editedAt: '',
        memo: ''
    };
}

function createEmptyAvatarMemo(avatarId = '') {
    return {
        avatarId,
        editedAt: '',
        memo: ''
    };
}

async function getUserMemo(userId) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        return createEmptyUserMemo();
    }

    return database.getUserMemo(normalizedUserId);
}

async function getAllUserMemos() {
    return database.getAllUserMemos();
}

async function getAllUserNotes() {
    return database.getAllUserNotes();
}

async function saveUserMemo({ userId, memo }) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error('MemoRepository.saveUserMemo requires a user id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await database.deleteUserMemo(normalizedUserId);
        return createEmptyUserMemo(normalizedUserId);
    }

    const entry = {
        userId: normalizedUserId,
        editedAt: new Date().toJSON(),
        memo: nextMemo
    };
    await database.setUserMemo(entry);
    return entry;
}

async function getWorldMemo(worldId) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        return createEmptyWorldMemo();
    }

    return database.getWorldMemo(normalizedWorldId);
}

async function saveWorldMemo({ worldId, memo }) {
    const normalizedWorldId = normalizeEntityId(worldId);
    if (!normalizedWorldId) {
        throw new Error('MemoRepository.saveWorldMemo requires a world id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await database.deleteWorldMemo(normalizedWorldId);
        return createEmptyWorldMemo(normalizedWorldId);
    }

    const entry = {
        worldId: normalizedWorldId,
        editedAt: new Date().toJSON(),
        memo: nextMemo
    };
    await database.setWorldMemo(entry);
    return entry;
}

async function getAvatarMemo(avatarId) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        return createEmptyAvatarMemo();
    }

    return database.getAvatarMemoDB(normalizedAvatarId);
}

async function saveAvatarMemo({ avatarId, memo }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error('MemoRepository.saveAvatarMemo requires an avatar id.');
    }

    const nextMemo = typeof memo === 'string' ? memo : '';
    if (!nextMemo) {
        await database.deleteAvatarMemo(normalizedAvatarId);
        return createEmptyAvatarMemo(normalizedAvatarId);
    }

    const entry = {
        avatarId: normalizedAvatarId,
        editedAt: new Date().toJSON(),
        memo: nextMemo
    };
    await database.setAvatarMemo(entry);
    return entry;
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
