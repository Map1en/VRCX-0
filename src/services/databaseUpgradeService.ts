import {
    commands,
    type DatabaseUpgradePreflight,
    type DatabaseUpgradeProgress,
    type DatabaseUpgradeRunResult,
    type DatabaseUpgradeStatus
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import i18n from '@/services/i18nService';
import { confirmLegacyVrcxProcessState } from '@/services/legacyVrcxMigrationService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { links } from '@/shared/constants/link';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { showSQLiteErrorDialog } from './sqliteErrorDialogService';

type DatabaseUpgradePatch = Parameters<
    ReturnType<typeof useRuntimeStore.getState>['setDatabaseUpgradeState']
>[0];
type FailureRecoveryOptions = {
    retryable?: boolean;
    freshStartAvailable?: boolean;
};

const DATABASE_UPGRADE_ISSUE_URL = `${links.issues}/new?template=bug_report.yml`;
const DATABASE_UPGRADE_PROGRESS_POLL_INTERVAL_MS = 100;
const DATABASE_UPGRADE_DIALOG_OPEN_DELAY_MS = 400;
const DATABASE_UPGRADE_DIALOG_MIN_VISIBLE_MS = 600;

let dialogOpenTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let dialogOpenedAt = 0;

function setUpgradeState(patch: DatabaseUpgradePatch): void {
    useRuntimeStore.getState().setDatabaseUpgradeState(patch);
}

function cancelScheduledDialogOpen(): void {
    if (dialogOpenTimer !== null) {
        globalThis.clearTimeout(dialogOpenTimer);
        dialogOpenTimer = null;
    }
}

function scheduleDialogOpen(): void {
    if (dialogOpenTimer !== null || dialogOpenedAt !== 0) {
        return;
    }
    dialogOpenTimer = globalThis.setTimeout(() => {
        dialogOpenTimer = null;
        dialogOpenedAt = Date.now();
        setUpgradeState({ open: true });
    }, DATABASE_UPGRADE_DIALOG_OPEN_DELAY_MS);
}

function openDialogNow(): void {
    cancelScheduledDialogOpen();
    if (dialogOpenedAt === 0) {
        dialogOpenedAt = Date.now();
    }
    setUpgradeState({ open: true });
}

async function closeDialogAfterMinimumVisibleTime(): Promise<void> {
    cancelScheduledDialogOpen();
    const openedAt = dialogOpenedAt;
    dialogOpenedAt = 0;
    if (openedAt !== 0) {
        const remaining =
            DATABASE_UPGRADE_DIALOG_MIN_VISIBLE_MS - (Date.now() - openedAt);
        if (remaining > 0) {
            await new Promise((resolve) => {
                globalThis.setTimeout(resolve, remaining);
            });
        }
    }
    setUpgradeState({ open: false });
}

function applyDatabaseUpgradeProgress(progress: DatabaseUpgradeProgress): void {
    setUpgradeState({
        stage: progress.stage,
        progressCompleted: progress.completedUnits ?? 0,
        progressTotal: progress.totalUnits ?? 0
    });
}

function startDatabaseUpgradeProgressPolling(): () => void {
    let requestInFlight = false;
    let stopped = false;
    async function refresh(): Promise<void> {
        if (requestInFlight || stopped) {
            return;
        }
        requestInFlight = true;
        try {
            const progress = await commands.appDatabaseUpgradeProgress();
            if (!stopped) {
                applyDatabaseUpgradeProgress(progress);
            }
        } catch (error) {
            console.warn('Database upgrade progress unavailable:', error);
        } finally {
            requestInFlight = false;
        }
    }

    void refresh();
    const timer = globalThis.setInterval(() => {
        void refresh();
    }, DATABASE_UPGRADE_PROGRESS_POLL_INTERVAL_MS);
    return () => {
        stopped = true;
        globalThis.clearInterval(timer);
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function failedUpgradeDescription(): string {
    return i18n.t(
        'service.database_upgrade_service.error.failed_upgrade_description'
    );
}

async function getFailureLogPath(): Promise<string> {
    try {
        return await commands.appDatabaseUpgradeFailureLogPath();
    } catch (error) {
        console.warn('Database upgrade failure log path unavailable:', error);
        return '';
    }
}

async function blockOnFailedUpgrade(
    failedUpgrade: DatabaseUpgradeStatus | null | undefined,
    fallbackDescription?: string,
    versions?: { fromVersion: number; toVersion: number },
    options: FailureRecoveryOptions = {}
): Promise<boolean> {
    const current = useRuntimeStore.getState().databaseUpgrade;
    const retryable = options.retryable ?? true;
    const freshStartAvailable =
        options.freshStartAvailable ?? Boolean(failedUpgrade);
    const description = failedUpgrade
        ? failedUpgradeDescription()
        : fallbackDescription ||
          i18n.t('service.database_upgrade_service.error.apply_upgrade_failed');
    const logPath = (await getFailureLogPath()) || current.failureLogPath;
    openDialogNow();
    setUpgradeState({
        phase: 'error',
        fromVersion: failedUpgrade?.fromVersion ?? versions?.fromVersion ?? 0,
        toVersion: failedUpgrade?.toVersion ?? versions?.toVersion ?? 0,
        stage: current.stage,
        progressCompleted: 0,
        progressTotal: 0,
        detail: description,
        failureReason: failedUpgrade?.reason
            ? String(failedUpgrade.reason)
            : '',
        legacyMigrationAvailable: false,
        retryable,
        freshStartAvailable,
        failureLogPath: logPath,
        failedWorkDbPath: failedUpgrade?.workDbPath || current.failedWorkDbPath
    });
    useSessionStore.getState().setSessionState({ databaseReady: false });
    return false;
}

function setRunningState(
    preflight?: DatabaseUpgradePreflight,
    forceOpen = false
): void {
    const fromVersion = preflight?.fromVersion ?? 0;
    const toVersion = preflight?.toVersion ?? 0;
    const shouldShowProgress =
        forceOpen ||
        preflight?.status === 'upgradeRequired' ||
        preflight?.status === 'running' ||
        preflight?.repairPending === true;
    setUpgradeState({
        phase: 'running',
        fromVersion,
        toVersion,
        stage: 'preflight',
        progressCompleted: 0,
        progressTotal: 0,
        detail: '',
        failureReason: '',
        legacyMigrationAvailable: false,
        retryable: false,
        freshStartAvailable: false,
        failureLogPath: '',
        failedWorkDbPath: ''
    });
    if (!shouldShowProgress) {
        cancelScheduledDialogOpen();
        setUpgradeState({ open: false });
        return;
    }
    if (forceOpen) {
        openDialogNow();
        return;
    }
    scheduleDialogOpen();
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
                result,
                { freshStartAvailable: false }
            );
        }
    }

    if (result.repairWarning) {
        console.warn(
            'Database data repair will be retried on the next startup:',
            result.repairWarning
        );
    }

    setUpgradeState({
        phase: 'completed',
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        stage: 'commit',
        progressCompleted: 0,
        progressTotal: 0,
        detail:
            result.status === 'upgraded'
                ? i18n.t(
                      'service.database_upgrade_service.success.database_update_complete'
                  )
                : i18n.t(
                      'service.database_upgrade_service.label.database_schema_is_current'
                  ),
        failureReason: '',
        legacyMigrationAvailable: false,
        retryable: false,
        freshStartAvailable: false,
        failureLogPath: '',
        failedWorkDbPath: ''
    });
    await closeDialogAfterMinimumVisibleTime();
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
        result,
        {
            retryable: result.status !== 'newerSchema',
            freshStartAvailable: true
        }
    );
}

async function runBackendDatabaseUpgrade(
    preflight?: DatabaseUpgradePreflight
): Promise<boolean> {
    setRunningState(preflight);
    const stopProgressPolling = startDatabaseUpgradeProgressPolling();
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
    } finally {
        stopProgressPolling();
    }
}

export async function retryDatabaseUpgrade(): Promise<boolean> {
    const { fromVersion, toVersion } =
        useRuntimeStore.getState().databaseUpgrade;
    const preflight: DatabaseUpgradePreflight = {
        status: 'upgradeRequired',
        fromVersion,
        toVersion,
        repairPending: false
    };
    setRunningState(preflight, true);
    const stopProgressPolling = startDatabaseUpgradeProgressPolling();
    try {
        const result = await commands.appDatabaseUpgradeRetry();
        return handleDatabaseUpgradeResult(result);
    } catch (error) {
        console.error('Database upgrade retry command failed:', error);
        await showSQLiteErrorDialog(error);
        return blockOnFailedUpgrade(
            null,
            `${i18n.t(
                'service.database_upgrade_service.error.apply_upgrade_failed'
            )} ${errorMessage(error)}`,
            preflight,
            { freshStartAvailable: true }
        );
    } finally {
        stopProgressPolling();
    }
}

export async function openDatabaseUpgradeFailureLogFolder(): Promise<void> {
    await commands.appOpenVrcxAppDataFolder();
}

export async function createDatabaseUpgradeGitHubIssue(): Promise<void> {
    await openExternalLink(DATABASE_UPGRADE_ISSUE_URL);
}

export async function startFreshDatabaseAfterUpgradeFailure(): Promise<boolean> {
    const before = useRuntimeStore.getState().databaseUpgrade;
    if (!before.freshStartAvailable) {
        return false;
    }
    const confirmation = await useModalStore.getState().confirm({
        title: i18n.t('message.database.fresh_start_confirm_title'),
        description: i18n.t('message.database.fresh_start_confirm_description'),
        confirmText: i18n.t('message.database.use_new_database'),
        cancelText: i18n.t('common.actions.cancel'),
        destructive: true
    });
    if (!confirmation.ok) {
        return false;
    }

    setUpgradeState({
        open: true,
        phase: 'restarting',
        detail: i18n.t('message.database.fresh_start_restarting'),
        retryable: false,
        freshStartAvailable: false
    });
    try {
        await commands.appDatabaseUpgradeStartFresh();
        return true;
    } catch (error) {
        console.error('Fresh database recovery failed:', error);
        await showSQLiteErrorDialog(error);
        setUpgradeState({
            ...before,
            open: true,
            phase: 'error',
            detail: `${i18n.t(
                'message.database.fresh_start_failed'
            )} ${errorMessage(error)}`
        });
        return false;
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
        return finishUpgradeAndQueueLegacyMigration(
            preflight,
            runBackendDatabaseUpgrade(preflight)
        );
    }
    if (preflight.status === 'finished') {
        if (!preflight.result) {
            throw new Error(
                'Finished database upgrade status is missing its result.'
            );
        }
        return finishUpgradeAndQueueLegacyMigration(
            preflight,
            handleDatabaseUpgradeResult(preflight.result)
        );
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
            preflight,
            {
                retryable: false,
                freshStartAvailable: true
            }
        );
    }

    return finishUpgradeAndQueueLegacyMigration(
        preflight,
        runBackendDatabaseUpgrade(preflight)
    );
}

async function finishUpgradeAndQueueLegacyMigration(
    preflight: DatabaseUpgradePreflight,
    upgrade: Promise<boolean>
): Promise<boolean> {
    const databaseReady = await upgrade;
    if (!databaseReady) {
        return false;
    }

    let legacyMigrationStatus;
    try {
        legacyMigrationStatus =
            await commands.appGetLegacyVrcxMigrationStatus();
    } catch (error) {
        console.warn('Legacy VRCX migration status unavailable:', error);
        return true;
    }

    if (legacyMigrationStatus.available) {
        setUpgradeState({
            open: false,
            phase: 'confirm-legacy-migration',
            fromVersion: preflight.fromVersion,
            toVersion: preflight.toVersion,
            detail: i18n.t('message.database.migration_found_description'),
            legacyMigrationAvailable: true,
            retryable: false,
            freshStartAvailable: false,
            failureLogPath: '',
            failedWorkDbPath: ''
        });
    } else if (legacyMigrationStatus.detected && legacyMigrationStatus.reason) {
        toast.add({ type: 'warning', title: legacyMigrationStatus.reason });
    }
    return true;
}

export async function confirmLegacyDatabaseMigration(): Promise<void> {
    let remoteDatabase: boolean;
    try {
        remoteDatabase = (await commands.appBootstrapStatusGet()).isRemote;
    } catch {
        toast.add({
            type: 'error',
            title: i18n.t('view.login.legacy_import_storage_unavailable')
        });
        return;
    }
    if (remoteDatabase && !useSessionStore.getState().isLoggedIn) {
        setUpgradeState({ open: false });
        toast.add({
            type: 'warning',
            title: i18n.t('view.login.legacy_import_sign_in_required')
        });
        return;
    }

    let failureDetail = i18n.t(
        'service.database_upgrade_service.error.legacy_migration_restart_failed'
    );
    let allowRunningLegacyVrcx: boolean;
    try {
        allowRunningLegacyVrcx = await confirmLegacyVrcxProcessState({
            alert: useModalStore.getState().alert,
            t: i18n.t.bind(i18n)
        });
    } catch (error) {
        console.error('Legacy VRCX process check failed:', error);
        failureDetail = `${failureDetail} ${errorMessage(error)}`;
        setUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            detail: failureDetail
        });
        return;
    }

    if (remoteDatabase && !useSessionStore.getState().isLoggedIn) {
        setUpgradeState({ open: false });
        toast.add({
            type: 'warning',
            title: i18n.t('view.login.legacy_import_sign_in_required')
        });
        return;
    }
    setUpgradeState({
        open: true,
        phase: 'running',
        stage: 'prepareLegacySnapshot',
        progressCompleted: 0,
        progressTotal: 0,
        detail: i18n.t(
            'service.database_upgrade_service.action.requesting_legacy_migration'
        ),
        retryable: false,
        freshStartAvailable: false,
        failureLogPath: '',
        failedWorkDbPath: ''
    });

    const stopProgressPolling = startDatabaseUpgradeProgressPolling();
    try {
        const willRestart = await commands.appRequestLegacyMigration(
            allowRunningLegacyVrcx
        );
        if (willRestart) {
            setUpgradeState({
                phase: 'restarting',
                stage: 'finalizeLegacyMigration',
                progressCompleted: 0,
                progressTotal: 0
            });
            return;
        }
    } catch (error) {
        console.error('Legacy migration request failed:', error);
        const failureLogPath = await getFailureLogPath();
        failureDetail = `${failureDetail} ${errorMessage(error)}`;
        setUpgradeState({
            failureLogPath
        });
    } finally {
        stopProgressPolling();
    }

    setUpgradeState({
        open: true,
        phase: 'confirm-legacy-migration',
        stage: '',
        progressCompleted: 0,
        progressTotal: 0,
        detail: failureDetail,
        retryable: false
    });
}

export async function skipLegacyDatabaseMigration(): Promise<boolean> {
    setUpgradeState({
        open: false,
        phase: 'completed',
        legacyMigrationAvailable: false
    });
    return true;
}
