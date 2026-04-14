import { database } from '@/services/database/index.js';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

class MemoRepository {
    createEmptyUserMemo(userId = '') {
        return {
            userId,
            editedAt: '',
            memo: ''
        };
    }

    createEmptyWorldMemo(worldId = '') {
        return {
            worldId,
            editedAt: '',
            memo: ''
        };
    }

    createEmptyAvatarMemo(avatarId = '') {
        return {
            avatarId,
            editedAt: '',
            memo: ''
        };
    }

    async getUserMemo(userId) {
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedUserId) {
            return this.createEmptyUserMemo();
        }

        return database.getUserMemo(normalizedUserId);
    }

    async getAllUserMemos() {
        return database.getAllUserMemos();
    }

    async getAllUserNotes() {
        return database.getAllUserNotes();
    }

    async saveUserMemo({ userId, memo }) {
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedUserId) {
            throw new Error('MemoRepository.saveUserMemo requires a user id.');
        }

        const nextMemo = typeof memo === 'string' ? memo : '';
        if (!nextMemo) {
            await database.deleteUserMemo(normalizedUserId);
            return this.createEmptyUserMemo(normalizedUserId);
        }

        const entry = {
            userId: normalizedUserId,
            editedAt: new Date().toJSON(),
            memo: nextMemo
        };
        await database.setUserMemo(entry);
        return entry;
    }

    async getWorldMemo(worldId) {
        const normalizedWorldId = normalizeEntityId(worldId);
        if (!normalizedWorldId) {
            return this.createEmptyWorldMemo();
        }

        return database.getWorldMemo(normalizedWorldId);
    }

    async saveWorldMemo({ worldId, memo }) {
        const normalizedWorldId = normalizeEntityId(worldId);
        if (!normalizedWorldId) {
            throw new Error('MemoRepository.saveWorldMemo requires a world id.');
        }

        const nextMemo = typeof memo === 'string' ? memo : '';
        if (!nextMemo) {
            await database.deleteWorldMemo(normalizedWorldId);
            return this.createEmptyWorldMemo(normalizedWorldId);
        }

        const entry = {
            worldId: normalizedWorldId,
            editedAt: new Date().toJSON(),
            memo: nextMemo
        };
        await database.setWorldMemo(entry);
        return entry;
    }

    async getAvatarMemo(avatarId) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            return this.createEmptyAvatarMemo();
        }

        return database.getAvatarMemoDB(normalizedAvatarId);
    }

    async saveAvatarMemo({ avatarId, memo }) {
        const normalizedAvatarId = normalizeEntityId(avatarId);
        if (!normalizedAvatarId) {
            throw new Error('MemoRepository.saveAvatarMemo requires an avatar id.');
        }

        const nextMemo = typeof memo === 'string' ? memo : '';
        if (!nextMemo) {
            await database.deleteAvatarMemo(normalizedAvatarId);
            return this.createEmptyAvatarMemo(normalizedAvatarId);
        }

        const entry = {
            avatarId: normalizedAvatarId,
            editedAt: new Date().toJSON(),
            memo: nextMemo
        };
        await database.setAvatarMemo(entry);
        return entry;
    }
}

const memoRepository = new MemoRepository();

export { MemoRepository };
export default memoRepository;
