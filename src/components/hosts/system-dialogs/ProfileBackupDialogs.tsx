import {
    ArchiveRestoreIcon,
    CircleCheckIcon,
    LoaderCircleIcon
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { formatDateTime } from '@/lib/dateTime';
import {
    profileBackupErrorKey,
    profileRestoreFailureKey
} from '@/services/profileBackupI18n';
import {
    discardStagedProfileRestore,
    requestProfileRestore,
    type ProfileRestoreProgress,
    type ProfileRestoreValidation
} from '@/services/profileBackupService';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';
import { Button } from '@/ui/shadcn/button';
import { Progress } from '@/ui/shadcn/progress';

const RESTORE_PHASE_KEYS = {
    copyArchive: 'profile_backup.restore_progress_copy',
    extractDatabase: 'profile_backup.restore_progress_extract',
    checkDatabase: 'profile_backup.restore_progress_database_check',
    verifyStaging: 'profile_backup.restore_progress_verify_staging'
} as const;

type RestoreProgressViewProps = {
    progress: ProfileRestoreProgress | null;
    fallback: string;
};

function RestoreProgressView({ progress, fallback }: RestoreProgressViewProps) {
    const { t } = useTranslation();
    if (!progress) {
        return (
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
                <LoaderCircleIcon className="size-5 animate-spin motion-reduce:animate-none" />
                <span>{fallback}</span>
            </div>
        );
    }

    const label = t(RESTORE_PHASE_KEYS[progress.phase]);
    if (progress.percent === null) {
        return (
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
                <LoaderCircleIcon className="size-5 animate-spin motion-reduce:animate-none" />
                <span>{label}</span>
            </div>
        );
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-4 text-sm">
                <span>{label}</span>
                <span className="text-muted-foreground tabular-nums">
                    {progress.percent}%
                </span>
            </div>
            <Progress value={progress.percent} />
        </div>
    );
}

function RestoreMetadata({
    validation
}: {
    validation: ProfileRestoreValidation;
}) {
    const { t } = useTranslation();
    const { manifest } = validation;
    const rows = [
        [
            t('profile_backup.created_at'),
            formatDateTime(manifest.createdAt, {
                dateStyle: 'medium',
                timeStyle: 'short'
            })
        ],
        [t('profile_backup.app_version'), manifest.appVersion],
        [t('profile_backup.database_version'), String(manifest.dbVersion)],
        [t('profile_backup.source_file'), validation.sourceFileName]
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5 text-emerald-800 dark:text-emerald-200">
                <CircleCheckIcon className="size-5 shrink-0" />
                <div>
                    <div className="text-sm font-medium">
                        {t('profile_backup.backup_verified')}
                    </div>
                    <div className="mt-0.5 text-xs text-emerald-800/70 dark:text-emerald-100/65">
                        {t('profile_backup.checks_passed')}
                    </div>
                </div>
            </div>
            <dl className="bg-muted/20 grid gap-x-5 gap-y-3 rounded-md border p-4 text-sm sm:grid-cols-2">
                {rows.map(([label, value]) => (
                    <div key={label} className="min-w-0 space-y-1">
                        <dt className="text-muted-foreground text-xs">
                            {label}
                        </dt>
                        <dd className="min-w-0 font-medium break-all">
                            {value || '-'}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

export function ProfileBackupDialogs() {
    const { t } = useTranslation();
    const status = useProfileBackupStore((state) => state.status);
    const claimOutcomeNotification = useProfileBackupStore(
        (state) => state.claimOutcomeNotification
    );
    const restoreFlow = useProfileBackupStore((state) => state.restoreFlow);
    const restoreValidation = useProfileBackupStore(
        (state) => state.restoreValidation
    );
    const restoreProgress = useProfileBackupStore(
        (state) => state.restoreProgress
    );
    const beginRestorePreparation = useProfileBackupStore(
        (state) => state.beginRestorePreparation
    );
    const closeRestoreFlow = useProfileBackupStore(
        (state) => state.closeRestoreFlow
    );
    const restoreActionPending = useRef(false);
    const isBusy = restoreFlow === 'validating' || restoreFlow === 'preparing';

    useEffect(() => {
        const outcome = status.lastOutcome;
        if (!outcome || !claimOutcomeNotification(outcome.revision)) {
            return;
        }
        if (outcome.succeeded) {
            toast.success(t('profile_backup.backup_saved'), {
                description: outcome.fileName || undefined
            });
            return;
        }
        toast.error(
            t(
                outcome.errorCode
                    ? profileBackupErrorKey(outcome.errorCode)
                    : 'profile_backup.error.unknown'
            )
        );
    }, [claimOutcomeNotification, status.lastOutcome, t]);

    async function confirmRestore() {
        if (
            restoreFlow !== 'confirm' ||
            !restoreValidation ||
            restoreActionPending.current
        ) {
            return;
        }
        restoreActionPending.current = true;
        beginRestorePreparation();
        try {
            const outcome = await requestProfileRestore(
                restoreValidation.stagedSha256
            );
            if (!outcome.validation) {
                restoreActionPending.current = false;
                closeRestoreFlow();
                toast.error(
                    t(
                        outcome.failure
                            ? profileRestoreFailureKey(outcome.failure.code)
                            : 'profile_backup.error.unknown'
                    )
                );
            }
        } catch {
            restoreActionPending.current = false;
            closeRestoreFlow();
            toast.error(t('profile_backup.restore_request_failed'));
        }
    }

    async function cancelRestore() {
        if (restoreFlow !== 'confirm' || restoreActionPending.current) {
            return;
        }
        restoreActionPending.current = true;
        try {
            await discardStagedProfileRestore();
        } catch {
            toast.error(t('profile_backup.error.io'));
        } finally {
            restoreActionPending.current = false;
            closeRestoreFlow();
        }
    }

    let title = t('profile_backup.validating_restore');
    let description = t('profile_backup.restore_validation_description');
    let progressFallback = title;
    if (restoreFlow === 'confirm') {
        title = t('profile_backup.restore_confirm_title');
        description = t('profile_backup.restore_confirm_description');
    } else if (restoreFlow === 'preparing') {
        title = t('profile_backup.preparing_restore');
        description = t('profile_backup.restore_prepare_description');
        progressFallback = title;
    }

    return (
        <AlertDialog
            open={restoreFlow !== 'idle'}
            onOpenChange={(open) => {
                if (!open && restoreFlow === 'confirm') {
                    void cancelRestore();
                }
            }}
        >
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogMedia className="bg-destructive/10 text-destructive">
                        <ArchiveRestoreIcon />
                    </AlertDialogMedia>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {restoreFlow === 'confirm' && restoreValidation ? (
                    <RestoreMetadata validation={restoreValidation} />
                ) : isBusy ? (
                    <RestoreProgressView
                        progress={restoreProgress}
                        fallback={progressFallback}
                    />
                ) : null}
                {restoreFlow === 'confirm' ? (
                    <AlertDialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                void cancelRestore();
                            }}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                void confirmRestore();
                            }}
                        >
                            <ArchiveRestoreIcon data-icon="inline-start" />
                            {t('profile_backup.restore_and_restart')}
                        </Button>
                    </AlertDialogFooter>
                ) : null}
            </AlertDialogContent>
        </AlertDialog>
    );
}
