import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastWarning: vi.fn(),
    sqliteGetFailedUpgrade: vi.fn(),
    sqliteBeginUpgrade: vi.fn(),
    sqliteCommitUpgrade: vi.fn(),
    sqliteFailUpgrade: vi.fn(),
    appGetLegacyVrcxMigrationStatus: vi.fn(),
    appCheckLegacyVrcxAvailable: vi.fn(),
    appRequestLegacyMigration: vi.fn(),
    configGetInt: vi.fn(),
    configGetString: vi.fn(),
    configSetString: vi.fn(),
    configReload: vi.fn(),
    cleanLegendFromFriendLog: vi.fn(),
    fixGameLogTraveling: vi.fn(),
    fixNegativeGPS: vi.fn(),
    fixBrokenLeaveEntries: vi.fn(),
    fixBrokenGroupInvites: vi.fn(),
    fixBrokenNotifications: vi.fn(),
    fixBrokenGroupChange: vi.fn(),
    fixCancelFriendRequestTypo: vi.fn(),
    fixBrokenGameLogDisplayNames: vi.fn(),
    upgradeDatabaseVersion: vi.fn(),
    vacuum: vi.fn(),
    addV17PerformanceIndexes: vi.fn(),
    repairZeroCopresenceDurations: vi.fn(),
    optimize: vi.fn(),
    t: vi.fn(),
    showSQLiteErrorDialog: vi.fn(),
    alert: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        warning: mocks.toastWarning
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        sqliteGetFailedUpgrade: mocks.sqliteGetFailedUpgrade,
        sqliteBeginUpgrade: mocks.sqliteBeginUpgrade,
        sqliteCommitUpgrade: mocks.sqliteCommitUpgrade,
        sqliteFailUpgrade: mocks.sqliteFailUpgrade,
        appGetLegacyVrcxMigrationStatus: mocks.appGetLegacyVrcxMigrationStatus,
        appCheckLegacyVrcxAvailable: mocks.appCheckLegacyVrcxAvailable,
        appRequestLegacyMigration: mocks.appRequestLegacyMigration
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getInt: mocks.configGetInt,
        getString: mocks.configGetString,
        setString: mocks.configSetString,
        reload: mocks.configReload
    }
}));

vi.mock('@/repositories/databaseMaintenanceRepository', () => ({
    default: {
        cleanLegendFromFriendLog: mocks.cleanLegendFromFriendLog,
        fixGameLogTraveling: mocks.fixGameLogTraveling,
        fixNegativeGPS: mocks.fixNegativeGPS,
        fixBrokenLeaveEntries: mocks.fixBrokenLeaveEntries,
        fixBrokenGroupInvites: mocks.fixBrokenGroupInvites,
        fixBrokenNotifications: mocks.fixBrokenNotifications,
        fixBrokenGroupChange: mocks.fixBrokenGroupChange,
        fixCancelFriendRequestTypo: mocks.fixCancelFriendRequestTypo,
        fixBrokenGameLogDisplayNames: mocks.fixBrokenGameLogDisplayNames,
        upgradeDatabaseVersion: mocks.upgradeDatabaseVersion,
        vacuum: mocks.vacuum,
        addV17PerformanceIndexes: mocks.addV17PerformanceIndexes,
        repairZeroCopresenceDurations: mocks.repairZeroCopresenceDurations,
        optimize: mocks.optimize
    }
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: mocks.t
    }
}));

vi.mock('./sqliteErrorDialogService', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    confirmLegacyDatabaseMigration,
    initializeDatabaseUpgradeFlow,
    skipLegacyDatabaseMigration
} from './databaseUpgradeService';

function unavailableLegacyStatus() {
    return {
        detected: false,
        available: false
    };
}

describe('databaseUpgradeService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useModalStore.getState().resetModalState();
        useModalStore.setState({
            alert: mocks.alert
        });

        mocks.sqliteGetFailedUpgrade.mockResolvedValue(null);
        mocks.sqliteBeginUpgrade.mockResolvedValue(undefined);
        mocks.sqliteCommitUpgrade.mockResolvedValue(undefined);
        mocks.sqliteFailUpgrade.mockResolvedValue(undefined);
        mocks.appGetLegacyVrcxMigrationStatus.mockResolvedValue(
            unavailableLegacyStatus()
        );
        mocks.appCheckLegacyVrcxAvailable.mockResolvedValue(false);
        mocks.appRequestLegacyMigration.mockResolvedValue(false);
        mocks.configGetInt.mockResolvedValue(18);
        mocks.configGetString.mockResolvedValue('');
        mocks.configSetString.mockResolvedValue(undefined);
        mocks.configReload.mockResolvedValue(undefined);
        for (const task of [
            mocks.cleanLegendFromFriendLog,
            mocks.fixGameLogTraveling,
            mocks.fixNegativeGPS,
            mocks.fixBrokenLeaveEntries,
            mocks.fixBrokenGroupInvites,
            mocks.fixBrokenNotifications,
            mocks.fixBrokenGroupChange,
            mocks.fixCancelFriendRequestTypo,
            mocks.fixBrokenGameLogDisplayNames,
            mocks.upgradeDatabaseVersion,
            mocks.vacuum,
            mocks.addV17PerformanceIndexes,
            mocks.repairZeroCopresenceDurations,
            mocks.optimize
        ]) {
            task.mockResolvedValue(undefined);
        }
        mocks.t.mockImplementation(
            (key: string, params?: Record<string, unknown>) =>
                params ? `${key}:${JSON.stringify(params)}` : key
        );
        mocks.showSQLiteErrorDialog.mockResolvedValue(false);
        mocks.alert.mockResolvedValue({
            ok: true,
            reason: 'ok'
        });
    });

    it('blocks startup on a preserved failed upgrade before checking legacy migration', async () => {
        mocks.sqliteGetFailedUpgrade.mockResolvedValueOnce({
            workDbPath: 'C:/Temp/work.sqlite3',
            reason: 'disk full',
            fromVersion: 16,
            toVersion: 17
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            phase: 'error',
            fromVersion: 16,
            toVersion: 17,
            legacyMigrationAvailable: false
        });
        expect(mocks.alert).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'message.database.upgrade_failed_title',
                dismissible: false
            })
        );
        expect(useSessionStore.getState().databaseReady).toBe(false);
        expect(mocks.appGetLegacyVrcxMigrationStatus).not.toHaveBeenCalled();
    });

    it('opens the legacy migration confirmation when a supported legacy database is available', async () => {
        mocks.appGetLegacyVrcxMigrationStatus.mockResolvedValueOnce({
            detected: true,
            available: true
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'confirm-legacy-migration',
            legacyMigrationAvailable: true
        });
        expect(useSessionStore.getState().databaseReady).toBe(false);
        expect(mocks.sqliteBeginUpgrade).not.toHaveBeenCalled();
    });

    it('marks the database ready when the schema version is already current', async () => {
        mocks.configGetInt.mockResolvedValueOnce(18);

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: false,
            phase: 'completed',
            fromVersion: 18,
            toVersion: 18
        });
        expect(useSessionStore.getState().databaseReady).toBe(true);
        expect(mocks.sqliteBeginUpgrade).not.toHaveBeenCalled();
        expect(mocks.repairZeroCopresenceDurations).toHaveBeenCalledTimes(1);
        expect(mocks.configSetString).toHaveBeenCalledWith(
            'copresenceDurationRepairV1Done',
            '1'
        );
    });

    it('skips the co-presence duration repair when the marker is already set', async () => {
        mocks.configGetInt.mockResolvedValueOnce(18);
        mocks.configGetString.mockResolvedValueOnce('1');

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.repairZeroCopresenceDurations).not.toHaveBeenCalled();
    });

    it('runs the legacy maintenance sequence and commits a full upgrade from old schemas', async () => {
        mocks.configGetInt.mockResolvedValueOnce(15);

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.sqliteBeginUpgrade).toHaveBeenCalledWith(15, 18);
        expect(mocks.cleanLegendFromFriendLog).toHaveBeenCalledTimes(1);
        expect(mocks.fixBrokenGameLogDisplayNames).toHaveBeenCalledTimes(1);
        expect(mocks.vacuum).toHaveBeenCalledTimes(1);
        expect(mocks.addV17PerformanceIndexes).toHaveBeenCalledTimes(1);
        expect(mocks.repairZeroCopresenceDurations).toHaveBeenCalledTimes(1);
        expect(mocks.optimize).toHaveBeenCalledTimes(1);
        expect(mocks.configSetString).toHaveBeenCalledWith(
            'VRCX_0_databaseVersion',
            '18'
        );
        expect(mocks.configSetString).toHaveBeenCalledWith(
            'databaseVersion',
            '18'
        );
        expect(mocks.sqliteCommitUpgrade).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });

    it('preserves failed upgrade details when a started upgrade fails before commit', async () => {
        const failedUpgrade = {
            workDbPath: 'C:/Temp/work.sqlite3',
            reason: 'index failed',
            fromVersion: 16,
            toVersion: 17
        };
        mocks.configGetInt.mockResolvedValueOnce(16);
        mocks.sqliteGetFailedUpgrade
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(failedUpgrade);
        mocks.addV17PerformanceIndexes.mockRejectedValueOnce(
            new Error('index failed')
        );

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(mocks.sqliteFailUpgrade).toHaveBeenCalledWith('index failed');
        expect(mocks.showSQLiteErrorDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'index failed'
            })
        );
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            phase: 'error'
        });
        expect(mocks.alert).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'message.database.upgrade_failed_title',
                dismissible: false
            })
        );
        expect(useSessionStore.getState().databaseReady).toBe(false);
    });

    it('restores the confirm state when a legacy migration request does not restart', async () => {
        await confirmLegacyDatabaseMigration();

        expect(mocks.appRequestLegacyMigration).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'confirm-legacy-migration',
            detail: 'service.database_upgrade_service.error.legacy_migration_restart_failed'
        });
    });

    it('skips legacy migration and continues into the regular upgrade flow', async () => {
        mocks.configGetInt.mockResolvedValueOnce(17);

        await expect(skipLegacyDatabaseMigration()).resolves.toBe(true);

        expect(mocks.configGetInt).toHaveBeenCalledWith(
            'VRCX_0_databaseVersion',
            0
        );
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });
});
