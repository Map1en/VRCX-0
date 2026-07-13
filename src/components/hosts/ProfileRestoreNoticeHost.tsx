import { CheckCircle2Icon, RotateCcwIcon, ShieldAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProfileRestore } from '@/features/profile-restore/useProfileRestore';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { ProfileRestoreStatus } from '@/platform/tauri/bindings';
import {
    Alert,
    AlertAction,
    AlertDescription,
    AlertTitle
} from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

const STATUS_TITLE_KEYS: Record<ProfileRestoreStatus, string> = {
    idle: 'view.settings.general.profile_backup.restore_status_idle',
    pendingRestore:
        'view.settings.general.profile_backup.restore_status_pending_restore',
    restoredAwaitingConfirmation:
        'view.settings.general.profile_backup.restore_status_awaiting_confirmation',
    pendingRollback:
        'view.settings.general.profile_backup.restore_status_pending_rollback',
    restoreFailedRolledBack:
        'view.settings.general.profile_backup.restore_status_failed_rolled_back',
    rollbackCompleted:
        'view.settings.general.profile_backup.restore_status_rollback_completed',
    blocked: 'view.settings.general.profile_backup.restore_status_blocked'
};

export function ProfileRestoreNoticeHost() {
    const { t } = useTranslation();
    const {
        acknowledge,
        busy,
        confirmCurrentProfile,
        error,
        loaded,
        rollback,
        state
    } = useProfileRestore();

    if (!loaded || state.status === 'idle') {
        return null;
    }

    const destructive =
        state.status === 'blocked' ||
        state.status === 'restoreFailedRolledBack';
    const description =
        state.message ||
        (state.requiresRestart
            ? t('view.settings.general.profile_backup.restore_restart_manually')
            : t(
                  'view.settings.general.profile_backup.restore_notice_description'
              ));
    const visibleError = error
        ? userFacingErrorMessage(
              error,
              t('view.settings.general.profile_backup.restore_failed')
          )
        : null;

    return (
        <div className="pointer-events-none fixed top-3 left-1/2 z-[80] w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2">
            <Alert
                variant={destructive ? 'destructive' : 'default'}
                className="bg-card/95 pointer-events-auto shadow-lg backdrop-blur"
                aria-live="polite"
            >
                {state.status === 'restoredAwaitingConfirmation' ? (
                    <CheckCircle2Icon />
                ) : state.status === 'pendingRollback' ||
                  state.status === 'rollbackCompleted' ? (
                    <RotateCcwIcon />
                ) : (
                    <ShieldAlertIcon />
                )}
                <AlertTitle>{t(STATUS_TITLE_KEYS[state.status])}</AlertTitle>
                <AlertDescription>
                    {description}
                    {visibleError ? ` ${visibleError}` : ''}
                </AlertDescription>
                {state.canConfirm ||
                state.canRollback ||
                state.canAcknowledge ? (
                    <AlertAction className="static col-span-full mt-2 flex flex-wrap justify-end gap-2">
                        {state.canRollback ? (
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => void rollback()}
                            >
                                {busy === 'rollback' ? <Spinner /> : null}
                                {t(
                                    'view.settings.general.profile_backup.rollback_now'
                                )}
                            </Button>
                        ) : null}
                        {state.canConfirm ? (
                            <Button
                                type="button"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => void confirmCurrentProfile()}
                            >
                                {busy === 'confirm' ? <Spinner /> : null}
                                {t(
                                    'view.settings.general.profile_backup.confirm_restored_profile'
                                )}
                            </Button>
                        ) : null}
                        {state.canAcknowledge ? (
                            <Button
                                type="button"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => void acknowledge()}
                            >
                                {busy === 'acknowledge' ? <Spinner /> : null}
                                {t('common.actions.confirm')}
                            </Button>
                        ) : null}
                    </AlertAction>
                ) : null}
            </Alert>
        </div>
    );
}
