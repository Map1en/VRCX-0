import { dbVars } from '../database';

import sqliteService from '../../repositories/sqliteRepository.js';

const moderation = {
    async getModeration(userId) {
        var row = {};
        await sqliteService.execute(
            (dbRow) => {
                var block = false;
                var mute = false;
                if (dbRow[3] === 1) {
                    block = true;
                }
                if (dbRow[4] === 1) {
                    mute = true;
                }
                row = {
                    userId: dbRow[0],
                    updatedAt: dbRow[1],
                    displayName: dbRow[2],
                    block,
                    mute
                };
            },
            `SELECT * FROM ${dbVars.userPrefix}_moderation WHERE user_id = @userId`,
            {
                '@userId': userId
            }
        );
        return row;
    },

    async getAllModerations() {
        var rows = [];
        await sqliteService.execute(
            (dbRow) => {
                rows.push({
                    userId: dbRow[0],
                    updatedAt: dbRow[1],
                    displayName: dbRow[2],
                    block: dbRow[3] === 1,
                    mute: dbRow[4] === 1
                });
            },
            `SELECT * FROM ${dbVars.userPrefix}_moderation`
        );
        return rows;
    },

    async setModeration(entry) {
        var block = 0;
        var mute = 0;
        if (entry.block) {
            block = 1;
        }
        if (entry.mute) {
            mute = 1;
        }
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_moderation (user_id, updated_at, display_name, block, mute) VALUES (@user_id, @updated_at, @display_name, @block, @mute)`,
            {
                '@user_id': entry.userId,
                '@updated_at': entry.updatedAt,
                '@display_name': entry.displayName,
                '@block': block,
                '@mute': mute
            }
        );
    },

    async deleteModeration(userId) {
        await sqliteService.executeNonQuery(
            `DELETE FROM ${dbVars.userPrefix}_moderation WHERE user_id = @user_id`,
            {
                '@user_id': userId
            }
        );
    }
};

export { moderation };
