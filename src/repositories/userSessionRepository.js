import {
    buildInitUserTableStatements,
    normalizeUserTablePrefix as baseNormalizeUserTablePrefix
} from './localDatabaseSchema.js';
import sqliteRepository from './sqliteRepository.js';

const userTableInitPromises = new Map();

function normalizeUserTablePrefix(userId) {
    return baseNormalizeUserTablePrefix(userId);
}

async function ensureUserTables(userId) {
    const userPrefix = normalizeUserTablePrefix(userId);
    const existing = userTableInitPromises.get(userPrefix);
    if (existing) {
        return existing;
    }

    const promise = (async () => {
        for (const sql of buildInitUserTableStatements(userPrefix)) {
            await sqliteRepository.executeNonQuery(sql);
        }

        return {
            userId:
                typeof userId === 'string'
                    ? userId.trim()
                    : String(userId ?? '').trim(),
            userPrefix
        };
    })().catch((error) => {
        if (userTableInitPromises.get(userPrefix) === promise) {
            userTableInitPromises.delete(userPrefix);
        }
        throw error;
    });

    userTableInitPromises.set(userPrefix, promise);
    return promise;
}

async function initUserTables(userId) {
    return ensureUserTables(userId);
}

async function getUserTableContext(userId) {
    return ensureUserTables(userId);
}

async function initUserTablesUncached(userId) {
    const userPrefix = normalizeUserTablePrefix(userId);
    for (const sql of buildInitUserTableStatements(userPrefix)) {
        await sqliteRepository.executeNonQuery(sql);
    }

    return {
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        userPrefix
    };
}

async function purgeAvatarFeedData(userId, cutoffDate = null) {
    const userPrefix = normalizeUserTablePrefix(userId);
    if (cutoffDate) {
        await sqliteRepository.executeNonQuery(
            `DELETE FROM ${userPrefix}_feed_avatar WHERE created_at < @cutoff`,
            {
                '@cutoff': cutoffDate
            }
        );
        return;
    }

    await sqliteRepository.executeNonQuery(
        `DELETE FROM ${userPrefix}_feed_avatar`
    );
}

const userSessionRepository = {
    normalizeUserTablePrefix,
    ensureUserTables,
    getUserTableContext,
    initUserTables,
    initUserTablesUncached,
    purgeAvatarFeedData
};

export {
    ensureUserTables,
    getUserTableContext,
    initUserTables,
    initUserTablesUncached,
    normalizeUserTablePrefix,
    purgeAvatarFeedData
};
export default userSessionRepository;
