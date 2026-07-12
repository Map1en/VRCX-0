import { toast } from 'sonner';

import {
    commands,
    type DatabaseSchemaInfo,
    type DatabaseUpgradeStatus,
    type LegacyVrcxMigrationStatus
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import databaseMaintenanceRepository from '@/repositories/databaseMaintenanceRepository';
import i18n from '@/services/i18nService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { showSQLiteErrorDialog } from './sqliteErrorDialogService';

const COPRESENCE_DURATION_REPAIR_KEY = 'copresenceDurationRepairV1Done';
const VRCX0_SCHEMA_VERSION_KEY = 'VRCX_0_databaseVersion';

type DatabaseUpgradePatch = Record<string, unknown>;

function setUpgradeState(patch: DatabaseUpgradePatch): void {
    useRuntimeStore.getState().setDatabaseUpgradeState(patch);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function failedUpgradeDescription(
    failedUpgrade: DatabaseUpgradeStatus | null | undefined
): string {
    const workDbPath =
        failedUpgrade?.workDbPath ||
        i18n.t('service.database_upgrade_service.label.unknown_path');
    if (failedUpgrade?.reason) {
        return i18n.t(
            'service.database_upgrade_service.error.failed_upgrade_description_with_reason',
            {
                path: workDbPath,
                reason: String(failedUpgrade.reason)
            }
        );
    }
    return i18n.t(
        'service.database_upgrade_service.error.failed_upgrade_description',
        { path: workDbPath }
    );
}

async function rollbackCloudRestoreAfterDatabaseFailure(): Promise<boolean> {
    try {
        const requested = await commands.appCloudBackupRestoreRollback();
        if (!requested) {
            return false;
        }
        setUpgradeState({
            open: true,
            phase: 'restarting',
            detail: i18n.t(
                'service.database_upgrade_service.action.rolling_back_cloud_restore'
            ),
            legacyMigrationAvailable: false
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return true;
    } catch (error) {
        console.warn('Automatic cloud restore rollback request failed:', error);
        return false;
    }
}

async function blockOnFailedUpgrade(
    failedUpgrade: DatabaseUpgradeStatus | null | undefined,
    databaseVersion: number
): Promise<boolean> {
    if (await rollbackCloudRestoreAfterDatabaseFailure()) {
        return false;
    }
    setUpgradeState({
        open: false,
        phase: 'error',
        fromVersion: failedUpgrade?.fromVersion ?? 0,
        toVersion: failedUpgrade?.toVersion ?? databaseVersion,
        detail: failedUpgradeDescription(failedUpgrade),
        legacyMigrationAvailable: false
    });

    await useModalStore.getState().alert({
        title: i18n.t('message.database.upgrade_failed_title'),
        description: failedUpgradeDescription(failedUpgrade),
        dismissible: false
    });
    useSessionStore.getState().setSessionState({ databaseReady: false });
    return false;
}

async function runCopresenceDurationRepairOnce(): Promise<void> {
    try {
        const done = await configRepository.getString(
            COPRESENCE_DURATION_REPAIR_KEY,
            ''
        );
        if (done === '1') {
            return;
        }
        await databaseMaintenanceRepository.repairZeroCopresenceDurations();
        await configRepository.setString(COPRESENCE_DURATION_REPAIR_KEY, '1');
    } catch (error) {
        console.error('Co-presence duration repair failed:', error);
    }
}

async function writeUpgradeDatabaseVersion(
    databaseVersion: number
): Promise<void> {
    await configRepository.setString(
        VRCX0_SCHEMA_VERSION_KEY,
        String(databaseVersion)
    );
    await configRepository.setString(
        'databaseVersion',
        String(databaseVersion)
    );
}

async function runLegacyDatabaseMaintenance(): Promise<void> {
    await databaseMaintenanceRepository.cleanLegendFromFriendLog();
    await databaseMaintenanceRepository.fixGameLogTraveling();
    await databaseMaintenanceRepository.fixNegativeGPS();
    await databaseMaintenanceRepository.fixBrokenLeaveEntries();
    await databaseMaintenanceRepository.fixBrokenGroupInvites();
    await databaseMaintenanceRepository.fixBrokenNotifications();
    await databaseMaintenanceRepository.fixBrokenGroupChange();
    await databaseMaintenanceRepository.fixCancelFriendRequestTypo();
    await databaseMaintenanceRepository.fixBrokenGameLogDisplayNames();
    await databaseMaintenanceRepository.upgradeDatabaseVersion();
    await databaseMaintenanceRepository.vacuum();
}

async function finalizeCloudRestore(): Promise<void> {
    try {
        await commands.appCloudBackupRestoreFinalize();
    } catch (error) {
        console.warn('Cloud restore cleanup failed:', error);
    }
}

async function rejectFutureSchema(
    currentVersion: number,
    databaseVersion: number
): Promise<boolean> {
    const description = i18n.t(
        'service.database_upgrade_service.error.future_schema',
        {
            current: currentVersion,
            supported: databaseVersion
        }
    );
    setUpgradeState({
        open: false,
        phase: 'error',
        fromVersion: currentVersion,
        toVersion: databaseVersion,
        detail: description,
        legacyMigrationAvailable: false
    });
    await useModalStore.getState().alert({
        title: i18n.t('message.database.upgrade_failed_title'),
        description,
        dismissible: false
    });
    useSessionStore.getState().setSessionState({ databaseReady: false });
    return false;
}

async function runFullDatabaseUpgrade(
    providedSchemaInfo?: DatabaseSchemaInfo
): Promise<boolean> {
    let upgradeStarted = false;
    let upgradeCommitted = false;
    try {
        const schemaInfo =
            providedSchemaInfo ?? (await commands.sqliteSchemaInfo());
        const databaseVersion = schemaInfo.currentVersion;
        const legacySchemaVersion = schemaInfo.legacyVersion;
        const failedUpgrade = await commands.sqliteGetFailedUpgrade();
        if (failedUpgrade) {
            return blockOnFailedUpgrade(failedUpgrade, databaseVersion);
        }

        const currentVersion = await configRepository.getInt(
            VRCX0_SCHEMA_VERSION_KEY,
            0
        );

        if (currentVersion > databaseVersion) {
            return rejectFutureSchema(currentVersion, databaseVersion);
        }

        if (currentVersion === databaseVersion) {
            setUpgradeState({
                open: false,
                phase: 'completed',
                fromVersion: currentVersion,
                toVersion: databaseVersion,
                detail: i18n.t(
                    'service.database_upgrade_service.label.database_schema_is_current'
                ),
                legacyMigrationAvailable: false
            });
            await runCopresenceDurationRepairOnce();
            await finalizeCloudRestore();
            useSessionStore.getState().setSessionState({ databaseReady: true });
            return true;
        }

        setUpgradeState({
            open: currentVersion > 0,
            phase: 'running',
            fromVersion: currentVersion,
            toVersion: databaseVersion,
            detail: i18n.t(
                'service.database_upgrade_service.dynamic.updating_database_from_value_to_value',
                { value: currentVersion, value2: databaseVersion }
            ),
            legacyMigrationAvailable: false
        });

        await commands.sqliteBeginUpgrade(currentVersion, databaseVersion);
        upgradeStarted = true;

        if (currentVersion < legacySchemaVersion) {
            await runLegacyDatabaseMaintenance();
        }
        if (currentVersion < databaseVersion) {
            await databaseMaintenanceRepository.addV17PerformanceIndexes();
        }
        await databaseMaintenanceRepository.optimize();
        await writeUpgradeDatabaseVersion(databaseVersion);
        await commands.sqliteCommitUpgrade();
        upgradeCommitted = true;
        await configRepository.reload();

        setUpgradeState({
            open: false,
            phase: 'completed',
            fromVersion: currentVersion,
            toVersion: databaseVersion,
            detail: i18n.t(
                'service.database_upgrade_service.success.database_update_complete'
            )
        });
        await runCopresenceDurationRepairOnce();
        await finalizeCloudRestore();
        useSessionStore.getState().setSessionState({ databaseReady: true });
        return true;
    } catch (error) {
        console.error('Database upgrade failed:', error);
        const reason = errorMessage(error);
        let failedUpgrade: DatabaseUpgradeStatus | null = null;
        if (upgradeStarted && !upgradeCommitted) {
            try {
                await commands.sqliteFailUpgrade(reason);
                failedUpgrade = await commands.sqliteGetFailedUpgrade();
            } catch (failError) {
                console.error(
                    'Failed to preserve database upgrade work copy:',
                    failError
                );
            }
        }
        if (await rollbackCloudRestoreAfterDatabaseFailure()) {
            return false;
        }
        await showSQLiteErrorDialog(error);

        let description = i18n.t(
            'service.database_upgrade_service.error.apply_upgrade_failed'
        );
        if (upgradeCommitted) {
            description = i18n.t(
                'service.database_upgrade_service.action.refresh_config_failed_after_upgrade'
            );
        } else if (failedUpgrade) {
            description = failedUpgradeDescription(failedUpgrade);
        }
        setUpgradeState({
            open: false,
            phase: 'error',
            detail: description
        });
        await useModalStore.getState().alert({
            title: i18n.t('message.database.upgrade_failed_title'),
            description,
            dismissible: false
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }
}

async function getLegacyMigrationStatus(): Promise<LegacyVrcxMigrationStatus> {
    try {
        return commands.appGetLegacyVrcxMigrationStatus();
    } catch (error) {
        console.warn('Legacy VRCX migration status check failed:', error);
    }

    try {
        const available = Boolean(await commands.appCheckLegacyVrcxAvailable());
        return {
            detected: available,
            available
        };
    } catch (error) {
        console.warn('Legacy VRCX availability check failed:', error);
        return {
            detected: false,
            available: false
        };
    }
}

export async function initializeDatabaseUpgradeFlow(): Promise<boolean> {
    const schemaInfo = await commands.sqliteSchemaInfo();
    const failedUpgrade = await commands.sqliteGetFailedUpgrade();
    if (failedUpgrade) {
        return blockOnFailedUpgrade(failedUpgrade, schemaInfo.currentVersion);
    }

    const legacyMigrationStatus = await getLegacyMigrationStatus();

    if (legacyMigrationStatus.available) {
        setUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: 0,
            toVersion: 0,
            detail: i18n.t('message.database.migration_found_description'),
            legacyMigrationAvailable: true
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }

    if (legacyMigrationStatus.detected && legacyMigrationStatus.reason) {
        toast.warning(legacyMigrationStatus.reason);
    }

    return runFullDatabaseUpgrade(schemaInfo);
}

export async function confirmLegacyDatabaseMigration(): Promise<void> {
    setUpgradeState({
        open: true,
        phase: 'restarting',
        detail: i18n.t(
            'service.database_upgrade_service.action.requesting_legacy_migration'
        )
    });

    try {
        const willRestart = await commands.appRequestLegacyMigration();
        if (willRestart) {
            return;
        }
    } catch (error) {
        console.error('Legacy migration request failed:', error);
    }

    setUpgradeState({
        open: true,
        phase: 'confirm-legacy-migration',
        detail: i18n.t(
            'service.database_upgrade_service.error.legacy_migration_restart_failed'
        )
    });
}

export async function skipLegacyDatabaseMigration(): Promise<boolean> {
    setUpgradeState({
        open: false,
        phase: 'running',
        detail: i18n.t(
            'service.database_upgrade_service.action.skipping_legacy_migration'
        ),
        legacyMigrationAvailable: false
    });
    return runFullDatabaseUpgrade();
}
