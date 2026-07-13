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
    profileBackupOverallPercent,
    profileBackupPhasePercent
} from '@/services/profileBackupService';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Progress } from '@/ui/shadcn/progress';
import { Spinner } from '@/ui/shadcn/spinner';

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
        cancelBackup,
        chooseDirectory,
        directory,
        error,
        loading,
        pendingAction,
        startManualBackup,
        status
    } = useProfileBackupSettings();
    const active = isProfileBackupJobActive(status);
    const phasePercent = profileBackupPhasePercent(status.progress);
    const overallPercent = profileBackupOverallPercent(status.progress);
    const statusLabel = status.progress
        ? `${t(STAGE_LABEL_KEYS[status.progress.stage])} · ${phasePercent}%`
        : t(STATUS_LABEL_KEYS[status.state]);
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
        </SettingsGroup>
    );
}
