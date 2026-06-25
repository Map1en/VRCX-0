import { commands } from '@/platform/tauri/bindings';

import { normalizeUserTablePrefix } from './userSessionRepository';
import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

type MutualGraphEntryMap = Map<string, string[] | Set<string>>;
type MutualGraphMeta = {
    lastFetchedAt: string | null;
    optedOut: boolean;
};
type MutualGraphMetaInput = Partial<MutualGraphMeta>;
type MutualGraphMetaMap = Map<string, MutualGraphMetaInput>;
type MutualGraphOptions = {
    friendId?: unknown;
    offset?: number;
    n?: number;
};
type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapRuntimeMutualResponse(response: VrchatApiResult, path: string) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat friend request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json,
        status: response.status,
        raw: response.raw
    };
}

async function ensureTables(userId: unknown): Promise<string> {
    const userPrefix = normalizeUserTablePrefix(userId);
    await commands.appMutualGraphTablesEnsure(
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim()
    );
    return userPrefix;
}

async function getSnapshot(userId: unknown): Promise<{
    snapshot: Map<string, string[]>;
    meta: Map<string, MutualGraphMeta>;
}> {
    await ensureTables(userId);
    const {
        friendIds = [],
        links = [],
        meta: metaRows = []
    } = (await commands.appMutualGraphSnapshotGet(
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim()
    )) as {
        friendIds?: unknown[];
        links?: Array<{ friendId?: unknown; mutualId?: unknown }>;
        meta?: Array<{
            friendId?: unknown;
            lastFetchedAt?: unknown;
            optedOut?: unknown;
        }>;
    };

    const snapshot = new Map();
    const meta = new Map();

    for (const friendId of friendIds ?? []) {
        const normalizedFriendId = String(friendId || '');
        if (normalizedFriendId && !snapshot.has(normalizedFriendId)) {
            snapshot.set(normalizedFriendId, []);
        }
    }

    for (const row of links ?? []) {
        const friendId = row.friendId;
        const mutualId = row.mutualId;
        if (!friendId || !mutualId) {
            continue;
        }

        const normalizedFriendId = String(friendId);
        const links = snapshot.get(normalizedFriendId) ?? [];
        links.push(String(mutualId));
        snapshot.set(normalizedFriendId, links);
    }

    for (const row of metaRows ?? []) {
        const friendId = row.friendId;
        if (!friendId) {
            continue;
        }

        meta.set(String(friendId), {
            lastFetchedAt: String(row.lastFetchedAt || '') || null,
            optedOut: Boolean(row.optedOut)
        });
    }

    return {
        snapshot,
        meta
    };
}

async function getMutualFriends({
    friendId,
    offset = 0,
    n = 100
}: MutualGraphOptions = {}) {
    const normalizedFriendId =
        typeof friendId === 'string'
            ? friendId.trim()
            : String(friendId ?? '').trim();
    if (!normalizedFriendId) {
        throw new Error(
            'MutualGraphRepository.getMutualFriends requires a friend id.'
        );
    }

    const response = await commands.appVrchatUserMutualFriendsGet({
        userId: normalizedFriendId,
        offset,
        n,
        includeUserIdParam: true
    });
    return unwrapRuntimeMutualResponse(
        response,
        `users/${encodeURIComponent(normalizedFriendId)}/mutuals/friends`
    );
}

async function saveSnapshot(userId: unknown, entries: MutualGraphEntryMap) {
    const pairs = entries instanceof Map ? entries : new Map();
    const normalizedEntries: Array<{ friendId: string; mutualIds: string[] }> =
        [];
    pairs.forEach((mutualIds, friendId) => {
        if (!friendId) {
            return;
        }
        const collection =
            mutualIds instanceof Set ? Array.from(mutualIds) : mutualIds;
        normalizedEntries.push({
            friendId: String(friendId),
            mutualIds: (Array.isArray(collection) ? collection : [])
                .map(String)
                .filter(Boolean)
        });
    });
    await commands.appMutualGraphSnapshotSave(
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim(),
        normalizedEntries
    );
}

async function updateMutualsForFriend(
    userId: unknown,
    friendId: unknown,
    mutualIds: unknown[] = []
) {
    const normalizedFriendId =
        typeof friendId === 'string'
            ? friendId.trim()
            : String(friendId ?? '').trim();
    if (!normalizedFriendId) {
        return;
    }

    const collection = Array.isArray(mutualIds)
        ? mutualIds.filter(Boolean)
        : [];

    await commands.appMutualGraphFriendUpdate(
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim(),
        normalizedFriendId,
        collection.map(String)
    );
}

async function upsertMeta(
    userId: unknown,
    friendId: unknown,
    { lastFetchedAt, optedOut }: MutualGraphMetaInput = {}
) {
    const normalizedFriendId =
        typeof friendId === 'string'
            ? friendId.trim()
            : String(friendId ?? '').trim();
    if (!normalizedFriendId) {
        return;
    }

    await commands.appMutualGraphMetaUpsert(
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim(),
        {
            friendId: normalizedFriendId,
            lastFetchedAt: lastFetchedAt || new Date().toISOString(),
            optedOut: Boolean(optedOut)
        }
    );
}

async function bulkUpsertMeta(userId: unknown, entries: MutualGraphMetaMap) {
    if (!(entries instanceof Map) || entries.size === 0) {
        return;
    }

    const now = new Date().toISOString();
    const rows: Array<{
        friendId: string;
        lastFetchedAt: string;
        optedOut: boolean;
    }> = [];
    entries.forEach((entry, friendId) => {
        if (friendId) {
            rows.push({
                friendId: String(friendId),
                lastFetchedAt: entry?.lastFetchedAt || now,
                optedOut: Boolean(entry?.optedOut)
            });
        }
    });
    await commands.appMutualGraphMetaBulkUpsert(
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim(),
        rows
    );
}

const mutualGraphPersistenceRepository = Object.freeze({
    ensureTables,
    getSnapshot,
    getMutualFriends,
    saveSnapshot,
    updateMutualsForFriend,
    upsertMeta,
    bulkUpsertMeta
});

export {
    ensureTables,
    getSnapshot,
    getMutualFriends,
    saveSnapshot,
    updateMutualsForFriend,
    upsertMeta,
    bulkUpsertMeta
};
export default mutualGraphPersistenceRepository;
