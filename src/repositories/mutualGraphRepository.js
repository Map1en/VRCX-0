import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';
import vrchatFriendRepository from './vrchatFriendRepository.js';

function readColumn(row, index, key) {
    if (Array.isArray(row)) {
        return row[index];
    }

    if (row && typeof row === 'object') {
        return row[key] ?? row[index];
    }

    return null;
}

function createTableStatements(userPrefix) {
    return [
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_mutual_graph_friends (friend_id TEXT PRIMARY KEY)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)`
    ];
}

async function ensureTables(userId) {
    const userPrefix = normalizeUserTablePrefix(userId);
    for (const sql of createTableStatements(userPrefix)) {
        await sqliteRepository.executeNonQuery(sql);
    }
    return userPrefix;
}

async function getSnapshot(userId) {
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
            snapshot.set(friendId, []);
        }
    }

    for (const row of linkRows ?? []) {
        const friendId = readColumn(row, 0, 'friend_id');
        const mutualId = readColumn(row, 1, 'mutual_id');
        if (!friendId || !mutualId) {
            continue;
        }

        const links = snapshot.get(friendId) ?? [];
        links.push(mutualId);
        snapshot.set(friendId, links);
    }

    for (const row of metaRows ?? []) {
        const friendId = readColumn(row, 0, 'friend_id');
        if (!friendId) {
            continue;
        }

        meta.set(friendId, {
            lastFetchedAt: readColumn(row, 1, 'last_fetched_at') || null,
            optedOut: Number(readColumn(row, 2, 'opted_out')) === 1
        });
    }

    return {
        snapshot,
        meta
    }
}

async function getMutualFriends({ friendId, offset = 0, n = 100 } = {}) {
    const normalizedFriendId =
        typeof friendId === 'string' ? friendId.trim() : String(friendId ?? '').trim();
    if (!normalizedFriendId) {
        throw new Error('MutualGraphRepository.getMutualFriends requires a friend id.');
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

async function saveSnapshot(userId, entries) {
    const userPrefix = await ensureTables(userId);
    const friendTable = `${userPrefix}_mutual_graph_friends`;
    const linkTable = `${userPrefix}_mutual_graph_links`;
    const metaTable = `${userPrefix}_mutual_graph_meta`;
    const pairs = entries instanceof Map ? entries : new Map();

    await sqliteRepository.transaction(async (tx) => {
        await tx.executeNonQuery(
            `DELETE FROM ${linkTable} WHERE friend_id NOT IN (SELECT friend_id FROM ${metaTable} WHERE opted_out = 1)`
        );
        await tx.executeNonQuery(
            `DELETE FROM ${friendTable} WHERE friend_id NOT IN (SELECT friend_id FROM ${metaTable} WHERE opted_out = 1)`
        );

        const friendIds = Array.from(pairs.keys()).filter(Boolean);
        if (friendIds.length) {
            const args = {};
            const placeholders = friendIds.map((friendId, index) => {
                const key = `@friendId${index}`;
                args[key] = String(friendId);
                return key;
            });
            await tx.executeNonQuery(
                `DELETE FROM ${linkTable} WHERE friend_id IN (${placeholders.join(', ')})`,
                args
            );
        }

        await insertFriendRows(tx, friendTable, friendIds);

        const edgeRows = [];
        pairs.forEach((mutualIds, friendId) => {
            if (!friendId) {
                return;
            }
            const collection = mutualIds instanceof Set ? Array.from(mutualIds) : mutualIds;
            for (const mutualId of Array.isArray(collection) ? collection : []) {
                if (mutualId) {
                    edgeRows.push([String(friendId), String(mutualId)]);
                }
            }
        });
        await insertEdgeRows(tx, linkTable, edgeRows);
    });
}

async function updateMutualsForFriend(userId, friendId, mutualIds) {
    const normalizedFriendId =
        typeof friendId === 'string' ? friendId.trim() : String(friendId ?? '').trim();
    if (!normalizedFriendId) {
        return;
    }

    const userPrefix = await ensureTables(userId);
    const friendTable = `${userPrefix}_mutual_graph_friends`;
    const linkTable = `${userPrefix}_mutual_graph_links`;
    const collection = Array.isArray(mutualIds) ? mutualIds.filter(Boolean) : [];

    await sqliteRepository.transaction(async (tx) => {
        await insertFriendRows(tx, friendTable, [normalizedFriendId]);
        await tx.executeNonQuery(`DELETE FROM ${linkTable} WHERE friend_id = @friendId`, {
            '@friendId': normalizedFriendId
        });
        await insertEdgeRows(
            tx,
            linkTable,
            collection.map((mutualId) => [normalizedFriendId, String(mutualId)])
        );
    });
}

async function upsertMeta(userId, friendId, { lastFetchedAt, optedOut } = {}) {
    const normalizedFriendId =
        typeof friendId === 'string' ? friendId.trim() : String(friendId ?? '').trim();
    if (!normalizedFriendId) {
        return;
    }

    const userPrefix = await ensureTables(userId);
    await sqliteRepository.executeNonQuery(
        `INSERT OR REPLACE INTO ${userPrefix}_mutual_graph_meta (friend_id, last_fetched_at, opted_out)
         VALUES (@friendId, @lastFetchedAt, @optedOut)`,
        {
            '@friendId': normalizedFriendId,
            '@lastFetchedAt': lastFetchedAt || new Date().toISOString(),
            '@optedOut': optedOut ? 1 : 0
        }
    );
}

async function bulkUpsertMeta(userId, entries) {
    if (!(entries instanceof Map) || entries.size === 0) {
        return;
    }

    const userPrefix = await ensureTables(userId);
    const metaTable = `${userPrefix}_mutual_graph_meta`;
    const rows = [];
    const now = new Date().toISOString();
    entries.forEach((entry, friendId) => {
        if (friendId) {
            rows.push([String(friendId), entry?.lastFetchedAt || now, entry?.optedOut ? 1 : 0]);
        }
    });
    await insertMetaRows(sqliteRepository, metaTable, rows);
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

async function insertFriendRows(tx, friendTable, friendIds) {
    const normalizedFriendIds = Array.from(new Set((friendIds || []).map(String).filter(Boolean)));
    for (let chunkStart = 0; chunkStart < normalizedFriendIds.length; chunkStart += 250) {
        const chunk = normalizedFriendIds.slice(chunkStart, chunkStart + 250);
        if (!chunk.length) {
            continue;
        }
        const args = {};
        const values = chunk.map((friendId, index) => {
            const key = `@friendId${chunkStart + index}`;
            args[key] = friendId;
            return `(${key})`;
        });
        await tx.executeNonQuery(
            `INSERT OR REPLACE INTO ${friendTable} (friend_id) VALUES ${values.join(', ')}`,
            args
        );
    }
}

async function insertEdgeRows(tx, linkTable, edgeRows) {
    const uniqueRows = [];
    const seen = new Set();
    for (const [friendId, mutualId] of edgeRows || []) {
        const key = `${friendId}\u0000${mutualId}`;
        if (!friendId || !mutualId || seen.has(key)) {
            continue;
        }
        seen.add(key);
        uniqueRows.push([friendId, mutualId]);
    }

    for (let chunkStart = 0; chunkStart < uniqueRows.length; chunkStart += 200) {
        const chunk = uniqueRows.slice(chunkStart, chunkStart + 200);
        if (!chunk.length) {
            continue;
        }
        const args = {};
        const values = chunk.map(([friendId, mutualId], index) => {
            const friendKey = `@friendId${chunkStart + index}`;
            const mutualKey = `@mutualId${chunkStart + index}`;
            args[friendKey] = friendId;
            args[mutualKey] = mutualId;
            return `(${friendKey}, ${mutualKey})`;
        });
        await tx.executeNonQuery(
            `INSERT OR REPLACE INTO ${linkTable} (friend_id, mutual_id) VALUES ${values.join(', ')}`,
            args
        );
    }
}

async function insertMetaRows(tx, metaTable, rows) {
    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += 200) {
        const chunk = rows.slice(chunkStart, chunkStart + 200);
        if (!chunk.length) {
            continue;
        }
        const args = {};
        const values = chunk.map(([friendId, lastFetchedAt, optedOut], index) => {
            const friendKey = `@friendId${chunkStart + index}`;
            const fetchedKey = `@lastFetchedAt${chunkStart + index}`;
            const optedOutKey = `@optedOut${chunkStart + index}`;
            args[friendKey] = friendId;
            args[fetchedKey] = lastFetchedAt;
            args[optedOutKey] = optedOut;
            return `(${friendKey}, ${fetchedKey}, ${optedOutKey})`;
        });
        await tx.executeNonQuery(
            `INSERT OR REPLACE INTO ${metaTable} (friend_id, last_fetched_at, opted_out) VALUES ${values.join(', ')}`,
            args
        );
    }
}
