import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    dataDirMigrationErrorKey,
    dataDirMigrationModes,
    dataDirMigrationPhaseKey,
    formatDataDirMigrationBytes
} from '@/services/dataDirMigrationI18n';
import {
    cancelDataDirMigration,
    requestDataDirMigration
} from '@/services/dataDirMigrationService';
import { restartApplication } from '@/services/shellIntegrationService';
import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';
import { Button } from '@/ui/shadcn/button';
import { Progress } from '@/ui/shadcn/progress';

export function DataDirMigrationDialog() {
    const { t, i18n } = useTranslation();
    const open = useDataDirMigrationStore((state) => state.dialogOpen);
    const plan = useDataDirMigrationStore((state) => state.plan);
    const mode = useDataDirMigrationStore((state) => state.mode);
    const status = useDataDirMigrationStore((state) => state.status);
    const closeDialog = useDataDirMigrationStore((state) => state.closeDialog);
    const setMode = useDataDirMigrationStore((state) => state.setMode);
    const applyStatus = useDataDirMigrationStore((state) => state.applyStatus);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const [submitting, setSubmitting] = useState(false);

    if (!plan) {
        return null;
    }

    const running =
        submitting ||
        status.state === 'running' ||
        status.state === 'cancelling';
    const completed = status.state === 'completed';
    const insufficientSpace = plan.availableBytes < plan.requiredBytes;
    const canStart = mode !== 'migrate' || !insufficientSpace;
    const modes = dataDirMigrationModes(plan.targetState);

    async function startMigration() {
        if (!canStart || !plan) {
            return;
        }
        setSubmitting(true);
        try {
            const outcome = await requestDataDirMigration(
                plan.targetPath,
                mode
            );
            applyStatus(outcome.status);
            if (!outcome.accepted) {
                toast.error(
                    outcome.error
                        ? t(dataDirMigrationErrorKey(outcome.error.code))
                        : t('data_dir_migration.error.io')
                );
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function cancelMigration() {
        const outcome = await cancelDataDirMigration();
        applyStatus(outcome.status);
        if (!outcome.accepted && outcome.error) {
            toast.error(t(dataDirMigrationErrorKey(outcome.error.code)));
        }
    }

    async function restart() {
        try {
            await restartApplication();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && !running) {
                    closeDialog();
                }
            }}
        >
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {completed
                            ? t('data_dir_migration.completed_title')
                            : t('data_dir_migration.title')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {completed
                            ? t('data_dir_migration.completed_description')
                            : t('data_dir_migration.description')}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {running ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <span>
                                {t(dataDirMigrationPhaseKey(status.phase))}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                                {status.percent ?? 0}%
                            </span>
                        </div>
                        <Progress value={status.percent ?? 0} />
                        <p className="text-muted-foreground text-xs break-all">
                            {plan.targetPath}
                        </p>
                    </div>
                ) : completed ? (
                    <p className="text-muted-foreground text-sm break-all">
                        {plan.targetPath}
                    </p>
                ) : (
                    <div className="space-y-4 text-sm">
                        <div className="bg-muted/30 space-y-1 rounded-md border p-3">
                            <p className="font-medium break-all">
                                {plan.targetPath}
                            </p>
                            <p className="text-muted-foreground">
                                {t('data_dir_migration.space_summary', {
                                    required: formatDataDirMigrationBytes(
                                        plan.requiredBytes,
                                        i18n.language
                                    ),
                                    available: formatDataDirMigrationBytes(
                                        plan.availableBytes,
                                        i18n.language
                                    )
                                })}
                            </p>
                            <p className="text-muted-foreground">
                                {t(
                                    `data_dir_migration.target.${plan.targetState}`
                                )}
                            </p>
                        </div>

                        <div className="grid gap-2">
                            {modes.map(([value, labelKey]) => (
                                <label
                                    key={value}
                                    className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-md border p-3"
                                >
                                    <input
                                        type="radio"
                                        name="data-dir-migration-mode"
                                        value={value}
                                        checked={mode === value}
                                        onChange={() => setMode(value)}
                                        className="mt-0.5"
                                    />
                                    <span>{t(labelKey)}</span>
                                </label>
                            ))}
                        </div>

                        {insufficientSpace && mode === 'migrate' ? (
                            <p className="text-destructive">
                                {t('data_dir_migration.insufficient_space')}
                            </p>
                        ) : null}
                        <p className="text-muted-foreground">
                            {t('data_dir_migration.contents_notice')}
                        </p>
                        <p className="text-destructive font-medium">
                            {t(
                                'data_dir_migration.unsupported_storage_warning'
                            )}
                        </p>
                    </div>
                )}

                <AlertDialogFooter>
                    {running ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={status.phase !== 'copying'}
                            onClick={() => void cancelMigration()}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                    ) : completed ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={closeDialog}
                            >
                                {t('data_dir_migration.restart_later')}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void restart()}
                            >
                                {t('data_dir_migration.restart_now')}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    closeDialog();
                                    setSystemHostOpen(
                                        'profileBackupOpen',
                                        true
                                    );
                                }}
                            >
                                {t('data_dir_migration.create_backup_first')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={closeDialog}
                            >
                                {t('common.actions.cancel')}
                            </Button>
                            <Button
                                type="button"
                                disabled={!canStart}
                                onClick={() => void startMigration()}
                            >
                                {t('data_dir_migration.start')}
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
