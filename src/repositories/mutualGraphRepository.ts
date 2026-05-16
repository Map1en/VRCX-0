import { backend } from '@/platform/index.js';

import { normalizeUserTablePrefix } from './userSessionRepository.js';
import vrchatFriendRepository from './vrchatFriendRepository.js';

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

async function ensureTables(userId: unknown): Promise<string> {
    const userPrefix = normalizeUserTablePrefix(userId);
    await backend.app.MutualGraphTablesEnsure({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim()
    });
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
    } = (await backend.app.MutualGraphSnapshotGet({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim()
    })) as {
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

    return vrchatFriendRepository.executeGet(
        `users/${encodeURIComponent(normalizedFriendId)}/mutuals/friends`,
        {
            userId: normalizedFriendId,
            offset,
            n
        }
    );
}

async function saveSnapshot(userId: unknown, entries: MutualGraphEntryMap) {
    const pairs = entries instanceof Map ? entries : new Map();
    const normalizedEntries = [];
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
    await backend.app.MutualGraphSnapshotSave({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entries: normalizedEntries
    });
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

    await backend.app.MutualGraphFriendUpdate({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        friendId: normalizedFriendId,
        mutualIds: collection.map(String)
    });
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

    await backend.app.MutualGraphMetaUpsert({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entry: {
            friendId: normalizedFriendId,
            lastFetchedAt: lastFetchedAt || new Date().toISOString(),
            optedOut: Boolean(optedOut)
        }
    });
}

async function bulkUpsertMeta(userId: unknown, entries: MutualGraphMetaMap) {
    if (!(entries instanceof Map) || entries.size === 0) {
        return;
    }

    const now = new Date().toISOString();
    const rows = [];
    entries.forEach((entry, friendId) => {
        if (friendId) {
            rows.push({
                friendId: String(friendId),
                lastFetchedAt: entry?.lastFetchedAt || now,
                optedOut: Boolean(entry?.optedOut)
            });
        }
    });
    await backend.app.MutualGraphMetaBulkUpsert({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entries: rows
    });
}

const mutualGraphRepository = Object.freeze({
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
export default mutualGraphRepository;
