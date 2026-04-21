import { GLOBAL_TABLE_STATEMENTS } from './localDatabaseSchema.js';
import sqliteRepository from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

async function initGlobalTables() {
    for (const sql of GLOBAL_TABLE_STATEMENTS) {
        await sqliteRepository.executeNonQuery(sql);
    }
}

async function vacuum() {
    await sqliteRepository.executeNonQuery('VACUUM');
}

async function optimize() {
    await sqliteRepository.executeNonQuery('PRAGMA optimize');
}

async function countSql(sql) {
    let size = 0;
    await sqliteRepository.execute((row) => {
        size = Number.parseInt(row[0] ?? 0, 10) || 0;
    }, sql);
    return size;
}

async function getMaxFriendLogNumber(userId) {
    const userPrefix = normalizeUserTablePrefix(userId);
    let friendNumber = 0;
    await sqliteRepository.execute((row) => {
        friendNumber = Number.parseInt(row[0] ?? 0, 10) || 0;
    }, `SELECT MAX(friend_number) FROM ${userPrefix}_friend_log_current`);
    return friendNumber;
}

async function getUserTableSizes(userId) {
    if (!userId) {
        return {
            gps: 0,
            status: 0,
            bio: 0,
            avatar: 0,
            onlineOffline: 0,
            friendLogHistory: 0,
            notification: 0
        };
    }
    const userPrefix = normalizeUserTablePrefix(userId);
    const [
        gps,
        status,
        bio,
        avatar,
        onlineOffline,
        friendLogHistory,
        notification
    ] = await Promise.all([
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_feed_gps`),
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_feed_status`),
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_feed_bio`),
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_feed_avatar`),
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_feed_online_offline`),
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_friend_log_history`),
        countSql(`SELECT COUNT(*) FROM ${userPrefix}_notifications`)
    ]);

    return {
        gps,
        status,
        bio,
        avatar,
        onlineOffline,
        friendLogHistory,
        notification
    };
}

async function getGlobalTableSizes() {
    const [
        location,
        joinLeave,
        portalSpawn,
        videoPlay,
        event,
        external,
        resourceLoad
    ] = await Promise.all([
        countSql('SELECT COUNT(*) FROM gamelog_location'),
        countSql('SELECT COUNT(*) FROM gamelog_join_leave'),
        countSql('SELECT COUNT(*) FROM gamelog_portal_spawn'),
        countSql('SELECT COUNT(*) FROM gamelog_video_play'),
        countSql('SELECT COUNT(*) FROM gamelog_event'),
        countSql('SELECT COUNT(*) FROM gamelog_external'),
        countSql('SELECT COUNT(*) FROM gamelog_resource_load')
    ]);

    return {
        location,
        joinLeave,
        portalSpawn,
        videoPlay,
        event,
        external,
        resourceLoad
    };
}

async function getTableSizes(userId) {
    const [userSizes, globalSizes] = await Promise.all([
        getUserTableSizes(userId),
        getGlobalTableSizes()
    ]);
    return {
        ...userSizes,
        ...globalSizes
    };
}

async function selectTableNames(whereSql) {
    const tables = [];
    await sqliteRepository.execute((row) => {
        const tableName = row[0];
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
            tables.push(tableName);
        }
    }, `SELECT name FROM sqlite_schema WHERE type='table' AND (${whereSql})`);
    return tables;
}

async function updateTableForGroupNames() {
    const tables = await selectTableNames(
        "name LIKE '%_feed_gps' OR name LIKE '%_feed_online_offline' OR name = 'gamelog_location'"
    );
    for (const tableName of tables) {
        try {
            await sqliteRepository.executeNonQuery(
                `ALTER TABLE ${tableName} ADD group_name TEXT DEFAULT ''`
            );
        } catch (error) {
            const message = String(error);
            if (!message.includes('duplicate column name')) {
                console.error(message);
            }
        }
    }

    try {
        await sqliteRepository.executeNonQuery(
            'ALTER TABLE gamelog_location DROP COLUMN groupName'
        );
    } catch (error) {
        const message = String(error);
        if (!message.includes('no such column')) {
            console.error(message);
        }
    }
}

async function addFriendLogFriendNumber() {
    const tables = await selectTableNames(
        "name LIKE '%_friend_log_current' OR name LIKE '%_friend_log_history'"
    );
    for (const tableName of tables) {
        try {
            await sqliteRepository.executeNonQuery(
                `ALTER TABLE ${tableName} ADD friend_number INTEGER DEFAULT 0`
            );
        } catch (error) {
            const message = String(error);
            if (!message.includes('duplicate column name')) {
                console.error(message);
            }
        }
    }
}

async function updateTableForAvatarHistory() {
    const tables = await selectTableNames("name LIKE '%_avatar_history'");
    for (const tableName of tables) {
        try {
            await sqliteRepository.executeNonQuery(
                `ALTER TABLE ${tableName} ADD time INTEGER DEFAULT 0`
            );
        } catch (error) {
            const message = String(error);
            if (!message.includes('duplicate column name')) {
                console.error(message);
            }
        }
    }
}

async function addPerformanceIndexes() {
    await sqliteRepository.executeNonQuery(
        'CREATE INDEX IF NOT EXISTS idx_gamelog_location_world_created ON gamelog_location (world_id, created_at)'
    );
    await sqliteRepository.executeNonQuery(
        'CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location ON gamelog_join_leave (location)'
    );
    await sqliteRepository.executeNonQuery(
        'CREATE INDEX IF NOT EXISTS idx_gamelog_jl_user_created ON gamelog_join_leave (user_id, created_at)'
    );
    await sqliteRepository.executeNonQuery(
        'CREATE INDEX IF NOT EXISTS idx_gamelog_jl_display_created ON gamelog_join_leave (display_name, created_at)'
    );

    const tables = await selectTableNames(
        "name LIKE '%_friend_log_history'"
    );
    for (const tableName of tables) {
        try {
            await sqliteRepository.executeNonQuery(
                `CREATE INDEX IF NOT EXISTS ${tableName}_user_id_idx ON ${tableName} (user_id)`
            );
        } catch (error) {
            console.error(error);
        }
    }
}

async function upgradeDatabaseVersion() {
    await updateTableForGroupNames();
    await addFriendLogFriendNumber();
    await updateTableForAvatarHistory();
    await addPerformanceIndexes();
}

async function cleanLegendFromFriendLog() {
    const tables = await selectTableNames(
        "name LIKE '%_friend_log_history'"
    );
    for (const tableName of tables) {
        await sqliteRepository.executeNonQuery(
            `DELETE FROM ${tableName}
             WHERE type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z'
             AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))`
        );
    }
}

async function fixGameLogTraveling() {
    const travelingList = [];
    await sqliteRepository.execute((row) => {
        travelingList.unshift({
            rowId: row[0],
            created_at: row[1],
            type: row[2],
            displayName: row[3],
            location: row[4],
            userId: row[5],
            time: row[6]
        });
    }, "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND location = 'traveling'");

    for (const travelingEntry of travelingList) {
        let joinEntry = null;
        await sqliteRepository.execute(
            (row) => {
                joinEntry = {
                    rowId: row[0],
                    created_at: row[1],
                    type: row[2],
                    displayName: row[3],
                    location: row[4],
                    userId: row[5],
                    time: row[6]
                };
            },
            "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerJoined' AND display_name = @displayName AND created_at <= @created_at ORDER BY created_at DESC LIMIT 1",
            {
                '@displayName': travelingEntry.displayName,
                '@created_at': travelingEntry.created_at
            }
        );
        if (joinEntry?.location) {
            await sqliteRepository.executeNonQuery(
                'UPDATE gamelog_join_leave SET location = @location WHERE id = @rowId',
                {
                    '@rowId': travelingEntry.rowId,
                    '@location': joinEntry.location
                }
            );
        }
    }
}

async function fixNegativeGPS() {
    const tables = await selectTableNames("name LIKE '%_gps'");
    for (const tableName of tables) {
        await sqliteRepository.executeNonQuery(
            `UPDATE ${tableName} SET time = 0 WHERE time < 0`
        );
    }
}

async function getGameLogInstancesTime() {
    const instances = new Map();
    await sqliteRepository.execute((row) => {
        const location = row[0];
        const time = Number.parseInt(row[1] ?? 0, 10) || 0;
        instances.set(location, (instances.get(location) || 0) + time);
    }, 'SELECT location, time FROM gamelog_location');
    return instances;
}

async function getBrokenLeaveEntries() {
    const instances = await getGameLogInstancesTime();
    const badEntries = [];
    await sqliteRepository.execute((row) => {
        const location = row[0];
        const time = row[1];
        const id = row[2];
        if (typeof time !== 'number') {
            return;
        }
        const instanceTime = instances.get(location);
        if (typeof instanceTime !== 'undefined' && time > instanceTime) {
            badEntries.push(id);
        }
    }, "SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0");
    return badEntries;
}

async function fixBrokenLeaveEntries() {
    const badEntries = await getBrokenLeaveEntries();
    if (badEntries.length === 0) {
        return;
    }
    const args = {};
    const placeholders = badEntries.map((entry, index) => {
        const key = `@entry_${index}`;
        args[key] = entry;
        return key;
    });

    await sqliteRepository.executeNonQuery(
        `UPDATE gamelog_join_leave SET time = 0 WHERE id IN (${placeholders.join(', ')})`,
        args
    );
}

async function fixBrokenGroupInvites() {
    const tables = await selectTableNames("name LIKE '%_notifications'");
    for (const tableName of tables) {
        await sqliteRepository.executeNonQuery(
            `DELETE FROM ${tableName} WHERE type LIKE '%.%'`
        );
    }
}

async function fixBrokenNotifications() {
    const tables = await selectTableNames("name LIKE '%_notifications'");
    for (const tableName of tables) {
        await sqliteRepository.executeNonQuery(
            `DELETE FROM ${tableName} WHERE (created_at is null or created_at = '')`
        );
    }
}

async function fixBrokenGroupChange() {
    const tables = await selectTableNames("name LIKE '%_notifications'");
    for (const tableName of tables) {
        await sqliteRepository.executeNonQuery(
            `DELETE FROM ${tableName} WHERE type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'`
        );
    }
}

async function fixCancelFriendRequestTypo() {
    const tables = await selectTableNames(
        "name LIKE '%_friend_log_history'"
    );
    for (const tableName of tables) {
        await sqliteRepository.executeNonQuery(
            `UPDATE ${tableName} SET type = 'CancelFriendRequest' WHERE type = 'CancelFriendRequst'`
        );
    }
}

async function getBrokenGameLogDisplayNames() {
    const badEntries = [];
    await sqliteRepository.execute((row) => {
        badEntries.push({
            id: row[0],
            displayName: row[1]
        });
    }, "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'");
    return badEntries;
}

async function fixBrokenGameLogDisplayNames() {
    const badEntries = await getBrokenGameLogDisplayNames();
    for (const entry of badEntries) {
        await sqliteRepository.executeNonQuery(
            'UPDATE gamelog_join_leave SET display_name = @new_display_name WHERE id = @id',
            {
                '@new_display_name': String(entry.displayName || '').split(
                    ' ('
                )[0],
                '@id': entry.id
            }
        );
    }
}

const databaseMaintenanceRepository = Object.freeze({
    addFriendLogFriendNumber,
    addPerformanceIndexes,
    cleanLegendFromFriendLog,
    fixBrokenGameLogDisplayNames,
    fixBrokenGroupChange,
    fixBrokenGroupInvites,
    fixBrokenLeaveEntries,
    fixBrokenNotifications,
    fixCancelFriendRequestTypo,
    fixGameLogTraveling,
    fixNegativeGPS,
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getTableSizes,
    getUserTableSizes,
    initGlobalTables,
    optimize,
    updateTableForAvatarHistory,
    updateTableForGroupNames,
    upgradeDatabaseVersion,
    vacuum
});

export {
    addFriendLogFriendNumber,
    addPerformanceIndexes,
    cleanLegendFromFriendLog,
    fixBrokenGameLogDisplayNames,
    fixBrokenGroupChange,
    fixBrokenGroupInvites,
    fixBrokenLeaveEntries,
    fixBrokenNotifications,
    fixCancelFriendRequestTypo,
    fixGameLogTraveling,
    fixNegativeGPS,
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getTableSizes,
    getUserTableSizes,
    initGlobalTables,
    optimize,
    updateTableForAvatarHistory,
    updateTableForGroupNames,
    upgradeDatabaseVersion,
    vacuum
};
export default databaseMaintenanceRepository;
