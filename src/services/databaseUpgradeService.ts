import { toast } from 'sonner';

import {
    commands,
    type DatabaseUpgradePreflight,
    type DatabaseUpgradeRunResult,
    type DatabaseUpgradeStatus,
    type LegacyVrcxMigrationStatus
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import i18n from '@/services/i18nService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { showSQLiteErrorDialog } from './sqliteErrorDialogService';

type DatabaseUpgradePatch = Parameters<
    ReturnType<typeof useRuntimeStore.getState>['setDatabaseUpgradeState']
>[0];

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
    failedUpgrade: DatabaseUpgradeStatus | null | undefined,
    fallbackDescription?: string,
    versions?: { fromVersion: number; toVersion: number }
): Promise<boolean> {
    const description = failedUpgrade
        ? failedUpgradeDescription(failedUpgrade)
        : fallbackDescription ||
          i18n.t('service.database_upgrade_service.error.apply_upgrade_failed');
    setUpgradeState({
        open: false,
        phase: 'error',
        fromVersion: failedUpgrade?.fromVersion ?? versions?.fromVersion ?? 0,
        toVersion: failedUpgrade?.toVersion ?? versions?.toVersion ?? 0,
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

function setRunningState(preflight?: DatabaseUpgradePreflight): void {
    const fromVersion = preflight?.fromVersion ?? 0;
    const toVersion = preflight?.toVersion ?? 0;
    setUpgradeState({
        open: fromVersion > 0 && fromVersion < toVersion,
        phase: 'running',
        fromVersion,
        toVersion,
        detail: i18n.t(
            'service.database_upgrade_service.dynamic.updating_database_from_value_to_value',
            { value: fromVersion, value2: toVersion }
        ),
        legacyMigrationAvailable: false
    });
}

async function completeDatabaseUpgrade(
    result: DatabaseUpgradeRunResult
): Promise<boolean> {
    if (result.status === 'upgraded') {
        try {
            await configRepository.reload();
        } catch (error) {
            console.error(
                'Config refresh failed after database upgrade:',
                error
            );
            await showSQLiteErrorDialog(error);
            return blockOnFailedUpgrade(
                null,
                i18n.t(
                    'service.database_upgrade_service.action.refresh_config_failed_after_upgrade'
                ),
                result
            );
        }
    }

    if (result.repairWarning) {
        console.warn(
            'Co-presence duration repair will be retried on the next startup:',
            result.repairWarning
        );
    }

    setUpgradeState({
        open: false,
        phase: 'completed',
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        detail:
            result.status === 'upgraded'
                ? i18n.t(
                      'service.database_upgrade_service.success.database_update_complete'
                  )
                : i18n.t(
                      'service.database_upgrade_service.label.database_schema_is_current'
                  ),
        legacyMigrationAvailable: false
    });
    useSessionStore.getState().setSessionState({ databaseReady: true });
    return true;
}

async function handleDatabaseUpgradeResult(
    result: DatabaseUpgradeRunResult
): Promise<boolean> {
    if (result.status === 'current' || result.status === 'upgraded') {
        return completeDatabaseUpgrade(result);
    }

    if (result.status === 'failed') {
        const error = new Error(
            result.error ||
                i18n.t(
                    'service.database_upgrade_service.error.apply_upgrade_failed'
                )
        );
        console.error('Database upgrade failed:', error);
        await showSQLiteErrorDialog(error);
    }

    return blockOnFailedUpgrade(
        result.failedUpgrade,
        result.error ||
            i18n.t(
                'service.database_upgrade_service.error.apply_upgrade_failed'
            ),
        result
    );
}

async function runBackendDatabaseUpgrade(
    preflight?: DatabaseUpgradePreflight
): Promise<boolean> {
    setRunningState(preflight);
    try {
        const result = await commands.appDatabaseUpgradeRun();
        return handleDatabaseUpgradeResult(result);
    } catch (error) {
        console.error('Database upgrade command failed:', error);
        await showSQLiteErrorDialog(error);
        return blockOnFailedUpgrade(
            null,
            `${i18n.t(
                'service.database_upgrade_service.error.apply_upgrade_failed'
            )} ${errorMessage(error)}`,
            preflight
        );
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
    let preflight: DatabaseUpgradePreflight;
    try {
        preflight = await commands.appDatabaseUpgradePreflight();
    } catch (error) {
        console.error('Database upgrade preflight failed:', error);
        throw error;
    }

    if (preflight.status === 'running') {
        return runBackendDatabaseUpgrade(preflight);
    }
    if (preflight.status === 'finished') {
        if (!preflight.result) {
            throw new Error(
                'Finished database upgrade status is missing its result.'
            );
        }
        return handleDatabaseUpgradeResult(preflight.result);
    }

    if (preflight.status === 'blocked') {
        return blockOnFailedUpgrade(preflight.failedUpgrade);
    }
    if (preflight.status === 'newerSchema') {
        return blockOnFailedUpgrade(
            null,
            i18n.t(
                'service.database_upgrade_service.error.newer_schema_requires_newer_app',
                {
                    value: preflight.fromVersion,
                    value2: preflight.toVersion
                }
            ),
            preflight
        );
    }

    const legacyMigrationStatus = await getLegacyMigrationStatus();

    if (legacyMigrationStatus.available) {
        setUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: preflight.fromVersion,
            toVersion: preflight.toVersion,
            detail: i18n.t('message.database.migration_found_description'),
            legacyMigrationAvailable: true
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }

    if (legacyMigrationStatus.detected && legacyMigrationStatus.reason) {
        toast.warning(legacyMigrationStatus.reason);
    }

    return runBackendDatabaseUpgrade(preflight);
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
    const { fromVersion, toVersion } =
        useRuntimeStore.getState().databaseUpgrade;
    return runBackendDatabaseUpgrade({
        status: 'upgradeRequired',
        fromVersion,
        toVersion
    });
}
