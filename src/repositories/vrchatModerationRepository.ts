import { backend } from '@/platform/index.js';

import { executeVrchatBackendRequest } from './vrchatRequest.js';

type ObjectRow = Record<string, unknown>;
type RequestOptions = {
    endpoint?: string;
};

interface LocalModerationRow {
    userId?: unknown;
    updatedAt?: unknown;
    displayName?: unknown;
    block?: unknown;
    mute?: unknown;
}

interface PlayerModerationRow extends ObjectRow {
    id?: unknown;
    type?: unknown;
    sourceUserId?: unknown;
    sourceDisplayName?: unknown;
    targetUserId?: unknown;
    targetDisplayName?: unknown;
    created?: unknown;
}

interface SyncLocalModerationSnapshotInput {
    ownerUserId?: unknown;
    rows?: PlayerModerationRow[];
}

interface PlayerModerationMutationInput extends RequestOptions {
    moderated?: unknown;
    type?: unknown;
}

interface LocalModerationQueryInput {
    ownerUserId?: unknown;
    userId?: unknown;
}

interface SaveLocalModerationInput extends LocalModerationQueryInput {
    updatedAt?: unknown;
    displayName?: unknown;
    block?: unknown;
    mute?: unknown;
}

function normalizePlayerModerationRow(row: unknown) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    const record = row as PlayerModerationRow;
    const id =
        typeof record.id === 'string'
            ? record.id.trim()
            : String(record.id ?? '').trim();
    const type =
        typeof record.type === 'string'
            ? record.type.trim()
            : String(record.type ?? '').trim();
    const sourceUserId =
        typeof record.sourceUserId === 'string'
            ? record.sourceUserId.trim()
            : String(record.sourceUserId ?? '').trim();
    const targetUserId =
        typeof record.targetUserId === 'string'
            ? record.targetUserId.trim()
            : String(record.targetUserId ?? '').trim();

    if (!id || !type || !targetUserId) {
        return null;
    }

    return {
        id,
        type,
        sourceUserId,
        sourceDisplayName:
            typeof record.sourceDisplayName === 'string'
                ? record.sourceDisplayName
                : '',
        targetUserId,
        targetDisplayName:
            typeof record.targetDisplayName === 'string'
                ? record.targetDisplayName
                : '',
        created: typeof record.created === 'string' ? record.created : ''
    };
}

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function executeGet(
    path: string,
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatModerationExecute', path, {
        endpoint,
        method: 'GET',
        fallbackMessage: 'VRChat moderation request failed'
    });
}

async function executePut(
    path: string,
    payload: ObjectRow = {},
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatModerationExecute', path, {
        endpoint,
        method: 'PUT',
        body: payload,
        fallbackMessage: 'VRChat moderation request failed'
    });
}

async function executePost(
    path: string,
    payload: ObjectRow = {},
    { endpoint = '' }: RequestOptions = {}
) {
    return executeVrchatBackendRequest('VrchatModerationExecute', path, {
        endpoint,
        method: 'POST',
        body: payload,
        fallbackMessage: 'VRChat moderation request failed'
    });
}

async function getPlayerModerations({ endpoint = '' }: RequestOptions = {}) {
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

async function getAllLocalModerations(ownerUserId: unknown) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    const rows = (await backend.app.LocalModerationList({
        ownerUserId: normalizedOwnerUserId
    })) as LocalModerationRow[];
    return Array.isArray(rows)
        ? rows.map((row) => ({
              userId: row.userId,
              updatedAt: row.updatedAt,
              displayName: row.displayName,
              block: Boolean(row.block),
              mute: Boolean(row.mute)
          }))
        : [];
}

async function getLocalModerationRow(ownerUserId: unknown, userId: unknown) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedOwnerUserId || !normalizedUserId) {
        return {};
    }

    const row = (await backend.app.LocalModerationGet({
        ownerUserId: normalizedOwnerUserId,
        userId: normalizedUserId
    })) as LocalModerationRow | null;
    if (!row) {
        return {};
    }
    return {
        userId: row.userId,
        updatedAt: row.updatedAt,
        displayName: row.displayName,
        block: Boolean(row.block),
        mute: Boolean(row.mute)
    };
}

async function setLocalModerationRow(
    ownerUserId: unknown,
    entry: SaveLocalModerationInput
) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId || !entry?.userId) {
        return;
    }

    await backend.app.LocalModerationSet({
        ownerUserId: normalizedOwnerUserId,
        entry: {
            userId: entry.userId,
            updatedAt: entry.updatedAt,
            displayName: entry.displayName,
            block: Boolean(entry.block),
            mute: Boolean(entry.mute)
        }
    });
}

async function deleteLocalModerationRow(ownerUserId: unknown, userId: unknown) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedOwnerUserId || !normalizedUserId) {
        return;
    }

    await backend.app.LocalModerationDelete({
        ownerUserId: normalizedOwnerUserId,
        userId: normalizedUserId
    });
}

async function syncLocalModerationSnapshot({
    ownerUserId,
    rows = []
}: SyncLocalModerationSnapshotInput = {}) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    return backend.app.LocalModerationSyncSnapshot({
        ownerUserId: normalizedOwnerUserId,
        rows: Array.isArray(rows) ? rows : []
    });
}

async function sendPlayerModeration({
    endpoint = '',
    moderated,
    type
}: PlayerModerationMutationInput = {}) {
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

async function deletePlayerModeration({
    endpoint = '',
    moderated,
    type
}: PlayerModerationMutationInput = {}) {
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

async function getLocalModeration({
    ownerUserId = '',
    userId
}: LocalModerationQueryInput = {}) {
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
}: SaveLocalModerationInput = {}) {
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
