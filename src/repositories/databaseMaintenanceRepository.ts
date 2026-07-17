import {
    commands,
    type MaintenanceTableSizesOutput
} from '@/platform/tauri/bindings';

type LocalDbValue = unknown;

type GlobalMaintenanceTableSizeKey =
    | 'location'
    | 'joinLeave'
    | 'portalSpawn'
    | 'videoPlay'
    | 'event'
    | 'external'
    | 'resourceLoad';
type MaintenanceTableSizes = Omit<
    MaintenanceTableSizesOutput,
    GlobalMaintenanceTableSizeKey
> &
    Partial<Pick<MaintenanceTableSizesOutput, GlobalMaintenanceTableSizeKey>>;

type BrokenGameLogDisplayNameEntry = {
    id: LocalDbValue;
    displayName: unknown;
};

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function vacuum(): Promise<void> {
    await commands.appDatabaseMaintenanceRun('vacuum');
}

async function getMaxFriendLogNumber(userId: unknown): Promise<number> {
    return Number(
        (await commands.appDatabaseMaintenanceMaxFriendLogNumberGet(
            normalizeUserId(userId)
        )) ?? 0
    );
}

async function getRuntimeTableSizes(
    userId: unknown = ''
): Promise<MaintenanceTableSizes> {
    return commands.appDatabaseMaintenanceTableSizesGet(
        normalizeUserId(userId)
    );
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

async function getBrokenLeaveEntries(): Promise<LocalDbValue[]> {
    const rows = await commands.appDatabaseMaintenanceBrokenLeaveEntriesGet();
    return Array.isArray(rows) ? rows : [];
}

async function getBrokenGameLogDisplayNames(): Promise<
    BrokenGameLogDisplayNameEntry[]
> {
    const rows =
        await commands.appDatabaseMaintenanceBrokenGameLogDisplayNamesGet();
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.id,
        displayName: row.displayName
    }));
}

const databaseMaintenanceRepository = Object.freeze({
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getTableSizes,
    getUserTableSizes,
    vacuum
});

export {
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getTableSizes,
    getUserTableSizes,
    vacuum
};
export default databaseMaintenanceRepository;
