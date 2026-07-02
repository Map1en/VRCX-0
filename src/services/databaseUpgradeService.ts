import { toast } from 'sonner';

import {
    commands,
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

const LEGACY_SCHEMA_VERSION = 16;
const DATABASE_VERSION = 18;
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

async function blockOnFailedUpgrade(
    failedUpgrade: DatabaseUpgradeStatus | null | undefined
): Promise<boolean> {
    setUpgradeState({
        open: false,
        phase: 'error',
        fromVersion: failedUpgrade?.fromVersion ?? 0,
        toVersion: failedUpgrade?.toVersion ?? DATABASE_VERSION,
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

async function writeUpgradeDatabaseVersion(): Promise<void> {
    await configRepository.setString(
        VRCX0_SCHEMA_VERSION_KEY,
        String(DATABASE_VERSION)
    );
    await configRepository.setString(
        'databaseVersion',
        String(DATABASE_VERSION)
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

async function runFullDatabaseUpgrade(): Promise<boolean> {
    let upgradeStarted = false;
    let upgradeCommitted = false;
    try {
        const failedUpgrade = await commands.sqliteGetFailedUpgrade();
        if (failedUpgrade) {
            return blockOnFailedUpgrade(failedUpgrade);
        }

        const currentVersion = await configRepository.getInt(
            VRCX0_SCHEMA_VERSION_KEY,
            0
        );

        if (currentVersion >= DATABASE_VERSION) {
            setUpgradeState({
                open: false,
                phase: 'completed',
                fromVersion: currentVersion,
                toVersion: DATABASE_VERSION,
                detail: i18n.t(
                    'service.database_upgrade_service.label.database_schema_is_current'
                ),
                legacyMigrationAvailable: false
            });
            await runCopresenceDurationRepairOnce();
            useSessionStore.getState().setSessionState({ databaseReady: true });
            return true;
        }

        setUpgradeState({
            open: currentVersion > 0,
            phase: 'running',
            fromVersion: currentVersion,
            toVersion: DATABASE_VERSION,
            detail: i18n.t(
                'service.database_upgrade_service.dynamic.updating_database_from_value_to_value',
                { value: currentVersion, value2: DATABASE_VERSION }
            ),
            legacyMigrationAvailable: false
        });

        await commands.sqliteBeginUpgrade(currentVersion, DATABASE_VERSION);
        upgradeStarted = true;

        if (currentVersion < LEGACY_SCHEMA_VERSION) {
            await runLegacyDatabaseMaintenance();
        }
        if (currentVersion < DATABASE_VERSION) {
            await databaseMaintenanceRepository.addV17PerformanceIndexes();
        }
        await databaseMaintenanceRepository.optimize();
        await writeUpgradeDatabaseVersion();
        await commands.sqliteCommitUpgrade();
        upgradeCommitted = true;
        await configRepository.reload();

        setUpgradeState({
            open: false,
            phase: 'completed',
            fromVersion: currentVersion,
            toVersion: DATABASE_VERSION,
            detail: i18n.t(
                'service.database_upgrade_service.success.database_update_complete'
            )
        });
        await runCopresenceDurationRepairOnce();
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
    const failedUpgrade = await commands.sqliteGetFailedUpgrade();
    if (failedUpgrade) {
        return blockOnFailedUpgrade(failedUpgrade);
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

    return runFullDatabaseUpgrade();
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
