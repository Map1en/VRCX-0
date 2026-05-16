import { backend } from '@/platform/index.js';

import sqliteRepository, { type SQLiteValue } from './sqliteRepository.js';
import { normalizeUserTablePrefix } from './userSessionRepository.js';

type MaintenanceTableSizes = {
    gps: number;
    status: number;
    bio: number;
    avatar: number;
    onlineOffline: number;
    friendLogHistory: number;
    notification: number;
    location?: number;
    joinLeave?: number;
    portalSpawn?: number;
    videoPlay?: number;
    event?: number;
    external?: number;
    resourceLoad?: number;
};

type BrokenGameLogDisplayNameEntry = {
    id: SQLiteValue;
    displayName: unknown;
};

function runMaintenanceTask(task: string): Promise<unknown> {
    return backend.app.DatabaseMaintenanceRun({ task });
}

async function initGlobalTables(): Promise<void> {
    await runMaintenanceTask('initGlobalTables');
}

async function vacuum(): Promise<void> {
    await runMaintenanceTask('vacuum');
}

async function optimize(): Promise<void> {
    await runMaintenanceTask('optimize');
}

async function countSql(sql: string): Promise<number> {
    let size = 0;
    await sqliteRepository.execute((row) => {
        size = Number.parseInt(row[0] ?? 0, 10) || 0;
    }, sql);
    return size;
}

async function getMaxFriendLogNumber(userId: unknown): Promise<number> {
    const userPrefix = normalizeUserTablePrefix(userId);
    let friendNumber = 0;
    await sqliteRepository.execute((row) => {
        friendNumber = Number.parseInt(row[0] ?? 0, 10) || 0;
    }, `SELECT MAX(friend_number) FROM ${userPrefix}_friend_log_current`);
    return friendNumber;
}

async function getUserTableSizes(
    userId: unknown
): Promise<MaintenanceTableSizes> {
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

async function getGlobalTableSizes(): Promise<Partial<MaintenanceTableSizes>> {
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

async function getTableSizes(
    userId: unknown
): Promise<MaintenanceTableSizes> {
    const [userSizes, globalSizes] = await Promise.all([
        getUserTableSizes(userId),
        getGlobalTableSizes()
    ]);
    return {
        ...userSizes,
        ...globalSizes
    };
}

async function updateTableForGroupNames(): Promise<void> {
    await runMaintenanceTask('updateTableForGroupNames');
}

async function addFriendLogFriendNumber(): Promise<void> {
    await runMaintenanceTask('addFriendLogFriendNumber');
}

async function updateTableForAvatarHistory(): Promise<void> {
    await runMaintenanceTask('updateTableForAvatarHistory');
}

async function addV17PerformanceIndexes(): Promise<void> {
    await runMaintenanceTask('addV17PerformanceIndexes');
}

async function addPerformanceIndexes(): Promise<void> {
    await runMaintenanceTask('addPerformanceIndexes');
}

async function upgradeDatabaseVersion(): Promise<void> {
    await runMaintenanceTask('upgradeDatabaseVersion');
}

async function cleanLegendFromFriendLog(): Promise<void> {
    await runMaintenanceTask('cleanLegendFromFriendLog');
}

async function fixGameLogTraveling(): Promise<void> {
    await runMaintenanceTask('fixGameLogTraveling');
}

async function fixNegativeGPS(): Promise<void> {
    await runMaintenanceTask('fixNegativeGPS');
}

async function getGameLogInstancesTime(): Promise<Map<unknown, number>> {
    const instances = new Map<unknown, number>();
    await sqliteRepository.execute((row) => {
        const location = row[0];
        const time = Number.parseInt(row[1] ?? 0, 10) || 0;
        instances.set(location, (instances.get(location) || 0) + time);
    }, 'SELECT location, time FROM gamelog_location');
    return instances;
}

async function getBrokenLeaveEntries(): Promise<SQLiteValue[]> {
    const instances = await getGameLogInstancesTime();
    const badEntries: SQLiteValue[] = [];
    await sqliteRepository.execute((row) => {
        const location = row[0];
        const time = row[1];
        const id = row[2];
        if (typeof time !== 'number') {
            return;
        }
        const instanceTime = instances.get(location);
        if (typeof instanceTime !== 'undefined' && time > instanceTime) {
            badEntries.push(id as SQLiteValue);
        }
    }, "SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0");
    return badEntries;
}

async function fixBrokenLeaveEntries(): Promise<void> {
    await runMaintenanceTask('fixBrokenLeaveEntries');
}

async function fixBrokenGroupInvites(): Promise<void> {
    await runMaintenanceTask('fixBrokenGroupInvites');
}

async function fixBrokenNotifications(): Promise<void> {
    await runMaintenanceTask('fixBrokenNotifications');
}

async function fixBrokenGroupChange(): Promise<void> {
    await runMaintenanceTask('fixBrokenGroupChange');
}

async function fixCancelFriendRequestTypo(): Promise<void> {
    await runMaintenanceTask('fixCancelFriendRequestTypo');
}

async function getBrokenGameLogDisplayNames(): Promise<
    BrokenGameLogDisplayNameEntry[]
> {
    const badEntries: BrokenGameLogDisplayNameEntry[] = [];
    await sqliteRepository.execute((row) => {
        badEntries.push({
            id: row[0] as SQLiteValue,
            displayName: row[1]
        });
    }, "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'");
    return badEntries;
}

async function fixBrokenGameLogDisplayNames(): Promise<void> {
    await runMaintenanceTask('fixBrokenGameLogDisplayNames');
}

const databaseMaintenanceRepository = Object.freeze({
    addFriendLogFriendNumber,
    addPerformanceIndexes,
    addV17PerformanceIndexes,
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
    addV17PerformanceIndexes,
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
