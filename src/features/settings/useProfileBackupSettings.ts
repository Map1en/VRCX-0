import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import {
    type AutomaticProfileBackupSettings,
    cancelProfileBackupJob,
    chooseProfileBackupDirectory,
    getProfileBackupJobStatus,
    getProfileBackupSettings,
    IDLE_PROFILE_BACKUP_JOB_STATUS,
    isProfileBackupJobActive,
    mergeProfileBackupJobStatus,
    PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT,
    PROFILE_BACKUP_JOB_STATUS_EVENT,
    PROFILE_BACKUP_RETENTION_COUNT_DEFAULT,
    setAutomaticProfileBackupEnabled,
    setAutomaticProfileBackupIntervalDays,
    setAutomaticProfileBackupRetentionCount,
    startManualProfileBackup
} from '@/services/profileBackupService';

type ProfileBackupPendingAction =
    | 'directory'
    | 'start'
    | 'cancel'
    | 'automatic'
    | 'interval'
    | 'retention'
    | null;

const DEFAULT_AUTOMATIC_SETTINGS: AutomaticProfileBackupSettings = {
    enabled: false,
    intervalDays: PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT,
    retentionCount: PROFILE_BACKUP_RETENTION_COUNT_DEFAULT,
    lastAutomaticAt: ''
};

export function useProfileBackupSettings() {
    const [directory, setDirectory] = useState('');
    const [automatic, setAutomatic] = useState<AutomaticProfileBackupSettings>(
        DEFAULT_AUTOMATIC_SETTINGS
    );
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
        if (
            incoming.kind === 'automatic' &&
            incoming.state === 'completed' &&
            incoming.result?.manifest.createdAt
        ) {
            setAutomatic((current) => ({
                ...current,
                lastAutomaticAt: incoming.result?.manifest.createdAt ?? ''
            }));
        }
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
                const [settings, currentStatus] = await Promise.all([
                    getProfileBackupSettings(),
                    getProfileBackupJobStatus()
                ]);
                if (!disposed) {
                    setDirectory(settings.directory);
                    setAutomatic(settings.automatic);
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

    const setAutomaticEnabled = useCallback(
        async (enabled: boolean) => {
            if (pendingAction !== null || (enabled && !directory)) {
                if (enabled && !directory) {
                    setError(
                        new Error(
                            'Choose a backup directory before enabling automatic backups.'
                        )
                    );
                }
                return false;
            }
            setError(null);
            setPendingAction('automatic');
            try {
                await setAutomaticProfileBackupEnabled(enabled);
                setAutomatic((current) => ({ ...current, enabled }));
                return true;
            } catch (automaticError) {
                setError(automaticError);
                return false;
            } finally {
                setPendingAction(null);
            }
        },
        [directory, pendingAction]
    );

    const setAutomaticIntervalDays = useCallback(
        async (intervalDays: number) => {
            if (pendingAction !== null) {
                return false;
            }
            setError(null);
            setPendingAction('interval');
            try {
                const savedIntervalDays =
                    await setAutomaticProfileBackupIntervalDays(intervalDays);
                setAutomatic((current) => ({
                    ...current,
                    intervalDays: savedIntervalDays
                }));
                return true;
            } catch (intervalError) {
                setError(intervalError);
                return false;
            } finally {
                setPendingAction(null);
            }
        },
        [pendingAction]
    );

    const setAutomaticRetentionCount = useCallback(
        async (retentionCount: number) => {
            if (pendingAction !== null) {
                return false;
            }
            setError(null);
            setPendingAction('retention');
            try {
                const savedRetentionCount =
                    await setAutomaticProfileBackupRetentionCount(
                        retentionCount
                    );
                setAutomatic((current) => ({
                    ...current,
                    retentionCount: savedRetentionCount
                }));
                return true;
            } catch (retentionError) {
                setError(retentionError);
                return false;
            } finally {
                setPendingAction(null);
            }
        },
        [pendingAction]
    );

    return {
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
    };
}
