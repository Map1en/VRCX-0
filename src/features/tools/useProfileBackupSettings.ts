import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { profileBackupErrorKey } from '@/services/profileBackupI18n';
import {
    getProfileBackupSettings,
    runManualProfileBackup,
    setProfileBackupSettings,
    type ProfileBackupSettings
} from '@/services/profileBackupService';
import { selectProfileBackupToRestore } from '@/services/profileRestoreSelectionService';
import {
    openFolderSelectorDialog,
    saveFileSelectorDialog
} from '@/services/shellIntegrationService';
import { useProfileBackupStore } from '@/state/profileBackupStore';

type NumericProfileBackupSetting = 'autoIntervalDays' | 'autoRetainExtra';

function manualBackupDefaultFileName(now: Date): string {
    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('');
    const time = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join('');
    return `VRCX-0-backup-${date}-${time}.vrcx0backup`;
}

function clampInteger(value: unknown, min: number, max: number): number {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
        return min;
    }
    return Math.min(max, Math.max(min, parsed));
}

export function useProfileBackupSettings(enabled: boolean) {
    const { t } = useTranslation();
    const applyStatus = useProfileBackupStore((state) => state.applyStatus);
    const lastOutcome = useProfileBackupStore(
        (state) => state.status.lastOutcome
    );
    const [settings, setSettings] = useState<ProfileBackupSettings | null>(
        null
    );
    const [numericDrafts, setNumericDrafts] = useState<
        Partial<Record<NumericProfileBackupSetting, string>>
    >({});
    const persistedSettingsRef = useRef<ProfileBackupSettings | null>(null);
    const lastRefreshedAutoOutcomeRevisionRef = useRef(-1);
    const settingsRequestRevisionRef = useRef(0);
    const manualBackupRunningRef = useRef(false);
    const autoEnabledTogglingRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [startingManualBackup, setStartingManualBackup] = useState(false);
    const [validatingRestore, setValidatingRestore] = useState(false);

    useEffect(() => {
        setNumericDrafts({});
        if (!enabled) {
            lastRefreshedAutoOutcomeRevisionRef.current = -1;
            return undefined;
        }
        lastRefreshedAutoOutcomeRevisionRef.current =
            useProfileBackupStore.getState().status.lastOutcome?.revision ?? -1;
        let active = true;
        const requestRevision = ++settingsRequestRevisionRef.current;
        setLoading(true);
        getProfileBackupSettings()
            .then((loaded) => {
                if (
                    !active ||
                    requestRevision !== settingsRequestRevisionRef.current
                ) {
                    return;
                }
                persistedSettingsRef.current = loaded;
                setSettings(loaded);
            })
            .catch(() => {
                if (
                    active &&
                    requestRevision === settingsRequestRevisionRef.current
                ) {
                    toast.error(t('profile_backup.settings_load_failed'));
                }
            })
            .finally(() => {
                if (
                    active &&
                    requestRevision === settingsRequestRevisionRef.current
                ) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [enabled, t]);

    useEffect(() => {
        if (
            !enabled ||
            !lastOutcome?.succeeded ||
            lastOutcome.kind !== 'auto' ||
            lastOutcome.revision <= lastRefreshedAutoOutcomeRevisionRef.current
        ) {
            return undefined;
        }
        let active = true;
        const requestRevision = ++settingsRequestRevisionRef.current;
        getProfileBackupSettings()
            .then((loaded) => {
                if (
                    !active ||
                    requestRevision !== settingsRequestRevisionRef.current
                ) {
                    return;
                }
                lastRefreshedAutoOutcomeRevisionRef.current =
                    lastOutcome.revision;
                persistedSettingsRef.current = loaded;
                setSettings(loaded);
            })
            .catch(() => {
                if (
                    active &&
                    requestRevision === settingsRequestRevisionRef.current
                ) {
                    toast.error(t('profile_backup.settings_load_failed'));
                }
            });

        return () => {
            active = false;
        };
    }, [enabled, lastOutcome, t]);

    async function persistSettings(next: ProfileBackupSettings) {
        const previous = persistedSettingsRef.current;
        setSettings(next);
        setSaving(true);
        try {
            const saved = await setProfileBackupSettings(next);
            persistedSettingsRef.current = saved;
            setSettings(saved);
            return true;
        } catch {
            setSettings(previous);
            toast.error(t('profile_backup.settings_save_failed'));
            return false;
        } finally {
            setSaving(false);
        }
    }

    function numericDraftValue(key: NumericProfileBackupSetting): string {
        const draft = numericDrafts[key];
        if (draft !== undefined) {
            return draft;
        }
        if (!settings) {
            return key === 'autoIntervalDays' ? '7' : '3';
        }
        return key === 'autoIntervalDays'
            ? String(settings.autoIntervalDays)
            : String(settings.autoRetainExtra + 1);
    }

    function setNumericDraft(key: NumericProfileBackupSetting, value: string) {
        setNumericDrafts((drafts) => ({ ...drafts, [key]: value }));
    }

    async function commitNumericDraft(key: NumericProfileBackupSetting) {
        const draft = numericDrafts[key];
        if (draft === undefined) {
            return;
        }
        if (!settings || saving) {
            return;
        }
        setNumericDrafts((drafts) => {
            const next = { ...drafts };
            delete next[key];
            return next;
        });
        const next =
            key === 'autoIntervalDays'
                ? { ...settings, autoIntervalDays: clampInteger(draft, 1, 30) }
                : {
                      ...settings,
                      autoRetainExtra: clampInteger(draft, 2, 6) - 1
                  };
        await persistSettings(next);
    }

    async function selectBackupFolder(defaultPath: string): Promise<string> {
        try {
            return await openFolderSelectorDialog(defaultPath);
        } catch {
            toast.error(t('profile_backup.folder_selection_failed'));
            return '';
        }
    }

    async function setAutoEnabled(enabled: boolean) {
        if (
            !settings ||
            saving ||
            enabled === settings.autoEnabled ||
            autoEnabledTogglingRef.current
        ) {
            return;
        }
        autoEnabledTogglingRef.current = true;
        try {
            let nextSettings = settings;
            if (enabled && !settings.autoTargetDir) {
                const selected = await selectBackupFolder('');
                if (!selected) {
                    return;
                }
                nextSettings = { ...settings, autoTargetDir: selected };
            }
            await persistSettings({ ...nextSettings, autoEnabled: enabled });
        } finally {
            autoEnabledTogglingRef.current = false;
        }
    }

    async function chooseAutomaticBackupFolder() {
        if (!settings || saving) {
            return;
        }
        const selected = await selectBackupFolder(settings.autoTargetDir);
        if (!selected) {
            return;
        }
        await persistSettings({ ...settings, autoTargetDir: selected });
    }

    async function startManualBackup() {
        if (
            !settings ||
            startingManualBackup ||
            manualBackupRunningRef.current
        ) {
            return;
        }
        manualBackupRunningRef.current = true;
        setStartingManualBackup(true);
        try {
            const targetPath = await saveFileSelectorDialog(
                settings.autoTargetDir,
                manualBackupDefaultFileName(new Date()),
                '.vrcx0backup',
                `${t('profile_backup.file_filter')} (*.vrcx0backup)|*.vrcx0backup`
            );
            if (!targetPath) {
                return;
            }
            const outcome = await runManualProfileBackup(targetPath);
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
        } catch {
            toast.error(t('profile_backup.backup_start_failed'));
        } finally {
            manualBackupRunningRef.current = false;
            setStartingManualBackup(false);
        }
    }

    async function selectBackupToRestore() {
        if (validatingRestore) {
            return;
        }
        setValidatingRestore(true);
        try {
            await selectProfileBackupToRestore(settings?.autoTargetDir || '');
        } finally {
            setValidatingRestore(false);
        }
    }

    return {
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
    };
}
