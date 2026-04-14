import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

function normalizeFriendLogRow(row) {
    if (Array.isArray(row)) {
        return {
            userId: row[0] ?? '',
            displayName: row[1] ?? '',
            trustLevel: row[2] ?? 'Visitor',
            friendNumber: Number.parseInt(row[3] ?? 0, 10) || 0
        };
    }

    return {
        userId: row?.user_id ?? row?.userId ?? '',
        displayName: row?.display_name ?? row?.displayName ?? '',
        trustLevel: row?.trust_level ?? row?.trustLevel ?? 'Visitor',
        friendNumber: Number.parseInt(row?.friend_number ?? row?.friendNumber ?? 0, 10) || 0
    };
}

class FriendLogRepository {
    async getFriendLogCurrent(userId) {
        const userPrefix = normalizeUserTablePrefix(userId);
        const rows = await sqliteRepository.query(
            `SELECT user_id, display_name, trust_level, friend_number FROM ${userPrefix}_friend_log_current ORDER BY friend_number ASC, display_name COLLATE NOCASE ASC, user_id ASC`
        );

        if (!Array.isArray(rows)) {
            return [];
        }

        return rows
            .map(normalizeFriendLogRow)
            .filter((row) => typeof row.userId === 'string' && row.userId.trim());
    }

    async replaceFriendLogCurrent(userId, entries = []) {
        const userPrefix = normalizeUserTablePrefix(userId);

        await sqliteRepository.transaction(async (tx) => {
            await tx.executeNonQuery(`DELETE FROM ${userPrefix}_friend_log_current`);

            for (const entry of entries) {
                if (!entry?.userId) {
                    continue;
                }

                await tx.executeNonQuery(
                    `INSERT OR REPLACE INTO ${userPrefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)`,
                    {
                        '@user_id': entry.userId,
                        '@display_name': entry.displayName ?? '',
                        '@trust_level': entry.trustLevel ?? 'Visitor',
                        '@friend_number': Number.parseInt(entry.friendNumber ?? 0, 10) || 0
                    }
                );
            }
        });

        return {
            userId:
                typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim(),
            count: Array.isArray(entries) ? entries.length : 0
        };
    }
}

const friendLogRepository = new FriendLogRepository();

export { FriendLogRepository };
export default friendLogRepository;
