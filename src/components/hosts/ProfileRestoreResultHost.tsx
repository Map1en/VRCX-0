import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    PROFILE_RESTORE_ROLLBACK_TOAST_ID,
    useProfileRestoreRollback
} from '@/features/tools/useProfileRestoreRollback';
import { profileRestoreFailureKey } from '@/services/profileBackupI18n';
import { takeLastProfileRestoreResult } from '@/services/profileBackupService';
import { useProfileBackupStore } from '@/state/profileBackupStore';
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

export function ProfileRestoreResultHost() {
    const { t } = useTranslation();
    const backendRuntimeSnapshotHydrated = useRuntimeStore(
        (state) => state.shell.backendRuntimeSnapshotHydrated
    );
    const restoreResult = useProfileBackupStore(
        (state) => state.startupRestoreResult
    );
    const beginRestoreResultCheck = useProfileBackupStore(
        (state) => state.beginStartupRestoreResultCheck
    );
    const setRestoreResult = useProfileBackupStore(
        (state) => state.setStartupRestoreResult
    );
    const clearRestoreResult = useProfileBackupStore(
        (state) => state.clearStartupRestoreResult
    );
    const { refreshRollbackState, confirmAndClearRollback } =
        useProfileRestoreRollback();

    useEffect(() => {
        if (!backendRuntimeSnapshotHydrated || !beginRestoreResultCheck()) {
            return;
        }
        void takeLastProfileRestoreResult()
            .then((result) => {
                if (!result) {
                    return;
                }
                if (result.status === 'succeeded') {
                    void refreshRollbackState().then((rollbackState) => {
                        if (
                            rollbackState &&
                            rollbackState.count > 0 &&
                            rollbackState.cleanupAllowed
                        ) {
                            toast.success(
                                t('profile_backup.restore_completed'),
                                {
                                    id: PROFILE_RESTORE_ROLLBACK_TOAST_ID,
                                    description: t(
                                        'profile_backup.rollback_retained_description'
                                    ),
                                    duration: Infinity,
                                    position: 'bottom-right',
                                    closeButton: true,
                                    action: {
                                        label: t(
                                            'profile_backup.clear_rollback'
                                        ),
                                        onClick: (event) => {
                                            event.preventDefault();
                                            void confirmAndClearRollback();
                                        }
                                    }
                                }
                            );
                            return;
                        }
                        toast.success(t('profile_backup.restore_succeeded'), {
                            description: result.sourceFileName || undefined
                        });
                    });
                    return;
                }
                setRestoreResult(result);
            })
            .catch(() => {
                console.warn('Failed to read the profile restore result.');
            });
    }, [
        backendRuntimeSnapshotHydrated,
        beginRestoreResultCheck,
        confirmAndClearRollback,
        refreshRollbackState,
        setRestoreResult,
        t
    ]);

    const failedResult =
        restoreResult?.status === 'failed' ? restoreResult : null;

    const dispositionKey =
        failedResult?.dataDisposition === 'rolledBack'
            ? 'profile_backup.restore_failed_rolled_back'
            : 'profile_backup.restore_failed_unchanged';
    const failureKey = failedResult?.failure
        ? profileRestoreFailureKey(failedResult.failure.code)
        : 'profile_backup.restore_failure.unknown';

    return (
        <AlertDialog
            open={Boolean(failedResult)}
            onOpenChange={(open) => {
                if (!open) {
                    clearRestoreResult();
                }
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t('profile_backup.restore_failed_title')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t(dispositionKey)}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="bg-muted/30 space-y-2 rounded-md border p-3 text-sm">
                    <p>{t(failureKey)}</p>
                    {failedResult?.sourceFileName ? (
                        <p className="text-muted-foreground break-all">
                            {failedResult.sourceFileName}
                        </p>
                    ) : null}
                </div>
                <AlertDialogFooter>
                    <Button type="button" onClick={clearRestoreResult}>
                        {t('common.actions.close')}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
