import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastWarning: vi.fn(),
    toastError: vi.fn(),
    appDatabaseUpgradePreflight: vi.fn(),
    appDatabaseUpgradeProgress: vi.fn(),
    appDatabaseUpgradeRun: vi.fn(),
    appDatabaseUpgradeRetry: vi.fn(),
    appDatabaseUpgradeFailureLogPath: vi.fn(),
    appDatabaseUpgradeStartFresh: vi.fn(),
    appGetLegacyVrcxMigrationStatus: vi.fn(),
    appBootstrapStatusGet: vi.fn(),
    appRequestLegacyMigration: vi.fn(),
    configReload: vi.fn(),
    confirmLegacyVrcxProcessState: vi.fn(),
    confirm: vi.fn(),
    t: vi.fn(),
    showSQLiteErrorDialog: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'warning':
                    return mocks.toastWarning(options);
                case 'error':
                    return mocks.toastError(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appDatabaseUpgradePreflight: mocks.appDatabaseUpgradePreflight,
        appDatabaseUpgradeProgress: mocks.appDatabaseUpgradeProgress,
        appDatabaseUpgradeRun: mocks.appDatabaseUpgradeRun,
        appDatabaseUpgradeRetry: mocks.appDatabaseUpgradeRetry,
        appDatabaseUpgradeFailureLogPath:
            mocks.appDatabaseUpgradeFailureLogPath,
        appDatabaseUpgradeStartFresh: mocks.appDatabaseUpgradeStartFresh,
        appGetLegacyVrcxMigrationStatus: mocks.appGetLegacyVrcxMigrationStatus,
        appBootstrapStatusGet: mocks.appBootstrapStatusGet,
        appRequestLegacyMigration: mocks.appRequestLegacyMigration
    }
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/services/legacyVrcxMigrationService', () => ({
    confirmLegacyVrcxProcessState: mocks.confirmLegacyVrcxProcessState
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: {
        getState: () => ({
            alert: vi.fn(),
            confirm: mocks.confirm
        })
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

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    confirmLegacyDatabaseMigration,
    initializeDatabaseUpgradeFlow,
    retryDatabaseUpgrade,
    startFreshDatabaseAfterUpgradeFailure,
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
        toVersion,
        repairPending: false
    };
}

describe('databaseUpgradeService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        mocks.appDatabaseUpgradePreflight.mockResolvedValue(
            preflight('current')
        );
        mocks.appDatabaseUpgradeProgress.mockResolvedValue({
            stage: 'preflight'
        });
        mocks.appDatabaseUpgradeRun.mockResolvedValue({
            status: 'current',
            fromVersion: 18,
            toVersion: 18
        });
        mocks.appDatabaseUpgradeRetry.mockResolvedValue({
            status: 'current',
            fromVersion: 18,
            toVersion: 18
        });
        mocks.appDatabaseUpgradeFailureLogPath.mockResolvedValue(
            'C:/VRCX-0/error-log.txt'
        );
        mocks.appDatabaseUpgradeStartFresh.mockResolvedValue(
            'C:/VRCX-0/database-upgrade-recovery/backup'
        );
        mocks.appGetLegacyVrcxMigrationStatus.mockResolvedValue(
            unavailableLegacyStatus()
        );
        mocks.appBootstrapStatusGet.mockResolvedValue({ isRemote: false });
        mocks.appRequestLegacyMigration.mockResolvedValue(false);
        mocks.confirmLegacyVrcxProcessState.mockResolvedValue(false);
        mocks.configReload.mockResolvedValue(undefined);
        mocks.confirm.mockResolvedValue({ ok: true, reason: 'confirmed' });
        mocks.t.mockImplementation(
            (key: string, params?: Record<string, unknown>) =>
                params ? `${key}:${JSON.stringify(params)}` : key
        );
        mocks.showSQLiteErrorDialog.mockResolvedValue(false);
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
            open: true,
            phase: 'error',
            fromVersion: 16,
            toVersion: 18,
            legacyMigrationAvailable: false,
            retryable: true,
            freshStartAvailable: true,
            failureLogPath: 'C:/VRCX-0/error-log.txt',
            failedWorkDbPath: 'C:/Temp/work.sqlite3'
        });
        expect(useSessionStore.getState().databaseReady).toBe(false);
        expect(mocks.appGetLegacyVrcxMigrationStatus).not.toHaveBeenCalled();
        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
    });

    it('queues the legacy migration confirmation after completing the database upgrade', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 0, 18)
        );
        mocks.appGetLegacyVrcxMigrationStatus.mockResolvedValueOnce({
            detected: true,
            available: true
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: false,
            phase: 'confirm-legacy-migration',
            fromVersion: 0,
            toVersion: 18,
            legacyMigrationAvailable: true
        });
        expect(useSessionStore.getState().databaseReady).toBe(true);
        expect(mocks.appDatabaseUpgradeRun).toHaveBeenCalledOnce();
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

    it('shows progress when a current database still has a one-time repair to run', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce({
            ...preflight('current'),
            repairPending: true
        });
        let finishRepair: ((value: unknown) => void) | undefined;
        mocks.appDatabaseUpgradeRun.mockReturnValueOnce(
            new Promise((resolve) => {
                finishRepair = resolve;
            })
        );

        const upgrade = initializeDatabaseUpgradeFlow();
        await vi.waitFor(() => {
            expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
                open: true,
                phase: 'running'
            });
        });
        finishRepair?.({
            status: 'current',
            fromVersion: 18,
            toVersion: 18
        });

        await expect(upgrade).resolves.toBe(true);
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });

    it('shows progress while initializing a new empty database', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 0, 18)
        );
        let finishUpgrade: ((value: unknown) => void) | undefined;
        mocks.appDatabaseUpgradeRun.mockReturnValueOnce(
            new Promise((resolve) => {
                finishUpgrade = resolve;
            })
        );

        const upgrade = initializeDatabaseUpgradeFlow();
        await vi.waitFor(() => {
            expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
                open: true,
                phase: 'running',
                fromVersion: 0,
                toVersion: 18
            });
        });
        finishUpgrade?.({
            status: 'upgraded',
            fromVersion: 0,
            toVersion: 18
        });

        await expect(upgrade).resolves.toBe(true);
    });

    it('joins an upgrade already running and checks for legacy data after it completes', async () => {
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

        expect(mocks.appGetLegacyVrcxMigrationStatus).toHaveBeenCalledOnce();
        expect(mocks.appDatabaseUpgradeRun).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
    });

    it('hydrates a finished upgrade and checks for a deferred legacy import', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce({
            ...preflight('finished', 17, 18),
            result: {
                status: 'upgraded',
                fromVersion: 17,
                toVersion: 18
            }
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);

        expect(mocks.appGetLegacyVrcxMigrationStatus).toHaveBeenCalledOnce();
        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
    });

    it('propagates preflight infrastructure failures to startup', async () => {
        const error = new Error('status journal is unreadable');
        mocks.appDatabaseUpgradePreflight.mockRejectedValueOnce(error);

        await expect(initializeDatabaseUpgradeFlow()).rejects.toBe(error);

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

    it('publishes determinate work-copy progress while the backend command is running', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 16, 18)
        );
        mocks.appDatabaseUpgradeProgress.mockResolvedValue({
            stage: 'createWorkCopy',
            completedUnits: 25,
            totalUnits: 100
        });
        let finishUpgrade: ((value: unknown) => void) | undefined;
        mocks.appDatabaseUpgradeRun.mockReturnValueOnce(
            new Promise((resolve) => {
                finishUpgrade = resolve;
            })
        );

        const upgrade = initializeDatabaseUpgradeFlow();
        await vi.waitFor(() => {
            expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
                phase: 'running',
                stage: 'createWorkCopy',
                progressCompleted: 25,
                progressTotal: 100
            });
        });
        finishUpgrade?.({
            status: 'upgraded',
            fromVersion: 16,
            toVersion: 18
        });

        await expect(upgrade).resolves.toBe(true);
    });

    it('never opens the dialog for an upgrade that finishes before the open delay', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 16, 18)
        );
        mocks.appDatabaseUpgradeRun.mockResolvedValueOnce({
            status: 'upgraded',
            fromVersion: 16,
            toVersion: 18
        });
        const openStates: boolean[] = [];
        const unsubscribe = useRuntimeStore.subscribe((state) => {
            openStates.push(state.databaseUpgrade.open);
        });

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(true);
        unsubscribe();

        expect(openStates).not.toContain(true);
        expect(useRuntimeStore.getState().databaseUpgrade.open).toBe(false);
    });

    it('shows the preserved work-copy details returned by a failed backend run', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('upgradeRequired', 17, 18)
        );
        mocks.appDatabaseUpgradeRun.mockResolvedValueOnce({
            status: 'failed',
            fromVersion: 17,
            toVersion: 18,
            failedStage: 'globalPerformanceIndexes',
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
            open: true,
            phase: 'error',
            fromVersion: 17,
            toVersion: 18,
            retryable: true,
            freshStartAvailable: true,
            failureLogPath: 'C:/VRCX-0/error-log.txt',
            failedWorkDbPath: 'C:/Temp/work.sqlite3'
        });
        expect(useSessionStore.getState().databaseReady).toBe(false);
    });

    it('retries a failed upgrade without rebuilding the frontend or process', async () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'error',
            fromVersion: 17,
            toVersion: 18,
            retryable: true
        });
        mocks.appDatabaseUpgradeRetry.mockResolvedValueOnce({
            status: 'upgraded',
            fromVersion: 17,
            toVersion: 18
        });
        await expect(retryDatabaseUpgrade()).resolves.toBe(true);

        expect(mocks.appDatabaseUpgradeRetry).toHaveBeenCalledTimes(1);
        expect(mocks.configReload).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: false,
            phase: 'completed',
            retryable: false
        });
        expect(useSessionStore.getState().databaseReady).toBe(true);
    });

    it('blocks a database created by a newer application before mutation', async () => {
        mocks.appDatabaseUpgradePreflight.mockResolvedValueOnce(
            preflight('newerSchema', 19, 18)
        );

        await expect(initializeDatabaseUpgradeFlow()).resolves.toBe(false);

        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'error',
            fromVersion: 19,
            toVersion: 18,
            retryable: false,
            freshStartAvailable: true,
            detail: 'service.database_upgrade_service.error.newer_schema_requires_newer_app:{"value":19,"value2":18}'
        });
    });

    it('archives a failed database and requests a fresh-start restart after confirmation', async () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'error',
            freshStartAvailable: true,
            retryable: true
        });

        await expect(startFreshDatabaseAfterUpgradeFailure()).resolves.toBe(
            true
        );

        expect(mocks.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ destructive: true })
        );
        expect(mocks.appDatabaseUpgradeStartFresh).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'restarting',
            freshStartAvailable: false,
            retryable: false
        });
    });

    it('restores the confirm state when a legacy migration request does not restart', async () => {
        await confirmLegacyDatabaseMigration();

        expect(mocks.appRequestLegacyMigration).toHaveBeenCalledWith(false);
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'confirm-legacy-migration',
            detail: 'service.database_upgrade_service.error.legacy_migration_restart_failed'
        });
    });

    it('closes a remote migration prompt while signed out and preserves it for next login', async () => {
        mocks.appBootstrapStatusGet.mockResolvedValueOnce({ isRemote: true });
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            legacyMigrationAvailable: true
        });

        await confirmLegacyDatabaseMigration();

        expect(mocks.confirmLegacyVrcxProcessState).not.toHaveBeenCalled();
        expect(mocks.appRequestLegacyMigration).not.toHaveBeenCalled();
        expect(mocks.toastWarning).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'view.login.legacy_import_sign_in_required'
            })
        );
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: false,
            phase: 'confirm-legacy-migration',
            legacyMigrationAvailable: true
        });
    });

    it('fails closed when storage mode cannot be checked before remote migration', async () => {
        mocks.appBootstrapStatusGet.mockRejectedValueOnce(
            new Error('storage unavailable')
        );

        await confirmLegacyDatabaseMigration();

        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'view.login.legacy_import_storage_unavailable'
            })
        );
        expect(mocks.confirmLegacyVrcxProcessState).not.toHaveBeenCalled();
        expect(mocks.appRequestLegacyMigration).not.toHaveBeenCalled();
    });

    it('passes the force choice to the guarded migration request', async () => {
        mocks.confirmLegacyVrcxProcessState.mockResolvedValueOnce(true);

        await confirmLegacyDatabaseMigration();

        expect(mocks.appRequestLegacyMigration).toHaveBeenCalledWith(true);
    });

    it('keeps migration recovery actions and exposes the failure log when snapshot preparation fails', async () => {
        mocks.appRequestLegacyMigration.mockRejectedValueOnce(
            new Error('snapshot copy failed')
        );

        await confirmLegacyDatabaseMigration();

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'confirm-legacy-migration',
            failureLogPath: 'C:/VRCX-0/error-log.txt',
            detail: 'service.database_upgrade_service.error.legacy_migration_restart_failed snapshot copy failed'
        });
    });

    it('skips legacy migration without rerunning the database upgrade', async () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: 16,
            toVersion: 18
        });
        useSessionStore.getState().setSessionState({ databaseReady: true });
        await expect(skipLegacyDatabaseMigration()).resolves.toBe(true);

        expect(mocks.appDatabaseUpgradeRun).not.toHaveBeenCalled();
        expect(mocks.configReload).not.toHaveBeenCalled();
        expect(useSessionStore.getState().databaseReady).toBe(true);
        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: false,
            phase: 'completed',
            legacyMigrationAvailable: false
        });
    });
});
