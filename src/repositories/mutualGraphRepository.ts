import { backend } from '@/platform/index.js';

import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';
import vrchatFriendRepository from './vrchatFriendRepository.js';

type SQLiteNamedRow = Record<string, unknown>;
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

function readColumn(row: unknown, index: number, key: string): unknown {
    if (Array.isArray(row)) {
        return row[index];
    }

    if (row && typeof row === 'object') {
        const record = row as SQLiteNamedRow;
        return record[key] ?? record[index];
    }

    return null;
}

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
    const userPrefix = await ensureTables(userId);
    const friendTable = `${userPrefix}_mutual_graph_friends`;
    const linkTable = `${userPrefix}_mutual_graph_links`;
    const metaTable = `${userPrefix}_mutual_graph_meta`;

    const [friendRows, linkRows, metaRows] = await Promise.all([
        sqliteRepository.query(`SELECT friend_id FROM ${friendTable}`),
        sqliteRepository.query(`SELECT friend_id, mutual_id FROM ${linkTable}`),
        sqliteRepository.query(
            `SELECT friend_id, last_fetched_at, opted_out FROM ${metaTable}`
        )
    ]);

    const snapshot = new Map();
    const meta = new Map();

    for (const row of friendRows ?? []) {
        const friendId = readColumn(row, 0, 'friend_id');
        if (friendId && !snapshot.has(friendId)) {
            snapshot.set(String(friendId), []);
        }
    }

    for (const row of linkRows ?? []) {
        const friendId = readColumn(row, 0, 'friend_id');
        const mutualId = readColumn(row, 1, 'mutual_id');
        if (!friendId || !mutualId) {
            continue;
        }

        const normalizedFriendId = String(friendId);
        const links = snapshot.get(normalizedFriendId) ?? [];
        links.push(String(mutualId));
        snapshot.set(normalizedFriendId, links);
    }

    for (const row of metaRows ?? []) {
        const friendId = readColumn(row, 0, 'friend_id');
        if (!friendId) {
            continue;
        }

        meta.set(String(friendId), {
            lastFetchedAt:
                String(readColumn(row, 1, 'last_fetched_at') || '') || null,
            optedOut: Number(readColumn(row, 2, 'opted_out')) === 1
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
