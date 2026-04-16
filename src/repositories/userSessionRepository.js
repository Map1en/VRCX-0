import sqliteRepository from './sqliteRepository.js';
import {
    buildInitUserTableStatements,
    normalizeUserTablePrefix as baseNormalizeUserTablePrefix
} from '../services/database/userTables.js';

function normalizeUserTablePrefix(userId) {
    return baseNormalizeUserTablePrefix(userId);
}

async function initUserTables(userId) {
    const userPrefix = normalizeUserTablePrefix(userId);
    for (const sql of buildInitUserTableStatements(userPrefix)) {
        await sqliteRepository.executeNonQuery(sql);
    }

    return {
        userId: typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim(),
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

    await sqliteRepository.executeNonQuery(`DELETE FROM ${userPrefix}_feed_avatar`);
}

const userSessionRepository = {
    normalizeUserTablePrefix,
    initUserTables,
    purgeAvatarFeedData
};

export { normalizeUserTablePrefix, initUserTables, purgeAvatarFeedData };
export default userSessionRepository;
