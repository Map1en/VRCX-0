import { dbVars } from '../database';
import { buildInClause, buildValuesList } from './sqlHelpers.js';

import sqliteService from '../../repositories/sqliteRepository.js';

function stringOrNull(value) {
    return typeof value === 'string' ? value : null;
}

const friendLogHistory = {
    async getFriendLogHistory() {
        var friendLogHistory = [];
        await sqliteService.execute((dbRow) => {
            var row = {
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                userId: dbRow[3],
                displayName: dbRow[4],
                friendNumber: dbRow[8]
            };
            if (row.type === 'DisplayName') {
                row.previousDisplayName = dbRow[5];
            } else if (row.type === 'TrustLevel') {
                row.trustLevel = dbRow[6];
                row.previousTrustLevel = dbRow[7];
            }
            friendLogHistory.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_friend_log_history`);
        return friendLogHistory;
    },

    addFriendLogHistory(entry) {
        sqliteService.executeNonQuery(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)`,
            {
                '@created_at': entry.created_at,
                '@type': entry.type,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@previous_display_name': entry.previousDisplayName,
                '@trust_level': entry.trustLevel,
                '@previous_trust_level': entry.previousTrustLevel,
                '@friend_number': entry.friendNumber
            }
        );
    },

    addFriendLogHistoryArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        const { valuesSql, args } = buildValuesList(
            inputData,
            [
                { column: 'created_at', value: (line) => stringOrNull(line.created_at) },
                { column: 'type', value: (line) => stringOrNull(line.type) },
                { column: 'user_id', value: (line) => stringOrNull(line.userId) },
                {
                    column: 'display_name',
                    value: (line) => stringOrNull(line.displayName)
                },
                {
                    column: 'previous_display_name',
                    value: (line) => stringOrNull(line.previousDisplayName)
                },
                {
                    column: 'trust_level',
                    value: (line) => stringOrNull(line.trustLevel)
                },
                {
                    column: 'previous_trust_level',
                    value: (line) => stringOrNull(line.previousTrustLevel)
                },
                {
                    column: 'friend_number',
                    value: (line) =>
                        typeof line.friendNumber === 'number'
                            ? line.friendNumber
                            : null
                }
            ],
            'friend_log_history'
        );
        return sqliteService.executeNonQuery(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES ${valuesSql}`,
            args
        );
    },

    async getFriendLogHistoryForUserId(userId, types) {
        const friendLogHistory = [];
        const typeInClause = buildInClause('type', types, 'friend_history_type');
        const typeFilter = typeInClause.clause ? ` AND ${typeInClause.clause}` : '';
        await sqliteService.execute(
            (dbRow) => {
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    type: dbRow[2],
                    userId: dbRow[3],
                    displayName: dbRow[4],
                    friendNumber: dbRow[8]
                };
                if (row.type === 'DisplayName') {
                    row.previousDisplayName = dbRow[5];
                } else if (row.type === 'TrustLevel') {
                    row.trustLevel = dbRow[6];
                    row.previousTrustLevel = dbRow[7];
                }
                friendLogHistory.push(row);
            },
            `SELECT * FROM ${dbVars.userPrefix}_friend_log_history WHERE user_id = @user_id${typeFilter}`,
            {
                '@user_id': userId,
                ...typeInClause.args
            }
        );
        return friendLogHistory;
    },

    // https://github.com/vrcx-team/VRCX/issues/1262
    deleteFriendLogHistory(entry) {
        if (entry.rowId != null) {
            sqliteService.executeNonQuery(
                `DELETE FROM ${dbVars.userPrefix}_friend_log_history WHERE id = @row_id`,
                {
                    '@row_id': entry.rowId
                }
            );
        } else {
            // Entries created in-session don't have a rowId yet;
            // fall back to composite key so the DB row is still removed.
            sqliteService.executeNonQuery(
                `DELETE FROM ${dbVars.userPrefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id`,
                {
                    '@created_at': entry.created_at,
                    '@type': entry.type,
                    '@user_id': entry.userId
                }
            );
        }
    }
};

export { friendLogHistory };
