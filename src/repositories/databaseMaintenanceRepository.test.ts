import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appDatabaseMaintenanceRun: vi.fn(),
    appDatabaseMaintenanceMaxFriendLogNumberGet: vi.fn(),
    appDatabaseMaintenanceTableSizesGet: vi.fn(),
    appDatabaseMaintenanceBrokenLeaveEntriesGet: vi.fn(),
    appDatabaseMaintenanceBrokenGameLogDisplayNamesGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import databaseMaintenanceRepository, {
    getBrokenGameLogDisplayNames,
    getBrokenLeaveEntries,
    getGlobalTableSizes,
    getMaxFriendLogNumber,
    getUserTableSizes,
    vacuum
} from './databaseMaintenanceRepository';

const runtimeSizes = {
    gps: 1,
    status: 2,
    bio: 3,
    avatar: 4,
    onlineOffline: 5,
    friendLogHistory: 6,
    notification: 7,
    location: 8,
    joinLeave: 9,
    portalSpawn: 10,
    videoPlay: 11,
    event: 12,
    external: 13,
    resourceLoad: 14
};

describe('databaseMaintenanceRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appDatabaseMaintenanceRun.mockResolvedValue(undefined);
        commandMocks.appDatabaseMaintenanceMaxFriendLogNumberGet.mockResolvedValue(
            '42'
        );
        commandMocks.appDatabaseMaintenanceTableSizesGet.mockResolvedValue(
            runtimeSizes
        );
        commandMocks.appDatabaseMaintenanceBrokenLeaveEntriesGet.mockResolvedValue(
            [{ id: 1 }]
        );
        commandMocks.appDatabaseMaintenanceBrokenGameLogDisplayNamesGet.mockResolvedValue(
            [
                {
                    id: 1,
                    displayName: 'Fixed Name',
                    ignored: true
                }
            ]
        );
    });

    it('exposes only the user-triggered vacuum maintenance task', async () => {
        await vacuum();

        expect(commandMocks.appDatabaseMaintenanceRun).toHaveBeenCalledWith(
            'vacuum'
        );
    });

    it('normalizes max friend log and table-size inputs and outputs', async () => {
        await expect(getMaxFriendLogNumber(' usr_1 ')).resolves.toBe(42);
        await expect(getUserTableSizes('usr_1')).resolves.toEqual({
            gps: 1,
            status: 2,
            bio: 3,
            avatar: 4,
            onlineOffline: 5,
            friendLogHistory: 6,
            notification: 7
        });
        await expect(getUserTableSizes('')).resolves.toEqual({
            gps: 0,
            status: 0,
            bio: 0,
            avatar: 0,
            onlineOffline: 0,
            friendLogHistory: 0,
            notification: 0
        });

        expect(
            commandMocks.appDatabaseMaintenanceMaxFriendLogNumberGet
        ).toHaveBeenCalledWith('usr_1');
        expect(
            commandMocks.appDatabaseMaintenanceTableSizesGet
        ).toHaveBeenCalledWith('usr_1');
    });

    it('returns only global game-log table sizes for global table summaries', async () => {
        await expect(getGlobalTableSizes()).resolves.toEqual({
            location: 8,
            joinLeave: 9,
            portalSpawn: 10,
            videoPlay: 11,
            event: 12,
            external: 13,
            resourceLoad: 14
        });

        expect(
            commandMocks.appDatabaseMaintenanceTableSizesGet
        ).toHaveBeenCalledWith('');
    });

    it('defensively shapes broken-row query results', async () => {
        await expect(getBrokenLeaveEntries()).resolves.toEqual([{ id: 1 }]);
        await expect(getBrokenGameLogDisplayNames()).resolves.toEqual([
            {
                id: 1,
                displayName: 'Fixed Name'
            }
        ]);

        commandMocks.appDatabaseMaintenanceBrokenLeaveEntriesGet.mockResolvedValueOnce(
            null
        );
        commandMocks.appDatabaseMaintenanceBrokenGameLogDisplayNamesGet.mockResolvedValueOnce(
            null
        );

        await expect(
            databaseMaintenanceRepository.getBrokenLeaveEntries()
        ).resolves.toEqual([]);
        await expect(
            databaseMaintenanceRepository.getBrokenGameLogDisplayNames()
        ).resolves.toEqual([]);
    });
});
