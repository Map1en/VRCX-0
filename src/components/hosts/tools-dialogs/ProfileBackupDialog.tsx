import {
    CalendarClockIcon,
    FolderOpenIcon,
    LoaderCircleIcon,
    RotateCcwIcon,
    SaveIcon
} from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useProfileBackupSettings } from '@/features/tools/useProfileBackupSettings';
import { useProfileRestoreRollback } from '@/features/tools/useProfileRestoreRollback';
import { formatDateTime } from '@/lib/dateTime';
import {
    profileBackupErrorKey,
    profileBackupPhaseKey
} from '@/services/profileBackupI18n';
import {
    discardPendingProfileBackup,
    dismissProfileBackupError,
    retryProfileBackupDelivery,
    type ProfileBackupStatus,
    type ProfileRestoreRollbackState
} from '@/services/profileBackupService';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText
} from '@/ui/shadcn/input-group';
import { Progress } from '@/ui/shadcn/progress';
import { Separator } from '@/ui/shadcn/separator';
import { Switch } from '@/ui/shadcn/switch';

type ProfileBackupDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

type ProfileRestoreRollbackCleanupProps = {
    state: ProfileRestoreRollbackState | null;
    cleanupRunning: boolean;
    onClear: () => void;
};

export function ProfileRestoreRollbackCleanup({
    state,
    cleanupRunning,
    onClear
}: ProfileRestoreRollbackCleanupProps) {
    const { t } = useTranslation();
    if (!state || state.count === 0) {
        return null;
    }
    return (
        <div className="bg-muted/30 flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                    {t('profile_backup.rollback_data_retained')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {t(
                        state.cleanupAllowed
                            ? 'profile_backup.rollback_retained_description'
                            : 'profile_backup.rollback_cleanup_protected'
                    )}
                </p>
            </div>
            <Button
                type="button"
                variant="outline"
                disabled={cleanupRunning || !state.cleanupAllowed}
                onClick={onClear}
            >
                {t('profile_backup.clear_rollback')}
            </Button>
        </div>
    );
}

function getStatusTitleKey(status: ProfileBackupStatus): string {
    switch (status.state) {
        case 'running':
            return status.kind === 'auto'
                ? 'profile_backup.automatic_running'
                : 'profile_backup.manual_running';
        case 'retryable':
            return 'profile_backup.retryable_title';
        case 'error':
            return 'profile_backup.error_title';
        case 'idle':
            return '';
    }
}

function BackupPath({
    value,
    disabled,
    onChoose
}: {
    value: string;
    disabled: boolean;
    onChoose: () => void;
}) {
    const { t } = useTranslation();
    return (
        <InputGroup title={value || undefined}>
            <InputGroupInput
                readOnly
                disabled={disabled}
                value={value}
                placeholder={t('profile_backup.location_not_set')}
                aria-label={t('profile_backup.change_folder')}
            />
            <InputGroupAddon>
                <FolderOpenIcon />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
                <InputGroupButton disabled={disabled} onClick={onChoose}>
                    {t('profile_backup.change_folder')}
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    );
}

export function ProfileBackupDialog({
    open,
    onOpenChange
}: ProfileBackupDialogProps) {
    const { t } = useTranslation();
    const status = useProfileBackupStore((state) => state.status);
    const applyStatus = useProfileBackupStore((state) => state.applyStatus);
    const {
        settings,
        loading,
        saving,
        startingManualBackup,
        validatingRestore,
        numericDraftValue,
        setNumericDraft,
        commitNumericDraft,
        setAutoEnabled,
        chooseAutomaticBackupFolder,
        startManualBackup,
        selectBackupToRestore
    } = useProfileBackupSettings(open);
    const [statusActionRunning, setStatusActionRunning] = useState(false);
    const {
        rollbackState,
        cleanupRunning,
        refreshRollbackState,
        confirmAndClearRollback
    } = useProfileRestoreRollback();
    const isRunning = status.state === 'running';
    const automaticEnabled = Boolean(settings?.autoEnabled);
    const disabled = loading || saving || !settings || isRunning;
    const statusErrorKey = status.error
        ? profileBackupErrorKey(status.error.code)
        : 'profile_backup.error.unknown';
    const lastAutomaticBackup = settings?.lastAutoAt
        ? formatDateTime(settings.lastAutoAt, {
              dateStyle: 'medium',
              timeStyle: 'short'
          })
        : t('profile_backup.no_automatic_backup');
    const statusTitleKey = getStatusTitleKey(status);
    const runningPhaseKey = profileBackupPhaseKey(status);
    const runningPhaseLabel = t(runningPhaseKey);

    useLayoutEffect(() => {
        if (open) {
            void refreshRollbackState();
        }
    }, [open, refreshRollbackState]);

    async function runStatusAction(action: 'retry' | 'discard' | 'dismiss') {
        setStatusActionRunning(true);
        try {
            if (action === 'retry') {
                const outcome = await retryProfileBackupDelivery();
                applyStatus(outcome.status);
                if (!outcome.accepted) {
                    toast.error(
                        t(
                            outcome.error
                                ? profileBackupErrorKey(outcome.error.code)
                                : 'profile_backup.error.unknown'
                        )
                    );
                }
            } else if (action === 'discard') {
                const outcome = await discardPendingProfileBackup();
                applyStatus(outcome.status);
                if (!outcome.accepted) {
                    toast.error(
                        t(
                            outcome.error
                                ? profileBackupErrorKey(outcome.error.code)
                                : 'profile_backup.error.unknown'
                        )
                    );
                }
            } else {
                applyStatus(await dismissProfileBackupError());
            }
        } catch {
            toast.error(t('profile_backup.action_failed'));
        } finally {
            setStatusActionRunning(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="border-b px-6 py-5">
                    <DialogTitle>{t('profile_backup.header')}</DialogTitle>
                    <DialogDescription>
                        {t('profile_backup.tools_description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                    <section className="flex flex-col gap-4">
                        <Field
                            orientation="horizontal"
                            data-disabled={disabled}
                        >
                            <FieldContent>
                                <FieldLabel htmlFor="profile-backup-automatic">
                                    {t('profile_backup.automatic')}
                                </FieldLabel>
                                <FieldDescription>
                                    {t('profile_backup.automatic_description')}
                                </FieldDescription>
                            </FieldContent>
                            <Switch
                                id="profile-backup-automatic"
                                checked={automaticEnabled}
                                disabled={disabled}
                                aria-label={t(
                                    'profile_backup.enable_automatic'
                                )}
                                onCheckedChange={(checked) => {
                                    void setAutoEnabled(checked);
                                }}
                            />
                        </Field>

                        {status.state !== 'idle' ? (
                            <Alert
                                variant={isRunning ? 'default' : 'destructive'}
                            >
                                <AlertTitle className="flex items-center justify-between gap-3">
                                    <span>{t(statusTitleKey)}</span>
                                    {isRunning && status.percent !== null ? (
                                        <span className="text-muted-foreground text-xs tabular-nums">
                                            {`${status.percent}%`}
                                        </span>
                                    ) : null}
                                </AlertTitle>
                                <AlertDescription>
                                    {isRunning ? (
                                        <div className="flex flex-col gap-2 pt-1">
                                            <div
                                                role="status"
                                                aria-live="polite"
                                                className="text-muted-foreground flex items-center gap-1.5 text-xs"
                                            >
                                                {status.percent === null ? (
                                                    <LoaderCircleIcon
                                                        aria-hidden="true"
                                                        className="size-3 animate-spin motion-reduce:animate-none"
                                                    />
                                                ) : null}
                                                {runningPhaseLabel}
                                            </div>
                                            {status.percent !== null ? (
                                                <Progress
                                                    aria-label={
                                                        runningPhaseLabel
                                                    }
                                                    value={status.percent}
                                                />
                                            ) : null}
                                            <p className="text-muted-foreground text-xs leading-relaxed">
                                                {t(
                                                    'profile_backup.background_backup_notice'
                                                )}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-3 pt-1">
                                            <p className="text-xs leading-relaxed">
                                                {t(statusErrorKey)}
                                            </p>
                                            {status.error?.path ? (
                                                <div className="bg-background/60 rounded-md border p-2 text-xs break-all">
                                                    {status.error.path}
                                                </div>
                                            ) : null}
                                            <div className="flex flex-wrap justify-end gap-2">
                                                {status.state ===
                                                'retryable' ? (
                                                    <>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={
                                                                statusActionRunning
                                                            }
                                                            onClick={() => {
                                                                void runStatusAction(
                                                                    'discard'
                                                                );
                                                            }}
                                                        >
                                                            {t(
                                                                'profile_backup.discard_backup'
                                                            )}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            disabled={
                                                                statusActionRunning
                                                            }
                                                            onClick={() => {
                                                                void runStatusAction(
                                                                    'retry'
                                                                );
                                                            }}
                                                        >
                                                            {t(
                                                                'profile_backup.retry_save'
                                                            )}
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        disabled={
                                                            statusActionRunning
                                                        }
                                                        onClick={() => {
                                                            void runStatusAction(
                                                                'dismiss'
                                                            );
                                                        }}
                                                    >
                                                        {t(
                                                            'profile_backup.dismiss_error'
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </AlertDescription>
                            </Alert>
                        ) : null}

                        <FieldGroup className="gap-4">
                            <Field>
                                <div className="flex items-center gap-2 text-xs">
                                    <CalendarClockIcon className="text-muted-foreground size-4" />
                                    <span className="text-muted-foreground">
                                        {t(
                                            'profile_backup.last_automatic_backup'
                                        )}
                                    </span>
                                    <span className="font-medium">
                                        {lastAutomaticBackup}
                                    </span>
                                </div>
                                <BackupPath
                                    value={settings?.autoTargetDir || ''}
                                    disabled={disabled}
                                    onChoose={() => {
                                        void chooseAutomaticBackupFolder();
                                    }}
                                />
                            </Field>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel htmlFor="profile-backup-interval">
                                        {t('profile_backup.interval')}
                                    </FieldLabel>
                                    <InputGroup>
                                        <InputGroupInput
                                            id="profile-backup-interval"
                                            type="number"
                                            min={1}
                                            max={30}
                                            disabled={disabled}
                                            value={numericDraftValue(
                                                'autoIntervalDays'
                                            )}
                                            onChange={(event) =>
                                                setNumericDraft(
                                                    'autoIntervalDays',
                                                    event.currentTarget.value
                                                )
                                            }
                                            onBlur={() => {
                                                void commitNumericDraft(
                                                    'autoIntervalDays'
                                                );
                                            }}
                                            aria-label={t(
                                                'profile_backup.interval'
                                            )}
                                        />
                                        <InputGroupAddon align="inline-end">
                                            <InputGroupText>
                                                {t('profile_backup.days')}
                                            </InputGroupText>
                                        </InputGroupAddon>
                                    </InputGroup>
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="profile-backup-keep-count">
                                        {t('profile_backup.keep_count')}
                                    </FieldLabel>
                                    <Input
                                        id="profile-backup-keep-count"
                                        type="number"
                                        min={2}
                                        max={6}
                                        disabled={disabled}
                                        value={numericDraftValue(
                                            'autoRetainExtra'
                                        )}
                                        onChange={(event) =>
                                            setNumericDraft(
                                                'autoRetainExtra',
                                                event.currentTarget.value
                                            )
                                        }
                                        onBlur={() => {
                                            void commitNumericDraft(
                                                'autoRetainExtra'
                                            );
                                        }}
                                        aria-label={t(
                                            'profile_backup.keep_count'
                                        )}
                                    />
                                </Field>
                            </div>
                        </FieldGroup>
                    </section>

                    <Separator />

                    <section className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                            <h3 className="font-heading text-sm font-medium">
                                {t('profile_backup.manual_backup')}
                            </h3>
                            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                                {t('profile_backup.manual_backup_description')}
                            </p>
                        </div>
                        <div className="sm:self-center">
                            <Button
                                type="button"
                                disabled={disabled || startingManualBackup}
                                onClick={() => {
                                    void startManualBackup();
                                }}
                            >
                                <SaveIcon data-icon="inline-start" />
                                {t('profile_backup.backup_now')}
                            </Button>
                        </div>
                    </section>

                    <Separator />

                    <section className="flex flex-col gap-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                                <h3 className="font-heading text-sm font-medium">
                                    {t('profile_backup.restore')}
                                </h3>
                                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                                    {t('profile_backup.restore_description')}
                                </p>
                            </div>
                            <div className="sm:self-center">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={disabled || validatingRestore}
                                    onClick={() => {
                                        void selectBackupToRestore();
                                    }}
                                >
                                    <RotateCcwIcon data-icon="inline-start" />
                                    {t('profile_backup.restore_from_backup')}
                                </Button>
                            </div>
                        </div>
                        <ProfileRestoreRollbackCleanup
                            state={rollbackState}
                            cleanupRunning={cleanupRunning}
                            onClear={() => {
                                void confirmAndClearRollback();
                            }}
                        />
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}
