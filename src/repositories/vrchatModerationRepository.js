import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';
import { database } from '@/services/database/index.js';

function normalizeEndpointDomain(endpointDomain) {
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain.trim();
    }

    return DEFAULT_ENDPOINT_DOMAIN;
}

function buildUrl(path, endpointDomain) {
    const baseUrl = normalizeEndpointDomain(endpointDomain).replace(/\/?$/, '/');
    return new URL(path, baseUrl).toString();
}

function parseJsonResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

function unwrapErrorMessage(json, status) {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `VRChat moderation request failed (${status})`;
}

function createModerationError(message, status, endpoint, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = endpoint;
    error.payload = payload;
    return error;
}

function normalizePlayerModerationRow(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    const id = typeof row.id === 'string' ? row.id.trim() : String(row.id ?? '').trim();
    const type = typeof row.type === 'string' ? row.type.trim() : String(row.type ?? '').trim();
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
            typeof row.sourceDisplayName === 'string' ? row.sourceDisplayName : '',
        targetUserId,
        targetDisplayName:
            typeof row.targetDisplayName === 'string' ? row.targetDisplayName : '',
        created: typeof row.created === 'string' ? row.created : ''
    };
}

class VrchatModerationRepository {
    async executeGet(path, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, endpoint),
            method: 'GET'
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createModerationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createModerationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async executePut(path, payload = {}, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, endpoint),
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify(payload && typeof payload === 'object' ? payload : {})
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createModerationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createModerationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async executePost(path, payload = {}, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, endpoint),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify(payload && typeof payload === 'object' ? payload : {})
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createModerationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createModerationError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async getPlayerModerations({ endpoint = '' } = {}) {
        const response = await this.executeGet('auth/user/playermoderations', { endpoint });
        const rows = Array.isArray(response.json)
            ? response.json.map(normalizePlayerModerationRow).filter(Boolean)
            : [];

        return {
            ...response,
            json: rows
        };
    }

    async syncLocalModerationSnapshot(rows = []) {
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

        const existingRows = await database.getAllModerations();
        const writes = [];

        for (const row of existingRows) {
            if (row.userId && !moderationByUserId.has(row.userId)) {
                writes.push(database.deleteModeration(row.userId));
            }
        }

        for (const row of moderationByUserId.values()) {
            writes.push(database.setModeration(row));
        }

        await Promise.all(writes);
        return Array.from(moderationByUserId.values());
    }

    async sendPlayerModeration({ endpoint = '', moderated, type } = {}) {
        const normalizedModerated =
            typeof moderated === 'string' ? moderated.trim() : String(moderated ?? '').trim();
        const normalizedType = typeof type === 'string' ? type.trim() : String(type ?? '').trim();

        if (!normalizedModerated || !normalizedType) {
            throw new Error('VrchatModerationRepository.sendPlayerModeration requires moderated and type.');
        }

        return this.executePost(
            'auth/user/playermoderations',
            {
                moderated: normalizedModerated,
                type: normalizedType
            },
            { endpoint }
        );
    }

    async deletePlayerModeration({ endpoint = '', moderated, type } = {}) {
        const normalizedModerated =
            typeof moderated === 'string' ? moderated.trim() : String(moderated ?? '').trim();
        const normalizedType = typeof type === 'string' ? type.trim() : String(type ?? '').trim();

        if (!normalizedModerated || !normalizedType) {
            throw new Error('VrchatModerationRepository.deletePlayerModeration requires moderated and type.');
        }

        return this.executePut(
            'auth/user/unplayermoderate',
            {
                moderated: normalizedModerated,
                type: normalizedType
            },
            { endpoint }
        );
    }

    async getLocalModeration({ userId } = {}) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            return {
                userId: '',
                block: false,
                mute: false
            };
        }

        const row = await database.getModeration(normalizedUserId);
        return {
            userId: normalizedUserId,
            block: Boolean(row?.block),
            mute: Boolean(row?.mute)
        };
    }

    async saveLocalModeration({ userId, displayName = '', block = false, mute = false } = {}) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('VrchatModerationRepository.saveLocalModeration requires a user id.');
        }

        if (!block && !mute) {
            await database.deleteModeration(normalizedUserId);
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
        await database.setModeration(entry);
        return entry;
    }
}

const vrchatModerationRepository = new VrchatModerationRepository();

export { VrchatModerationRepository };
export default vrchatModerationRepository;
