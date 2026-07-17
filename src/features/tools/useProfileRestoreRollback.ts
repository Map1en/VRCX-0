import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { profileRestoreRollbackErrorKey } from '@/services/profileBackupI18n';
import {
    clearProfileRestoreRollback,
    getProfileRestoreRollbackState,
    type ProfileRestoreRollbackState
} from '@/services/profileBackupService';
import { useModalStore } from '@/state/modalStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';

export const PROFILE_RESTORE_ROLLBACK_TOAST_ID =
    'profile-restore-rollback-retained';

export function useProfileRestoreRollback() {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const rollbackState = useProfileBackupStore(
        (state) => state.restoreRollbackState
    );
    const cleanupRunning = useProfileBackupStore(
        (state) => state.restoreRollbackCleanupRunning
    );
    const beginStateRefresh = useProfileBackupStore(
        (state) => state.beginRestoreRollbackStateRefresh
    );
    const completeStateRefresh = useProfileBackupStore(
        (state) => state.completeRestoreRollbackStateRefresh
    );
    const setRollbackState = useProfileBackupStore(
        (state) => state.setRestoreRollbackState
    );
    const beginCleanup = useProfileBackupStore(
        (state) => state.beginRestoreRollbackCleanup
    );
    const finishCleanup = useProfileBackupStore(
        (state) => state.finishRestoreRollbackCleanup
    );

    const refreshRollbackState =
        useCallback(async (): Promise<ProfileRestoreRollbackState | null> => {
            const revision = beginStateRefresh();
            try {
                const state = await getProfileRestoreRollbackState();
                if (completeStateRefresh(revision, state)) {
                    return state;
                }
                return (
                    useProfileBackupStore.getState().restoreRollbackState ??
                    state
                );
            } catch {
                completeStateRefresh(revision, null);
                return null;
            }
        }, [beginStateRefresh, completeStateRefresh]);

    const confirmAndClearRollback = useCallback(async (): Promise<void> => {
        if (!beginCleanup()) {
            return;
        }
        try {
            const result = await confirm({
                title: t('profile_backup.rollback_cleanup_confirm_title'),
                description: t(
                    'profile_backup.rollback_cleanup_confirm_description'
                ),
                confirmText: t('profile_backup.clear_rollback'),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
            try {
                const outcome = await clearProfileRestoreRollback();
                setRollbackState(outcome.state);
                if (!outcome.accepted) {
                    toast.error(
                        t(
                            outcome.error
                                ? profileRestoreRollbackErrorKey(
                                      outcome.error.code
                                  )
                                : 'profile_backup.rollback_error.io'
                        )
                    );
                    return;
                }
                toast.dismiss(PROFILE_RESTORE_ROLLBACK_TOAST_ID);
                toast.success(t('profile_backup.rollback_cleanup_succeeded'));
            } catch {
                toast.error(t('profile_backup.rollback_error.io'));
            }
        } finally {
            finishCleanup();
        }
    }, [beginCleanup, confirm, finishCleanup, setRollbackState, t]);

    return {
        rollbackState,
        cleanupRunning,
        refreshRollbackState,
        confirmAndClearRollback
    };
}
