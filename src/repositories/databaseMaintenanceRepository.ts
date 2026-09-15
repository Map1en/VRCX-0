import {
    commands,
    type BrokenGameLogDisplayNameOutput,
    type JsonValue,
    type MaintenanceTableSizesOutput
} from '@/platform/tauri/bindings';

type UserMaintenanceTableSizeKey =
    | 'gps'
    | 'status'
    | 'bio'
    | 'avatar'
    | 'onlineOffline'
    | 'friendLogHistory'
    | 'notification';
type GlobalMaintenanceTableSizeKey =
    | 'location'
    | 'joinLeave'
    | 'portalSpawn'
    | 'videoPlay'
    | 'event'
    | 'external'
    | 'resourceLoad';
type UserMaintenanceTableSizes = Pick<
    MaintenanceTableSizesOutput,
    UserMaintenanceTableSizeKey
>;
type GlobalMaintenanceTableSizes = Pick<
    MaintenanceTableSizesOutput,
    GlobalMaintenanceTableSizeKey
>;

async function getMaxFriendLogNumber(userId: string): Promise<number> {
    return commands.appDatabaseMaintenanceMaxFriendLogNumberGet(userId.trim());
}

async function getRuntimeTableSizes(
    userId = ''
): Promise<MaintenanceTableSizesOutput> {
    return commands.appDatabaseMaintenanceTableSizesGet(userId.trim());
}

async function getUserTableSizes(
    userId: string
): Promise<UserMaintenanceTableSizes> {
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

async function getGlobalTableSizes(): Promise<GlobalMaintenanceTableSizes> {
    const {
        location,
        joinLeave,
        portalSpawn,
        videoPlay,
        event,
        external,
        resourceLoad
    } = await getRuntimeTableSizes();
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
    userId: string
): Promise<MaintenanceTableSizesOutput> {
    return getRuntimeTableSizes(userId);
}

async function getBrokenLeaveEntries(): Promise<JsonValue[]> {
    return commands.appDatabaseMaintenanceBrokenLeaveEntriesGet();
}

async function getBrokenGameLogDisplayNames(): Promise<
    BrokenGameLogDisplayNameOutput[]
> {
    return commands.appDatabaseMaintenanceBrokenGameLogDisplayNamesGet();
}

const databaseMaintenanceRepository = Object.freeze({
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getTableSizes,
    getUserTableSizes
});

export {
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getUserTableSizes
};
export default databaseMaintenanceRepository;
