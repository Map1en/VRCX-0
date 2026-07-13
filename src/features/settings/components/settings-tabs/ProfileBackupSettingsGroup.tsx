import {
    ArchiveIcon,
    FolderOpenIcon,
    TriangleAlertIcon,
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type {
    ProfileBackupJobState,
    ProfileBackupStage
} from '@/platform/tauri/bindings';
import {
    isProfileBackupJobActive,
    PROFILE_BACKUP_INTERVAL_DAYS_MAX,
    PROFILE_BACKUP_INTERVAL_DAYS_MIN,
    PROFILE_BACKUP_RETENTION_COUNT_MAX,
    PROFILE_BACKUP_RETENTION_COUNT_MIN,
    profileBackupOverallPercent,
    profileBackupPhasePercent
} from '@/services/profileBackupService';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Progress } from '@/ui/shadcn/progress';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

import { useProfileBackupSettings } from '../../useProfileBackupSettings';
import { Field, SettingsGroup } from '../SettingsField';

const STATUS_LABEL_KEYS: Record<ProfileBackupJobState, string> = {
    idle: 'view.settings.general.profile_backup.status_idle',
    running: 'view.settings.general.profile_backup.status_running',
    cancelling: 'view.settings.general.profile_backup.status_cancelling',
    completed: 'view.settings.general.profile_backup.status_completed',
    failed: 'view.settings.general.profile_backup.status_failed',
    cancelled: 'view.settings.general.profile_backup.status_cancelled'
};

const STAGE_LABEL_KEYS: Record<ProfileBackupStage, string> = {
    databaseSnapshot:
        'view.settings.general.profile_backup.stage_database_snapshot',
    hashing: 'view.settings.general.profile_backup.stage_hashing',
    packaging: 'view.settings.general.profile_backup.stage_packaging',
    validating: 'view.settings.general.profile_backup.stage_validating',
    publishing: 'view.settings.general.profile_backup.stage_publishing'
};

export function ProfileBackupSettingsGroup() {
    const { t } = useTranslation();
    const {
        automatic,
        cancelBackup,
        chooseDirectory,
        directory,
        error,
        loading,
        pendingAction,
        setAutomaticEnabled,
        setAutomaticIntervalDays,
        setAutomaticRetentionCount,
        startManualBackup,
        status
    } = useProfileBackupSettings();
    const active = isProfileBackupJobActive(status);
    const phasePercent = profileBackupPhasePercent(status.progress);
    const overallPercent = profileBackupOverallPercent(status.progress);
    const kindLabel = status.kind
        ? t(
              status.kind === 'automatic'
                  ? 'view.settings.general.profile_backup.kind_automatic'
                  : 'view.settings.general.profile_backup.kind_manual'
          )
        : '';
    const stateLabel = status.progress
        ? `${t(STAGE_LABEL_KEYS[status.progress.stage])} · ${phasePercent}%`
        : t(STATUS_LABEL_KEYS[status.state]);
    const statusLabel = kindLabel ? `${kindLabel} · ${stateLabel}` : stateLabel;
    const visibleError = error ?? status.lastError;
    const failedMessage = userFacingErrorMessage(
        visibleError,
        t('view.settings.general.profile_backup.action_failed')
    );

    return (
        <SettingsGroup
            title={t('view.settings.general.profile_backup.header')}
            description={t('view.settings.general.profile_backup.description')}
        >
            <Alert>
                <TriangleAlertIcon />
                <AlertTitle>
                    {t('view.settings.general.profile_backup.warning_title')}
                </AlertTitle>
                <AlertDescription>
                    {t(
                        'view.settings.general.profile_backup.warning_description'
                    )}
                </AlertDescription>
            </Alert>
            <Field
                label={t('view.settings.general.profile_backup.directory')}
                description={t(
                    'view.settings.general.profile_backup.directory_description'
                )}
                disabled={loading || active}
                controlClassName="min-w-0"
            >
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    <code
                        className="text-muted-foreground min-w-0 flex-1 truncate text-right text-xs"
                        title={directory || undefined}
                    >
                        {directory ||
                            t(
                                'view.settings.general.profile_backup.directory_empty'
                            )}
                    </code>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading || active || pendingAction !== null}
                        onClick={() => void chooseDirectory()}
                    >
                        {pendingAction === 'directory' ? (
                            <Spinner />
                        ) : (
                            <FolderOpenIcon data-icon="inline-start" />
                        )}
                        {t(
                            'view.settings.general.profile_backup.choose_directory'
                        )}
                    </Button>
                </div>
            </Field>
            <Field
                label={t('view.settings.general.profile_backup.manual')}
                description={t(
                    'view.settings.general.profile_backup.manual_description'
                )}
                controlClassName="min-w-0"
            >
                <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Badge
                            variant={
                                status.state === 'failed'
                                    ? 'destructive'
                                    : 'outline'
                            }
                            aria-live="polite"
                        >
                            {statusLabel}
                        </Badge>
                        {active ? (
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={
                                    status.state === 'cancelling' ||
                                    pendingAction !== null
                                }
                                onClick={() => void cancelBackup()}
                            >
                                {pendingAction === 'cancel' ? (
                                    <Spinner />
                                ) : (
                                    <XIcon data-icon="inline-start" />
                                )}
                                {t(
                                    'view.settings.general.profile_backup.cancel'
                                )}
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="sm"
                                disabled={
                                    loading ||
                                    !directory ||
                                    pendingAction !== null
                                }
                                onClick={() => void startManualBackup()}
                            >
                                {pendingAction === 'start' ? (
                                    <Spinner />
                                ) : (
                                    <ArchiveIcon data-icon="inline-start" />
                                )}
                                {t(
                                    'view.settings.general.profile_backup.backup_now'
                                )}
                            </Button>
                        )}
                    </div>
                    {active ? (
                        <Progress
                            value={overallPercent}
                            aria-label={statusLabel}
                        />
                    ) : null}
                    {status.result?.path ? (
                        <code
                            className="text-muted-foreground truncate text-right text-xs"
                            title={status.result.path}
                        >
                            {status.result.path}
                        </code>
                    ) : null}
                    {visibleError ? (
                        <p
                            className="text-destructive text-right text-xs"
                            role="alert"
                        >
                            {failedMessage}
                        </p>
                    ) : null}
                </div>
            </Field>
            <Field
                label={t(
                    'view.settings.general.profile_backup.automatic_enabled'
                )}
                description={t(
                    'view.settings.general.profile_backup.automatic_enabled_description'
                )}
                disabled={loading}
            >
                <Switch
                    checked={automatic.enabled}
                    aria-label={t(
                        'view.settings.general.profile_backup.automatic_enabled'
                    )}
                    disabled={
                        loading ||
                        pendingAction !== null ||
                        (!directory && !automatic.enabled)
                    }
                    onCheckedChange={(checked) =>
                        void setAutomaticEnabled(Boolean(checked))
                    }
                />
            </Field>
            <Field
                label={t(
                    'view.settings.general.profile_backup.automatic_interval'
                )}
                description={t(
                    'view.settings.general.profile_backup.automatic_interval_description'
                )}
                disabled={loading || !automatic.enabled}
            >
                <div className="flex items-center gap-2">
                    <Input
                        key={`interval-${automatic.intervalDays}`}
                        type="number"
                        min={PROFILE_BACKUP_INTERVAL_DAYS_MIN}
                        max={PROFILE_BACKUP_INTERVAL_DAYS_MAX}
                        defaultValue={automatic.intervalDays}
                        disabled={
                            loading ||
                            !automatic.enabled ||
                            pendingAction !== null
                        }
                        className="w-20"
                        aria-label={t(
                            'view.settings.general.profile_backup.automatic_interval'
                        )}
                        onBlur={(event) => {
                            const value = Number(event.currentTarget.value);
                            if (
                                Number.isInteger(value) &&
                                value >= PROFILE_BACKUP_INTERVAL_DAYS_MIN &&
                                value <= PROFILE_BACKUP_INTERVAL_DAYS_MAX
                            ) {
                                void setAutomaticIntervalDays(value);
                            } else {
                                event.currentTarget.value = String(
                                    automatic.intervalDays
                                );
                            }
                        }}
                    />
                    <span className="text-muted-foreground text-sm">
                        {t(
                            'view.settings.general.profile_backup.automatic_interval_unit'
                        )}
                    </span>
                </div>
            </Field>
            <Field
                label={t(
                    'view.settings.general.profile_backup.automatic_retention'
                )}
                description={t(
                    'view.settings.general.profile_backup.automatic_retention_description'
                )}
                disabled={loading || !automatic.enabled}
            >
                <div className="flex items-center gap-2">
                    <Input
                        key={`retention-${automatic.retentionCount}`}
                        type="number"
                        min={PROFILE_BACKUP_RETENTION_COUNT_MIN}
                        max={PROFILE_BACKUP_RETENTION_COUNT_MAX}
                        defaultValue={automatic.retentionCount}
                        disabled={
                            loading ||
                            !automatic.enabled ||
                            pendingAction !== null
                        }
                        className="w-20"
                        aria-label={t(
                            'view.settings.general.profile_backup.automatic_retention'
                        )}
                        onBlur={(event) => {
                            const value = Number(event.currentTarget.value);
                            if (
                                Number.isInteger(value) &&
                                value >= PROFILE_BACKUP_RETENTION_COUNT_MIN &&
                                value <= PROFILE_BACKUP_RETENTION_COUNT_MAX
                            ) {
                                void setAutomaticRetentionCount(value);
                            } else {
                                event.currentTarget.value = String(
                                    automatic.retentionCount
                                );
                            }
                        }}
                    />
                    <span className="text-muted-foreground text-sm">
                        {t(
                            'view.settings.general.profile_backup.automatic_retention_unit'
                        )}
                    </span>
                </div>
            </Field>
            <Field
                label={t('view.settings.general.profile_backup.last_automatic')}
                description={t(
                    'view.settings.general.profile_backup.last_automatic_description'
                )}
            >
                {automatic.lastAutomaticAt ? (
                    <time
                        className="text-muted-foreground text-sm"
                        dateTime={automatic.lastAutomaticAt}
                        title={automatic.lastAutomaticAt}
                    >
                        {new Date(automatic.lastAutomaticAt).toLocaleString()}
                    </time>
                ) : (
                    <span className="text-muted-foreground text-sm">
                        {t(
                            'view.settings.general.profile_backup.last_automatic_never'
                        )}
                    </span>
                )}
            </Field>
        </SettingsGroup>
    );
}
