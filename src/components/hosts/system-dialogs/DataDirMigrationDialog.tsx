import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { FolderOpenIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
    dataDirMigrationErrorKey,
    dataDirMigrationModes,
    dataDirMigrationPhaseKey,
    formatDataDirMigrationBytes
} from '@/services/dataDirMigrationI18n';
import {
    cancelDataDirMigration,
    requestDataDirMigration,
    type DataDirMigrationMode
} from '@/services/dataDirMigrationService';
import { restartApplication } from '@/services/shellIntegrationService';
import { dataDirectoryPathForDisplay } from '@/shared/utils/dataDirectoryPath';
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

const START_LABEL_KEYS: Record<DataDirMigrationMode, string> = {
    migrate: 'data_dir_migration.start',
    adoptExisting: 'data_dir_migration.start_existing',
    freshStart: 'data_dir_migration.start_fresh'
};

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
    const id = useId();

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
    const copying = status.phase === 'copying';
    const cancelling = status.state === 'cancelling';
    const copyPercent = copying ? status.percent : null;
    let titleKey = 'data_dir_migration.title';
    let descriptionKey = 'data_dir_migration.description';
    if (completed) {
        titleKey = 'data_dir_migration.completed_title';
        descriptionKey = 'data_dir_migration.completed_description';
    } else if (running) {
        titleKey = 'data_dir_migration.running_title';
        descriptionKey = 'data_dir_migration.running_description';
    }

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
            <AlertDialogContent className="data-[size=default]:max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-balance">
                        {t(titleKey)}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t(descriptionKey)}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="bg-muted/30 flex min-w-0 items-start gap-3 rounded-md p-3">
                    <FolderOpenIcon
                        aria-hidden="true"
                        className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    />
                    <div className="min-w-0 space-y-1">
                        <p className="text-muted-foreground text-xs">
                            {t('data_dir_migration.new_folder')}
                        </p>
                        <p className="font-mono text-sm break-all">
                            {dataDirectoryPathForDisplay(plan.targetPath)}
                        </p>
                        {!running &&
                        !completed &&
                        plan.targetState === 'foreignContent' ? (
                            <p className="text-muted-foreground text-xs text-pretty">
                                {t('data_dir_migration.target.foreignContent')}
                            </p>
                        ) : null}
                    </div>
                </div>

                {running ? (
                    <div
                        className="space-y-3 py-2"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium">
                                {cancelling
                                    ? t('data_dir_migration.cancelling')
                                    : t(dataDirMigrationPhaseKey(status.phase))}
                            </span>
                            {copyPercent != null ? (
                                <span className="text-muted-foreground tabular-nums">
                                    {copyPercent}%
                                </span>
                            ) : null}
                        </div>
                        {copyPercent != null ? (
                            <Progress
                                value={copyPercent}
                                aria-label={t(
                                    'data_dir_migration.phase.copying'
                                )}
                            />
                        ) : null}
                    </div>
                ) : null}

                {!running && !completed ? (
                    <div className="space-y-4 text-sm">
                        <RadioGroup
                            value={mode}
                            onValueChange={setMode}
                            aria-label={t('data_dir_migration.description')}
                            className="grid gap-2"
                        >
                            {modes.map(([value, labelKey]) => (
                                <label
                                    key={value}
                                    htmlFor={`${id}-${value}`}
                                    className={cn(
                                        'hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-md border p-3',
                                        mode === value &&
                                            'border-primary bg-primary/5'
                                    )}
                                >
                                    <Radio.Root
                                        id={`${id}-${value}`}
                                        value={value}
                                        aria-labelledby={`${id}-${value}-label`}
                                        aria-describedby={`${id}-${value}-description`}
                                        className="border-input data-checked:border-primary data-checked:bg-primary focus-visible:ring-ring mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border focus-visible:ring-2 focus-visible:ring-offset-2"
                                    >
                                        <Radio.Indicator className="bg-primary-foreground size-1.5 rounded-full" />
                                    </Radio.Root>
                                    <span className="min-w-0 space-y-1">
                                        <span
                                            id={`${id}-${value}-label`}
                                            className="block font-medium"
                                        >
                                            {t(labelKey)}
                                        </span>
                                        <span
                                            id={`${id}-${value}-description`}
                                            className="text-muted-foreground block text-xs leading-relaxed text-pretty"
                                        >
                                            {t(
                                                value === 'migrate'
                                                    ? 'data_dir_migration.contents_notice'
                                                    : `data_dir_migration.mode_description.${value}`
                                            )}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </RadioGroup>

                        {mode === 'migrate' ? (
                            <div className="space-y-2">
                                <p className="text-muted-foreground text-xs tabular-nums">
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
                                {insufficientSpace ? (
                                    <p
                                        className="text-destructive text-pretty"
                                        role="alert"
                                    >
                                        {t(
                                            'data_dir_migration.insufficient_space'
                                        )}
                                    </p>
                                ) : null}
                                {plan.targetState === 'existingProfile' ? (
                                    <p className="text-destructive text-xs leading-relaxed text-pretty">
                                        {t(
                                            'data_dir_migration.target.existingProfile'
                                        )}
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="flex items-start gap-2">
                            <TriangleAlertIcon
                                aria-hidden="true"
                                className="text-destructive mt-0.5 size-4 shrink-0"
                            />
                            <p className="text-destructive text-xs leading-relaxed text-pretty">
                                {t(
                                    'data_dir_migration.unsupported_storage_warning'
                                )}
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="text-muted-foreground h-auto p-0"
                            onClick={() => {
                                closeDialog();
                                setSystemHostOpen('profileBackupOpen', true);
                            }}
                        >
                            {t('data_dir_migration.create_backup_first')}
                        </Button>
                    </div>
                ) : null}

                <AlertDialogFooter className="sm:flex-wrap">
                    {running ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!copying || cancelling}
                            onClick={() => void cancelMigration()}
                        >
                            {t(
                                cancelling
                                    ? 'data_dir_migration.cancelling'
                                    : 'common.actions.cancel'
                            )}
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={closeDialog}
                            >
                                {t(
                                    completed
                                        ? 'data_dir_migration.restart_later'
                                        : 'common.actions.cancel'
                                )}
                            </Button>
                            <Button
                                type="button"
                                disabled={!completed && !canStart}
                                onClick={() =>
                                    void (completed
                                        ? restart()
                                        : startMigration())
                                }
                            >
                                {t(
                                    completed
                                        ? 'data_dir_migration.restart_now'
                                        : START_LABEL_KEYS[mode]
                                )}
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
