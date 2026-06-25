import { commands } from '@/platform/tauri/bindings';

type LocalDbValue = unknown;

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
    id: LocalDbValue;
    displayName: unknown;
};

function runMaintenanceTask(task: string): Promise<unknown> {
    return commands.appDatabaseMaintenanceRun(task);
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

async function getMaxFriendLogNumber(userId: unknown): Promise<number> {
    return Number(
        (await commands.appDatabaseMaintenanceMaxFriendLogNumberGet(
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim()
        )) ?? 0
    );
}

async function getRuntimeTableSizes(
    userId: unknown = ''
): Promise<MaintenanceTableSizes> {
    const sizes = (await commands.appDatabaseMaintenanceTableSizesGet(
        typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim()
    )) as MaintenanceTableSizes;
    return sizes;
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
    const {
        gps,
        status,
        bio,
        avatar,
        onlineOffline,
        friendLogHistory,
        notification
    } = await getRuntimeTableSizes(userId);
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
    const {
        location,
        joinLeave,
        portalSpawn,
        videoPlay,
        event,
        external,
        resourceLoad
    } = await getRuntimeTableSizes('');
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

async function getTableSizes(userId: unknown): Promise<MaintenanceTableSizes> {
    return getRuntimeTableSizes(userId);
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

async function getBrokenLeaveEntries(): Promise<LocalDbValue[]> {
    const rows = await commands.appDatabaseMaintenanceBrokenLeaveEntriesGet();
    return Array.isArray(rows) ? (rows as LocalDbValue[]) : [];
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
    const rows =
        (await commands.appDatabaseMaintenanceBrokenGameLogDisplayNamesGet()) as Array<{
            id?: LocalDbValue;
            displayName?: unknown;
        }> | null;
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.id,
        displayName: row.displayName
    }));
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
