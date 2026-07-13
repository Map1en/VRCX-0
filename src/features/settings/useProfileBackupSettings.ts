import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import {
    cancelProfileBackupJob,
    chooseProfileBackupDirectory,
    getProfileBackupDirectory,
    getProfileBackupJobStatus,
    IDLE_PROFILE_BACKUP_JOB_STATUS,
    isProfileBackupJobActive,
    mergeProfileBackupJobStatus,
    PROFILE_BACKUP_JOB_STATUS_EVENT,
    startManualProfileBackup
} from '@/services/profileBackupService';

type ProfileBackupPendingAction = 'directory' | 'start' | 'cancel' | null;

export function useProfileBackupSettings() {
    const [directory, setDirectory] = useState('');
    const [status, setStatus] = useState<ProfileBackupJobStatus>(
        IDLE_PROFILE_BACKUP_JOB_STATUS
    );
    const [loading, setLoading] = useState(true);
    const [pendingAction, setPendingAction] =
        useState<ProfileBackupPendingAction>(null);
    const [error, setError] = useState<unknown>(null);
    const statusRef = useRef(status);

    const applyStatus = useCallback((incoming: ProfileBackupJobStatus) => {
        const merged = mergeProfileBackupJobStatus(statusRef.current, incoming);
        if (merged === statusRef.current) {
            return;
        }
        statusRef.current = merged;
        setStatus(merged);
    }, []);

    useEffect(() => {
        let disposed = false;
        let unsubscribe: (() => void) | null = null;

        void (async () => {
            try {
                unsubscribe =
                    await tauriClient.events.subscribe<ProfileBackupJobStatus>(
                        PROFILE_BACKUP_JOB_STATUS_EVENT,
                        (payload) => {
                            if (!disposed) {
                                applyStatus(payload);
                            }
                        }
                    );
                if (disposed) {
                    unsubscribe();
                    unsubscribe = null;
                    return;
                }
            } catch (subscriptionError) {
                if (!disposed) {
                    setError(subscriptionError);
                }
            }

            try {
                const [storedDirectory, currentStatus] = await Promise.all([
                    getProfileBackupDirectory(),
                    getProfileBackupJobStatus()
                ]);
                if (!disposed) {
                    setDirectory(storedDirectory);
                    applyStatus(currentStatus);
                }
            } catch (loadError) {
                if (!disposed) {
                    setError(loadError);
                }
            } finally {
                if (!disposed) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, [applyStatus]);

    const chooseDirectory = useCallback(async () => {
        if (
            pendingAction !== null ||
            isProfileBackupJobActive(statusRef.current)
        ) {
            return false;
        }
        setError(null);
        setPendingAction('directory');
        try {
            const selected = await chooseProfileBackupDirectory(directory);
            if (selected) {
                setDirectory(selected);
                return true;
            }
            return false;
        } catch (selectionError) {
            setError(selectionError);
            return false;
        } finally {
            setPendingAction(null);
        }
    }, [directory, pendingAction]);

    const startManualBackup = useCallback(async () => {
        if (
            pendingAction !== null ||
            !directory ||
            isProfileBackupJobActive(statusRef.current)
        ) {
            return false;
        }
        setError(null);
        setPendingAction('start');
        try {
            applyStatus(await startManualProfileBackup(directory));
            return true;
        } catch (startError) {
            setError(startError);
            return false;
        } finally {
            setPendingAction(null);
        }
    }, [applyStatus, directory, pendingAction]);

    const cancelBackup = useCallback(async () => {
        const current = statusRef.current;
        if (
            pendingAction !== null ||
            current.state !== 'running' ||
            current.jobId <= 0
        ) {
            return false;
        }
        setError(null);
        setPendingAction('cancel');
        try {
            applyStatus(await cancelProfileBackupJob(current.jobId));
            return true;
        } catch (cancelError) {
            setError(cancelError);
            return false;
        } finally {
            setPendingAction(null);
        }
    }, [applyStatus, pendingAction]);

    return {
        cancelBackup,
        chooseDirectory,
        directory,
        error,
        loading,
        pendingAction,
        startManualBackup,
        status
    };
}
