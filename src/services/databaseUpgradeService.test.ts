import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastWarning: vi.fn(),
    appDatabaseUpgradePreflight: vi.fn(),
    appDatabaseUpgradeRun: vi.fn(),
    appGetLegacyVrcxMigrationStatus: vi.fn(),
    appCheckLegacyVrcxAvailable: vi.fn(),
    appRequestLegacyMigration: vi.fn(),
    configReload: vi.fn(),
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
        appDatabaseUpgradePreflight: mocks.appDatabaseUpgradePreflight,
        appDatabaseUpgradeRun: mocks.appDatabaseUpgradeRun,
        appGetLegacyVrcxMigrationStatus: mocks.appGetLegacyVrcxMigrationStatus,
        appCheckLegacyVrcxAvailable: mocks.appCheckLegacyVrcxAvailable,
        appRequestLegacyMigration: mocks.appRequestLegacyMigration
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        reload: mocks.configReload
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

function preflight(
    status:
        | 'current'
        | 'upgradeRequired'
        | 'running'
        | 'finished'
        | 'blocked'
        | 'newerSchema',
    fromVersion = 18,
    toVersion = 18
) {
    return {
        status,
        fromVersion,
        toVersion
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

        mocks.appDatabaseUpgradePreflight.mockResolvedValue(
            preflight('current')
        );
        mocks.appDatabaseUpgradeRun.mockResolvedValue({
            status: 'current',
            fromVersion: 18,
            toVersion: 18
        });
        mocks.appGetLegacyVrcxMigrationStatus.mockResolvedValue(
            unavailableLegacyStatus()
        );
        mocks.appCheckLegacyVrcxAvailable.mockResolvedValue(false);
        mocks.appRequestLegacyMigration.mockResolvedValue(false);
        mocks.configReload.mockResolvedValue(undefined);
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
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce({
            ...preflight('blocked', 16, 18),
            failedUpgrade: {
                workDbPath: 'C:/Temp/work.sqlite3',
                reason: 'disk full',
                fromVersion: 16,
                toVersion: 18
            }
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            phase: 'error',
            fromVersion: 16,
            toVersion: 18,
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
        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
    });

    it('opens the legacy migration confirmation after backend preflight', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 0, 18)
        );
        mocks.appGetLegacyVrcxMigrationStatus.mockResolvedValueOnce({
            detected: true,
            available: true
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: 0,
            toVersion: 18,
            legacyMigrationAvailable: true
        });
        expect(useSessionStore.getState().databaseReady).toBe(false);
        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
    });

    it('marks an already current database ready from the backend result', async () => {
        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.appDatabaseUpgradeRun).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: false,
            phase: 'completed',
            fromVersion: 18,
            toVersion: 18
        });
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });

    it('joins an upgrade already running after the frontend is rebuilt', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce({
            ...preflight('running', 17, 18),
            stage: 'optimize'
        });
        mocks.appDatabaseUpgradeRun.mockResolvedValueOnce({
            status: 'upgraded',
            fromVersion: 17,
            toVersion: 18
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.appGetLegacyVrcxMigrationStatus).not.toHaveBeenCalled();
        expect(mocks.appDatabaseUpgradeRun).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
    });

    it('hydrates a finished upgrade without starting or prompting again', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce({
            ...preflight('finished', 17, 18),
            result: {
                status: 'upgraded',
                fromVersion: 17,
                toVersion: 18
            }
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.appGetLegacyVrcxMigrationStatus).not.toHaveBeenCalled();
        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
    });

    it('propagates preflight infrastructure failures to startup', async () => {
        const error = new Error('status journal is unreadable');
        mocks.appDatabaseUpgradePreflight.mockRejectedValueOnce(error);

        await expect(initializeDatabaseUpgradeFlow()).rejects.toBe(error);

        expect(mocks.alert).not.toHaveBeenCalled();
        expect(mocks.showSQLiteErrorDialog).not.toHaveBeenCalled();
        expect(mocks.appGetLegacyVrcxMigrationStatus).not.toHaveBeenCalled();
        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
    });

    it('delegates the entire old-schema upgrade to one backend command', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 15, 18)
        );
        mocks.appDatabaseUpgradeRun.mockResolvedValueOnce({
            status: 'upgraded',
            fromVersion: 15,
            toVersion: 18
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.appDatabaseUpgradeRun).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            phase: 'completed',
            fromVersion: 15,
            toVersion: 18
        });
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });

    it('shows the preserved work-copy details returned by a failed backend run', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 17, 18)
        );
        mocks.appDatabaseUpgradeRun.mockResolvedValueOnce({
            status: 'failed',
            fromVersion: 17,
            toVersion: 18,
            failedStage: 'performanceIndexes',
            error: 'index failed',
            failedUpgrade: {
                workDbPath: 'C:/Temp/work.sqlite3',
                reason: 'index failed',
                fromVersion: 17,
                toVersion: 18
            }
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(mocks.showSQLiteErrorDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'index failed'
            })
        );
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            phase: 'error',
            fromVersion: 17,
            toVersion: 18
        });
        expect(mocks.alert).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'message.database.upgrade_failed_title',
                dismissible: false
            })
        );
        expect(useSessionStore.getState().databaseReady).toBe(false);
    });

    it('blocks a database created by a newer application before mutation', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('newerSchema', 19, 18)
        );

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            phase: 'error',
            fromVersion: 19,
            toVersion: 18
        });
        expect(mocks.alert).toHaveBeenCalledWith(
            expect.objectContaining({
                description:
                    'service.database_upgrade_service.error.newer_schema_requires_newer_app:{"value":19,"value2":18}'
            })
        );
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

    it('skips legacy migration and invokes only the backend orchestration', async () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: 16,
            toVersion: 18
        });
        mocks.appDatabaseUpgradeRun.mockImplementationOnce(async () => {
            expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
                open: true,
                phase: 'running',
                fromVersion: 16,
                toVersion: 18
            });
            return {
                status: 'upgraded',
                fromVersion: 16,
                toVersion: 18
            };
        });

        await expect(skipLegacyDatabaseMigration()).resolves.toBe(true);

        expect(mocks.appDatabaseUpgradeRun).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });
});
