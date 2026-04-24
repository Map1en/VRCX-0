import { backend } from '@/platform/index.js';
import {
    configRepository,
    databaseMaintenanceRepository
} from '@/repositories/index.js';
import sqliteRepository from '@/repositories/sqliteRepository.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import i18n from '@/services/i18nService.js';

import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';

const DATABASE_VERSION = 16;

function setUpgradeState(patch) {
    useRuntimeStore.getState().setDatabaseUpgradeState(patch);
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function failedUpgradeDescription(failedUpgrade) {
    const workDbPath =
        failedUpgrade?.workDbPath ||
        i18n.t('service.database_upgrade_service.generated.unknown_path');
    if (failedUpgrade?.reason) {
        return i18n.t(
            'service.database_upgrade_service.generated.failed_upgrade_description_with_reason',
            {
                path: workDbPath,
                reason: failedUpgrade.reason
            }
        );
    }
    return i18n.t(
        'service.database_upgrade_service.generated.failed_upgrade_description',
        { path: workDbPath }
    );
}

async function blockOnFailedUpgrade(failedUpgrade) {
    setUpgradeState({
        open: false,
        phase: 'error',
        fromVersion: failedUpgrade?.fromVersion ?? 0,
        toVersion: failedUpgrade?.toVersion ?? DATABASE_VERSION,
        detail: failedUpgradeDescription(failedUpgrade),
        legacyMigrationAvailable: false
    });

    await useModalStore.getState().alert({
        title: i18n.t(
            'service.database_upgrade_service.generated.database_upgrade_failed'
        ),
        description: failedUpgradeDescription(failedUpgrade),
        dismissible: false
    });
    useSessionStore.getState().setSessionState({ databaseReady: false });
    return false;
}

async function writeUpgradeDatabaseVersion() {
    await sqliteRepository.executeNonQuery(
        'INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)',
        {
            '@key': 'config:vrcx_databaseversion',
            '@value': String(DATABASE_VERSION)
        }
    );
}

async function runFullDatabaseUpgrade() {
    let upgradeStarted = false;
    let upgradeCommitted = false;
    try {
        const failedUpgrade = await backend.sqlite.GetFailedUpgrade();
        if (failedUpgrade) {
            return blockOnFailedUpgrade(failedUpgrade);
        }

        const currentVersion = await configRepository.getInt(
            'databaseVersion',
            0
        );

        if (currentVersion >= DATABASE_VERSION) {
            setUpgradeState({
                open: false,
                phase: 'completed',
                fromVersion: currentVersion,
                toVersion: DATABASE_VERSION,
                detail: i18n.t(
                    'service.database_upgrade_service.generated.database_schema_is_current'
                ),
                legacyMigrationAvailable: false
            });
            useSessionStore.getState().setSessionState({ databaseReady: true });
            return true;
        }

        setUpgradeState({
            open: currentVersion > 0,
            phase: 'running',
            fromVersion: currentVersion,
            toVersion: DATABASE_VERSION,
            detail: i18n.t('service.database_upgrade_service.generated_dynamic.updating_database_from_value_to_value', { value: currentVersion, value2: DATABASE_VERSION }),
            legacyMigrationAvailable: false
        });

        await backend.sqlite.BeginUpgrade(currentVersion, DATABASE_VERSION);
        upgradeStarted = true;

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
        await databaseMaintenanceRepository.optimize();
        await writeUpgradeDatabaseVersion();
        await backend.sqlite.CommitUpgrade();
        upgradeCommitted = true;
        await configRepository.reload();

        setUpgradeState({
            open: false,
            phase: 'completed',
            fromVersion: currentVersion,
            toVersion: DATABASE_VERSION,
            detail: i18n.t(
                'service.database_upgrade_service.generated.database_update_complete'
            )
        });
        useSessionStore.getState().setSessionState({ databaseReady: true });
        return true;
    } catch (error) {
        console.error('Database upgrade failed:', error);
        const reason = errorMessage(error);
        let failedUpgrade = null;
        if (upgradeStarted && !upgradeCommitted) {
            try {
                await backend.sqlite.FailUpgrade(reason);
                failedUpgrade = await backend.sqlite.GetFailedUpgrade();
            } catch (failError) {
                console.error(
                    'Failed to preserve database upgrade work copy:',
                    failError
                );
            }
        }
        await showSQLiteErrorDialog(error);

        let description = i18n.t(
            'service.database_upgrade_service.generated.apply_upgrade_failed'
        );
        if (upgradeCommitted) {
            description = i18n.t(
                'service.database_upgrade_service.generated.refresh_config_failed_after_upgrade'
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
            title: i18n.t(
                'service.database_upgrade_service.generated.database_upgrade_failed'
            ),
            description,
            dismissible: false
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }
}

export async function initializeDatabaseUpgradeFlow() {
    const failedUpgrade = await backend.sqlite.GetFailedUpgrade();
    if (failedUpgrade) {
        return blockOnFailedUpgrade(failedUpgrade);
    }

    let legacyAvailable = false;

    try {
        legacyAvailable = Boolean(await backend.app.CheckLegacyVrcxAvailable());
    } catch (error) {
        console.warn('Legacy VRCX availability check failed:', error);
    }

    if (legacyAvailable) {
        setUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: 0,
            toVersion: DATABASE_VERSION,
            detail: 'A legacy VRCX installation was detected. Confirm migration to let the host copy legacy data and restart, or skip to continue with the current database.',
            legacyMigrationAvailable: true
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }

    return runFullDatabaseUpgrade();
}

export async function confirmLegacyDatabaseMigration() {
    setUpgradeState({
        open: true,
        phase: 'restarting',
        detail: 'Requesting legacy migration from the Tauri host.'
    });

    try {
        const willRestart = await backend.app.RequestLegacyMigration();
        if (willRestart) {
            return;
        }
    } catch (error) {
        console.error('Legacy migration request failed:', error);
    }

    setUpgradeState({
        open: true,
        phase: 'confirm-legacy-migration',
        detail: 'The host did not restart for legacy migration. You can try again or skip and continue with the current database.'
    });
}

export async function skipLegacyDatabaseMigration() {
    setUpgradeState({
        open: false,
        phase: 'running',
        detail: 'Skipping legacy migration and continuing database initialization.',
        legacyMigrationAvailable: false
    });
    return runFullDatabaseUpgrade();
}
