import sqliteRepository from './sqliteRepository.js';
import {
    buildInitUserTableStatements,
    normalizeUserTablePrefix
} from '../services/database/userTables.js';

class UserSessionRepository {
    normalizeUserTablePrefix(userId) {
        return normalizeUserTablePrefix(userId);
    }

    async initUserTables(userId) {
        const userPrefix = normalizeUserTablePrefix(userId);
        for (const sql of buildInitUserTableStatements(userPrefix)) {
            await sqliteRepository.executeNonQuery(sql);
        }

        return {
            userId: typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim(),
            userPrefix
        };
    }

    async purgeAvatarFeedData(userId, cutoffDate = null) {
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
}

const userSessionRepository = new UserSessionRepository();

export { UserSessionRepository, normalizeUserTablePrefix };
export default userSessionRepository;
