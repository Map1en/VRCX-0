import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import {
    acknowledgeProfileRestoreResult,
    chooseProfileRestoreArchive,
    confirmProfileRestore,
    getProfileRestoreState,
    requestProfileRestore,
    requestProfileRollback
} from '@/services/profileRestoreService';
import { useModalStore } from '@/state/modalStore';
import {
    type ProfileRestoreBusyAction,
    useProfileRestoreStore
} from '@/state/profileRestoreStore';

let loadPromise: Promise<void> | null = null;

async function loadRestoreState(): Promise<void> {
    if (loadPromise) {
        return loadPromise;
    }
    const store = useProfileRestoreStore.getState();
    store.setBusy('loading');
    loadPromise = getProfileRestoreState()
        .then((state) => store.applyState(state))
        .catch((error: unknown) => store.setError(error))
        .finally(() => {
            useProfileRestoreStore.getState().setBusy(null);
            loadPromise = null;
        });
    return loadPromise;
}

async function runRestoreAction<T>(
    action: Exclude<ProfileRestoreBusyAction, 'loading' | null>,
    operation: () => Promise<T>,
    apply: (result: T) => void
): Promise<T | null> {
    const store = useProfileRestoreStore.getState();
    if (store.busy !== null) {
        return null;
    }
    store.setBusy(action);
    store.setError(null);
    try {
        const result = await operation();
        apply(result);
        return result;
    } catch (error) {
        useProfileRestoreStore.getState().setError(error);
        throw error;
    } finally {
        useProfileRestoreStore.getState().setBusy(null);
    }
}

export function useProfileRestore() {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const restoreState = useProfileRestoreStore((state) => state.state);
    const loaded = useProfileRestoreStore((state) => state.loaded);
    const busy = useProfileRestoreStore((state) => state.busy);
    const error = useProfileRestoreStore((state) => state.error);

    useEffect(() => {
        if (!loaded) {
            void loadRestoreState();
        }
    }, [loaded]);

    const reportError = useCallback(
        (value: unknown) => {
            toast.error(
                userFacingErrorMessage(
                    value,
                    t('view.settings.general.profile_backup.restore_failed')
                )
            );
        },
        [t]
    );

    const startRestore = useCallback(async () => {
        try {
            const archivePath = await chooseProfileRestoreArchive();
            if (!archivePath) {
                return;
            }
            const confirmation = await confirm({
                title: t(
                    'view.settings.general.profile_backup.restore_confirm_title'
                ),
                description: t(
                    'view.settings.general.profile_backup.restore_confirm_description'
                ),
                confirmText: t(
                    'view.settings.general.profile_backup.restore_confirm_action'
                ),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!confirmation.ok) {
                return;
            }
            const result = await runRestoreAction(
                'restore',
                () => requestProfileRestore(archivePath),
                (request) =>
                    useProfileRestoreStore.getState().applyState(request.state)
            );
            if (result && !result.restartRequested) {
                toast.warning(
                    t(
                        'view.settings.general.profile_backup.restore_restart_manually'
                    )
                );
            }
        } catch (restoreError) {
            reportError(restoreError);
        }
    }, [confirm, reportError, t]);

    const confirmCurrentProfile = useCallback(async () => {
        try {
            await runRestoreAction('confirm', confirmProfileRestore, (state) =>
                useProfileRestoreStore.getState().applyState(state)
            );
        } catch (confirmError) {
            reportError(confirmError);
        }
    }, [reportError]);

    const rollback = useCallback(async () => {
        const confirmation = await confirm({
            title: t(
                'view.settings.general.profile_backup.rollback_confirm_title'
            ),
            description: t(
                'view.settings.general.profile_backup.rollback_confirm_description'
            ),
            confirmText: t(
                'view.settings.general.profile_backup.rollback_confirm_action'
            ),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!confirmation.ok) {
            return;
        }
        try {
            const result = await runRestoreAction(
                'rollback',
                requestProfileRollback,
                (request) =>
                    useProfileRestoreStore.getState().applyState(request.state)
            );
            if (result && !result.restartRequested) {
                toast.warning(
                    t(
                        'view.settings.general.profile_backup.restore_restart_manually'
                    )
                );
            }
        } catch (rollbackError) {
            reportError(rollbackError);
        }
    }, [confirm, reportError, t]);

    const acknowledge = useCallback(async () => {
        try {
            await runRestoreAction(
                'acknowledge',
                acknowledgeProfileRestoreResult,
                (state) => useProfileRestoreStore.getState().applyState(state)
            );
        } catch (acknowledgeError) {
            reportError(acknowledgeError);
        }
    }, [reportError]);

    return {
        acknowledge,
        busy,
        confirmCurrentProfile,
        error,
        loaded,
        refresh: loadRestoreState,
        rollback,
        startRestore,
        state: restoreState
    };
}
