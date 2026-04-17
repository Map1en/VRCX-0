import sqliteService from '../../repositories/sqliteRepository.js';
import { dbVars } from '../database';
import { buildValuesList } from './sqlHelpers.js';

const friendLogCurrent = {
    async getFriendLogCurrent() {
        var friendLogCurrent = [];
        await sqliteService.execute((dbRow) => {
            var row = {
                userId: dbRow[0],
                displayName: dbRow[1],
                trustLevel: dbRow[2],
                friendNumber: dbRow[3]
            };
            friendLogCurrent.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_friend_log_current`);
        return friendLogCurrent;
    },

    setFriendLogCurrent(entry) {
        sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)`,
            {
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@trust_level': entry.trustLevel,
                '@friend_number': entry.friendNumber
            }
        );
    },

    setFriendLogCurrentArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        const { valuesSql, args } = buildValuesList(
            inputData,
            [
                {
                    column: 'user_id',
                    value: (line) =>
                        typeof line.userId === 'string' ? line.userId : ''
                },
                {
                    column: 'display_name',
                    value: (line) =>
                        typeof line.displayName === 'string'
                            ? line.displayName
                            : ''
                },
                {
                    column: 'trust_level',
                    value: (line) =>
                        typeof line.trustLevel === 'string'
                            ? line.trustLevel
                            : ''
                },
                {
                    column: 'friend_number',
                    value: (line) =>
                        typeof line.friendNumber === 'number'
                            ? line.friendNumber
                            : null
                }
            ],
            'friend_log_current'
        );
        return sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES ${valuesSql}`,
            args
        );
    },

    deleteFriendLogCurrent(userId) {
        sqliteService.executeNonQuery(
            `DELETE FROM ${dbVars.userPrefix}_friend_log_current WHERE user_id = @user_id`,
            {
                '@user_id': userId
            }
        );
    }
};

export { friendLogCurrent };
