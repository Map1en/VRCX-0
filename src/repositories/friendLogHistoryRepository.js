import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

const FRIEND_LOG_TYPES = Object.freeze([
    'Friend',
    'Unfriend',
    'FriendRequest',
    'CancelFriendRequest',
    'DisplayName',
    'TrustLevel'
]);

function normalizeFriendLogHistoryRow(row) {
    if (Array.isArray(row)) {
        const normalizedRow = {
            rowId: Number.parseInt(row[0] ?? 0, 10) || 0,
            created_at: row[1] ?? '',
            type: row[2] ?? '',
            userId: row[3] ?? '',
            displayName: row[4] ?? '',
            friendNumber: Number.parseInt(row[8] ?? 0, 10) || 0
        };

        if (normalizedRow.type === 'DisplayName') {
            normalizedRow.previousDisplayName = row[5] ?? '';
        } else if (normalizedRow.type === 'TrustLevel') {
            normalizedRow.trustLevel = row[6] ?? '';
            normalizedRow.previousTrustLevel = row[7] ?? '';
        }

        return normalizedRow;
    }

    const normalizedRow = {
        rowId: Number.parseInt(row?.id ?? row?.rowId ?? 0, 10) || 0,
        created_at: row?.created_at ?? row?.createdAt ?? '',
        type: row?.type ?? '',
        userId: row?.user_id ?? row?.userId ?? '',
        displayName: row?.display_name ?? row?.displayName ?? '',
        friendNumber:
            Number.parseInt(row?.friend_number ?? row?.friendNumber ?? 0, 10) || 0
    };

    if (normalizedRow.type === 'DisplayName') {
        normalizedRow.previousDisplayName =
            row?.previous_display_name ?? row?.previousDisplayName ?? '';
    } else if (normalizedRow.type === 'TrustLevel') {
        normalizedRow.trustLevel = row?.trust_level ?? row?.trustLevel ?? '';
        normalizedRow.previousTrustLevel =
            row?.previous_trust_level ?? row?.previousTrustLevel ?? '';
    }

    return normalizedRow;
}

class FriendLogHistoryRepository {
    async getFriendLogHistory(userId, options = {}) {
        const userPrefix = normalizeUserTablePrefix(userId);
        const whereClauses = [];
        const args = {};

        const normalizedTargetUserId =
            typeof options.targetUserId === 'string'
                ? options.targetUserId.trim()
                : String(options.targetUserId ?? '').trim();
        if (normalizedTargetUserId) {
            whereClauses.push('user_id = @user_id');
            args['@user_id'] = normalizedTargetUserId;
        }

        const normalizedTypes = Array.isArray(options.types)
            ? options.types
                  .map((entry) =>
                      typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()
                  )
                  .filter((entry) => entry && FRIEND_LOG_TYPES.includes(entry))
            : [];
        if (normalizedTypes.length) {
            const typePlaceholders = normalizedTypes.map((type, index) => {
                const key = `@type_${index}`;
                args[key] = type;
                return key;
            });
            whereClauses.push(`type IN (${typePlaceholders.join(', ')})`);
        }

        const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';
        const rows = await sqliteRepository.query(
            `SELECT id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number FROM ${userPrefix}_friend_log_history${whereSql} ORDER BY created_at DESC, id DESC`,
            args
        );

        if (!Array.isArray(rows)) {
            return [];
        }

        return rows
            .map(normalizeFriendLogHistoryRow)
            .filter((row) => typeof row.userId === 'string' && row.userId.trim());
    }

    async deleteFriendLogHistory(userId, entry) {
        const userPrefix = normalizeUserTablePrefix(userId);
        const rowId = Number.parseInt(entry?.rowId ?? 0, 10) || 0;

        if (rowId > 0) {
            return sqliteRepository.executeNonQuery(
                `DELETE FROM ${userPrefix}_friend_log_history WHERE id = @row_id`,
                {
                    '@row_id': rowId
                }
            );
        }

        return sqliteRepository.executeNonQuery(
            `DELETE FROM ${userPrefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id`,
            {
                '@created_at': entry?.created_at ?? '',
                '@type': entry?.type ?? '',
                '@user_id': entry?.userId ?? ''
            }
        );
    }
}

const friendLogHistoryRepository = new FriendLogHistoryRepository();

export { FRIEND_LOG_TYPES, FriendLogHistoryRepository };
export default friendLogHistoryRepository;
