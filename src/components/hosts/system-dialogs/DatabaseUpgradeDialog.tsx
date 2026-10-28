import { TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IndeterminateProgress } from '@/components/IndeterminateProgress';
import { useCriticalTask } from '@/lib/useCriticalTask';
import { useDelayedFlag } from '@/lib/useDelayedFlag';
import type { DatabaseUpgradeStage } from '@/platform/tauri/bindings';
import {
    confirmLegacyDatabaseMigration,
    createDatabaseUpgradeGitHubIssue,
    openDatabaseUpgradeFailureLogFolder,
    retryDatabaseUpgrade,
    startFreshDatabaseAfterUpgradeFailure,
    skipLegacyDatabaseMigration
} from '@/services/databaseUpgradeService';
import { restartApplication } from '@/services/shellIntegrationService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

const STAGE_DETAIL_REVEAL_MS = 8000;

const DATABASE_UPGRADE_STAGE_KEYS: Record<DatabaseUpgradeStage, string> = {
    preflight: 'message.database.upgrade_stage.preflight',
    prepareLegacySnapshot:
        'message.database.upgrade_stage.prepare_legacy_snapshot',
    prepareLegacyConfiguration:
        'message.database.upgrade_stage.prepare_legacy_configuration',
    finalizeLegacyMigration:
        'message.database.upgrade_stage.finalize_legacy_migration',
    initializeSchema: 'message.database.upgrade_stage.initialize_schema',
    createWorkCopy: 'message.database.upgrade_stage.create_work_copy',
    legacySchemaMigration:
        'message.database.upgrade_stage.legacy_schema_migration',
    legacyPerformanceIndexes:
        'message.database.upgrade_stage.legacy_performance_indexes',
    globalPerformanceIndexes:
        'message.database.upgrade_stage.global_performance_indexes',
    notificationPerformanceIndexes:
        'message.database.upgrade_stage.notification_performance_indexes',
    schemaMigrations: 'message.database.upgrade_stage.schema_migrations',
    optimize: 'message.database.upgrade_stage.optimize',
    writeVersion: 'message.database.upgrade_stage.write_version',
    commit: 'message.database.upgrade_stage.commit',
    repairData: 'message.database.upgrade_stage.repair_data'
};

function getDatabaseUpgradeTitleKey(phase: string): string {
    switch (phase) {
        case 'confirm-legacy-migration':
            return 'message.database.migration_found_title';
        case 'restarting':
            return 'message.database.migration_restarting_title';
        case 'error':
            return 'message.database.upgrade_failed_title';
        default:
            return 'message.database.upgrade_in_progress_title';
    }
}

function DatabaseUpgradeProgressView({
    stage,
    showStageDetail
}: {
    stage: DatabaseUpgradeStage | '';
    showStageDetail: boolean;
}) {
    const { t } = useTranslation();

    return (
        <div className="space-y-2.5">
            <IndeterminateProgress
                aria-label={t('message.database.upgrade_in_progress_title')}
            />
            <div
                className={`grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
                    showStageDetail
                        ? 'grid-rows-[1fr] opacity-100'
                        : 'grid-rows-[0fr] opacity-0'
                }`}
                aria-hidden={!showStageDetail}
            >
                <span className="text-muted-foreground overflow-hidden text-xs">
                    {stage ? t(DATABASE_UPGRADE_STAGE_KEYS[stage]) : ''}
                </span>
            </div>
        </div>
    );
}

function DatabaseUpgradeFailureView({
    isError,
    reason,
    failedWorkDbPath,
    failureLogPath
}: {
    isError: boolean;
    reason: string;
    failedWorkDbPath: string;
    failureLogPath: string;
}) {
    const { t } = useTranslation();

    return (
        <div
            className="space-y-3 rounded-md border p-3 text-sm"
            role={isError ? 'alert' : undefined}
        >
            {reason ? (
                <div className="space-y-1">
                    <div className="text-muted-foreground text-xs">
                        {t('message.database.failure_reason')}
                    </div>
                    <div className="break-words">{reason}</div>
                </div>
            ) : null}
            {failedWorkDbPath ? (
                <div className="space-y-1">
                    <div className="text-muted-foreground text-xs">
                        {t('message.database.preserved_work_database')}
                    </div>
                    <code className="bg-muted block rounded px-2 py-1.5 font-mono text-xs break-all select-all">
                        {failedWorkDbPath}
                    </code>
                    <div className="text-muted-foreground text-xs">
                        {t('message.database.database_upload_warning')}
                    </div>
                </div>
            ) : null}
            <div className="space-y-2 border-t pt-3">
                <div className="space-y-1">
                    <div className="text-muted-foreground text-xs">
                        {t('message.database.failure_record')}
                    </div>
                    {failureLogPath ? (
                        <code className="bg-muted block rounded px-2 py-1.5 font-mono text-xs break-all select-all">
                            {failureLogPath}
                        </code>
                    ) : null}
                    <div className="text-muted-foreground text-xs">
                        {t('message.database.failure_record_hint')}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            void openDatabaseUpgradeFailureLogFolder();
                        }}
                    >
                        {t('message.database.open_failure_log_folder')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            void createDatabaseUpgradeGitHubIssue();
                        }}
                    >
                        {t('message.database.create_github_issue')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function DatabaseUpgradeDialog({ open }: { open: boolean }) {
    const { t } = useTranslation();
    const [legacyChoicePending, setLegacyChoicePending] = useState(false);

    const databaseUpgrade = useRuntimeStore((state) => state.databaseUpgrade);
    const setDatabaseUpgradeState = useRuntimeStore(
        (state) => state.setDatabaseUpgradeState
    );
    const isBusy =
        databaseUpgrade.phase === 'running' ||
        databaseUpgrade.phase === 'restarting';
    const isError = databaseUpgrade.phase === 'error';
    const isBlockingFailure =
        isError &&
        (databaseUpgrade.retryable || databaseUpgrade.freshStartAvailable);
    const showStageDetail = useDelayedFlag(
        open && isBusy,
        STAGE_DETAIL_REVEAL_MS
    );
    useCriticalTask('databaseUpgrade', open && (isBusy || isBlockingFailure));

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && (isBusy || isBlockingFailure)) {
                    return;
                }
                setDatabaseUpgradeState({ open: nextOpen });
            }}
        >
            <DialogContent
                showCloseButton={!isBusy && !isBlockingFailure}
                className={isError ? 'sm:max-w-lg' : undefined}
            >
                <DialogHeader>
                    <DialogTitle
                        className={isError ? 'flex items-start gap-2' : ''}
                    >
                        {isError ? (
                            <TriangleAlertIcon className="text-destructive mt-px size-[18px] shrink-0" />
                        ) : null}
                        {t(getDatabaseUpgradeTitleKey(databaseUpgrade.phase))}
                    </DialogTitle>
                    <DialogDescription
                        className={isError ? 'text-foreground' : undefined}
                    >
                        {isBusy
                            ? t('message.database.upgrade_keep_open')
                            : databaseUpgrade.detail}
                    </DialogDescription>
                </DialogHeader>
                {isBusy ? (
                    <DatabaseUpgradeProgressView
                        stage={databaseUpgrade.stage}
                        showStageDetail={showStageDetail}
                    />
                ) : null}
                {isError || databaseUpgrade.failureLogPath ? (
                    <DatabaseUpgradeFailureView
                        isError={isError}
                        reason={databaseUpgrade.failureReason}
                        failedWorkDbPath={databaseUpgrade.failedWorkDbPath}
                        failureLogPath={databaseUpgrade.failureLogPath}
                    />
                ) : null}
                <DialogFooter>
                    {databaseUpgrade.phase === 'confirm-legacy-migration' ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={legacyChoicePending}
                                onClick={() => {
                                    setLegacyChoicePending(true);
                                    void skipLegacyDatabaseMigration();
                                }}
                            >
                                {t('message.database.migration_skip')}
                            </Button>
                            <Button
                                type="button"
                                disabled={legacyChoicePending}
                                onClick={() => {
                                    setLegacyChoicePending(true);
                                    void confirmLegacyDatabaseMigration().finally(
                                        () => {
                                            setLegacyChoicePending(false);
                                        }
                                    );
                                }}
                            >
                                {t('dialog.system.action.migrate_and_restart')}
                            </Button>
                        </>
                    ) : isError ? (
                        <>
                            {databaseUpgrade.freshStartAvailable ? (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={() => {
                                        void startFreshDatabaseAfterUpgradeFailure();
                                    }}
                                >
                                    {t('message.database.use_new_database')}
                                </Button>
                            ) : null}
                            {databaseUpgrade.retryable ? (
                                <Button
                                    type="button"
                                    onClick={() => {
                                        void retryDatabaseUpgrade();
                                    }}
                                >
                                    {t('common.action.retry')}
                                </Button>
                            ) : null}
                            {!databaseUpgrade.freshStartAvailable &&
                            !databaseUpgrade.retryable ? (
                                <Button
                                    type="button"
                                    onClick={() => {
                                        void restartApplication();
                                    }}
                                >
                                    {t('message.database.restart_app')}
                                </Button>
                            ) : null}
                        </>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() =>
                                setDatabaseUpgradeState({ open: false })
                            }
                        >
                            {t('common.actions.close')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
