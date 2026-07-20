import type { AppDataDirState } from '@/platform/tauri/bindings';
import { formatDataDirMigrationBytes } from '@/services/dataDirMigrationI18n';
import {
    cleanupMigratedDataDir,
    dismissDataDirCleanup,
    planDataDirMigration
} from '@/services/dataDirMigrationService';
import { promptLegacyVrcxForceMigration } from '@/services/legacyVrcxMigrationService';
import type { IntConfigPreferenceKey } from '@/services/preferencesService';
import {
    deleteAllScreenshotMetadata as deleteAllScreenshotMetadataFromShell,
    getAppDataDirState,
    openFolderSelectorDialog,
    restartApplication
} from '@/services/shellIntegrationService';
import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';
import { normalizeBackgroundModeDelayMinutes } from '@/state/preferencesStore';

import { normalizeCheckedState } from './settingsValues';
import type {
    SettingsActionPrefs,
    useSettingsPreferenceActions
} from './useSettingsPreferenceActions';

type PreferenceAction = () => unknown | Promise<unknown>;
type PreferenceRollback = void | (() => void);
type PreferenceActions = ReturnType<typeof useSettingsPreferenceActions>;
type SettingsPrefs = SettingsActionPrefs;
type StateSetter<Value> = {
    bivarianceHack(
        value: Value | ((current: Value) => Value | Record<string, unknown>)
    ): void;
}['bivarianceHack'];
type SettingsDialogResult = {
    ok: boolean;
    value?: unknown;
};
type SettingsConfirmOptions = {
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
};
type SettingsPromptOptions = SettingsConfirmOptions & {
    inputValue: string;
    pattern?: RegExp;
    errorMessage?: string;
};
type SettingsToast = {
    dismiss(id: unknown): unknown;
    error(message: string): unknown;
    success(message: string): unknown;
    warning(message: string, options?: { duration?: number }): unknown;
};
type SettingsMaintenanceActionsDeps = {
    auth: {
        currentUserId?: unknown;
    };
    commit: (
        action: PreferenceAction,
        optimistic?: () => PreferenceRollback
    ) => Promise<boolean>;
    confirm: (options: SettingsConfirmOptions) => Promise<SettingsDialogResult>;
    databaseMaintenanceRepository: {
        vacuum(): Promise<unknown>;
    };
    feedRepository: {
        purgeAvatarFeedData(
            userId: unknown,
            cutoffDate: string | null
        ): Promise<unknown>;
    };
    gameState: {
        isGameRunning: boolean | null;
    };
    language?: string;
    mediaRepository: {
        cropAllPrints(path: string): Promise<unknown>;
        getUgcPhotoLocation(path: unknown): Promise<string>;
    };
    prefs: SettingsPrefs;
    prompt: (options: SettingsPromptOptions) => Promise<SettingsDialogResult>;
    purgePeriod: string;
    saveBoolPreference: PreferenceActions['saveBoolPreference'];
    savePreferenceValue: PreferenceActions['savePreferenceValue'];
    saveStringPreference: PreferenceActions['saveStringPreference'];
    setAppDataDirState: (value: AppDataDirState | null) => void;
    setCropInstancePrintsPreference: (value: boolean) => Promise<unknown>;
    setIntConfigPreference: (
        key: IntConfigPreferenceKey,
        value: string | number,
        options?: { min?: number; max?: number; fallback?: number }
    ) => Promise<unknown>;
    setPrefs: StateSetter<SettingsPrefs>;
    setPurgeDialogOpen: (value: boolean) => void;
    setPurgeInProgress: (value: boolean) => void;
    setUserGeneratedContentPathPreference: (value: string) => Promise<string>;
    speakNotificationTts: PreferenceActions['speakNotificationTts'];
    t: (key: string, options?: Record<string, unknown>) => string;
    toast: SettingsToast;
};

export function useSettingsMaintenanceActions({
    auth,
    commit,
    confirm,
    databaseMaintenanceRepository,
    feedRepository,
    gameState,
    language,
    mediaRepository,
    prefs,
    prompt,
    purgePeriod,
    saveBoolPreference,
    savePreferenceValue,
    saveStringPreference,
    setAppDataDirState,
    setCropInstancePrintsPreference,
    setIntConfigPreference,
    setPrefs,
    setPurgeDialogOpen,
    setPurgeInProgress,
    setUserGeneratedContentPathPreference,
    speakNotificationTts,
    t,
    toast
}: SettingsMaintenanceActionsDeps) {
    async function saveNotificationTtsMode(value: string) {
        if (prefs.notificationTTS === 'Never' && value !== 'Never') {
            speakNotificationTts(
                t(
                    'view.settings.notifications.notifications.text_to_speech.tts_enabled_preview'
                )
            );
        } else if (value === 'Never') {
            speakNotificationTts('');
        }
        await saveStringPreference('notificationTTS', 'notificationTTS', value);
    }
    async function saveNotificationTtsVoice(value: string) {
        await saveStringPreference(
            'notificationTTSVoiceNative',
            'notificationTTSVoiceNative',
            value
        );
        speakNotificationTts(
            t(
                'view.settings.notifications.notifications.text_to_speech.tts_voice_preview'
            ),
            value
        );
    }
    async function deleteAllScreenshotMetadata() {
        const result = await confirm({
            title: t(
                'view.settings.advanced.advanced.delete_all_screenshot_metadata.button'
            ),
            description: t(
                'view.settings.advanced.advanced.delete_all_screenshot_metadata.ask'
            ),
            confirmText: t(
                'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm_yes'
            ),
            cancelText: t(
                'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm_no'
            ),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        await deleteAllScreenshotMetadataFromShell();
        toast.success(t('view.settings.success.screenshot_metadata_removed'));
    }
    async function refreshAppDataDirState() {
        try {
            const state = await getAppDataDirState();
            setAppDataDirState(state);
            return state;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
            return null;
        }
    }
    async function openAppDataDirSelector() {
        const state = await refreshAppDataDirState();
        if (!state) {
            return;
        }
        if (state?.cliOverride) {
            toast.error(
                t('view.settings.advanced.advanced.data_directory.cli_override')
            );
            return;
        }
        const selectedPath = await openFolderSelectorDialog(
            state?.persistedDir || state?.currentDir || state?.defaultDir || ''
        ).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
            return '';
        });
        if (!selectedPath) {
            return;
        }
        try {
            const plan = await planDataDirMigration(selectedPath);
            useDataDirMigrationStore.getState().openDialog(plan);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
    async function resetAppDataDir() {
        const state = await refreshAppDataDirState();
        if (!state) {
            return;
        }
        if (state?.cliOverride) {
            toast.error(
                t('view.settings.advanced.advanced.data_directory.cli_override')
            );
            return;
        }
        try {
            const plan = await planDataDirMigration(state.defaultDir);
            useDataDirMigrationStore.getState().openDialog(plan);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
    async function cleanupAppDataDir() {
        const state = await refreshAppDataDirState();
        const pending = state?.cleanupPending;
        if (!pending) {
            return;
        }
        const result = await confirm({
            title: t('data_dir_migration.cleanup.confirm_title'),
            description: t('data_dir_migration.cleanup.confirm_description', {
                path: pending.oldDir,
                size: formatDataDirMigrationBytes(
                    pending.bytes,
                    language ?? 'en'
                )
            }),
            confirmText: t('data_dir_migration.cleanup.action'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await cleanupMigratedDataDir();
            await refreshAppDataDirState();
            toast.success(t('data_dir_migration.cleanup.completed'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
    async function dismissAppDataDirCleanup() {
        try {
            await dismissDataDirCleanup();
            await refreshAppDataDirState();
            toast.success(t('data_dir_migration.cleanup.dismissed'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
    async function promptAutoLoginDelaySeconds() {
        const result = await prompt({
            title: t('prompt.auto_login_delay.header'),
            description: t('prompt.auto_login_delay.description'),
            inputValue: String(prefs.autoLoginDelaySeconds ?? 0),
            pattern: /^(10|[0-9])$/,
            errorMessage: t('prompt.auto_login_delay.input_error')
        });
        if (!result.ok) {
            return;
        }
        const seconds = Math.min(
            10,
            Math.max(0, Number.parseInt(String(result.value), 10) || 0)
        );
        await savePreferenceValue('autoLoginDelaySeconds', seconds, () =>
            setIntConfigPreference('autoLoginDelaySeconds', seconds, {
                min: 0,
                max: 10,
                fallback: 0
            })
        );
    }

    async function promptBackgroundModeDelayMinutes() {
        const currentMinutes = normalizeBackgroundModeDelayMinutes(
            prefs.backgroundModeDelayMinutes
        );
        const result = await prompt({
            title: t('prompt.background_mode_delay.header'),
            description: t('prompt.background_mode_delay.description'),
            inputValue: String(currentMinutes),
            pattern: /^\d+$/,
            errorMessage: t('prompt.background_mode_delay.input_error')
        });
        if (!result.ok) {
            return;
        }
        const minutes = normalizeBackgroundModeDelayMinutes(result.value);
        await savePreferenceValue('backgroundModeDelayMinutes', minutes, () =>
            setIntConfigPreference('backgroundModeDelayMinutes', minutes, {
                min: 10,
                max: 600,
                fallback: 60
            })
        );
    }

    async function resetUgcFolder() {
        await commit(
            () => setUserGeneratedContentPathPreference(''),
            () => {
                const previous = prefs.userGeneratedContentPath;
                setPrefs((current) => ({
                    ...current,
                    userGeneratedContentPath: ''
                }));
                return () =>
                    setPrefs((current) => ({
                        ...current,
                        userGeneratedContentPath: previous
                    }));
            }
        );
    }
    async function purgeAvatarFeedData() {
        const cutoffDate =
            purgePeriod === 'all'
                ? null
                : (() => {
                      const cutoff = new Date();
                      cutoff.setDate(
                          cutoff.getDate() - Number.parseInt(purgePeriod, 10)
                      );
                      return cutoff.toJSON();
                  })();
        setPurgeInProgress(true);
        const toastId = toast.warning(
            t(
                'view.settings.advanced.advanced.database_cleanup.purge_in_progress'
            ),
            {
                duration: Infinity
            }
        );
        try {
            await feedRepository.purgeAvatarFeedData(
                auth.currentUserId,
                cutoffDate
            );
            await databaseMaintenanceRepository.vacuum();
            toast.dismiss(toastId);
            toast.success(
                t(
                    'view.settings.advanced.advanced.database_cleanup.purge_complete'
                )
            );
            setPurgeDialogOpen(false);
            await new Promise<void>((resolve) =>
                window.setTimeout(resolve, 1500)
            );
            await restartApplication();
        } catch (error) {
            toast.dismiss(toastId);
            toast.error(
                t(
                    'view.settings.advanced.advanced.database_cleanup.purge_failed',
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                )
            );
        } finally {
            setPurgeInProgress(false);
        }
    }
    async function migrateLegacyVrcxData() {
        await promptLegacyVrcxForceMigration({ confirm, t, toast });
    }
    async function openUgcFolderSelector() {
        const selectedPath = await openFolderSelectorDialog(
            prefs.userGeneratedContentPath || ''
        ).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
            return '';
        });
        if (!selectedPath) {
            return;
        }
        await savePreferenceValue(
            'userGeneratedContentPath',
            selectedPath,
            () => setUserGeneratedContentPathPreference(selectedPath)
        );
    }
    async function promptCropExistingPrints() {
        const result = await confirm({
            title: t('view.settings.modal.crop_existing_prints'),
            description: t(
                'view.settings.modal.crop_already_saved_instance_prints_in_the_config'
            ),
            confirmText: t('view.settings.modal.crop_prints'),
            cancelText: t('view.settings.modal.skip')
        });
        if (!result.ok) {
            return;
        }
        const ugcFolderPath = await mediaRepository.getUgcPhotoLocation(
            prefs.userGeneratedContentPath
        );
        await mediaRepository.cropAllPrints(ugcFolderPath);
        toast.success(t('view.settings.label.existing_saved_prints_cropped'));
    }
    async function handleCropInstancePrintsChange(checked: unknown) {
        const enabled = normalizeCheckedState(checked);
        const saved = await commit(
            () => setCropInstancePrintsPreference(enabled),
            () => {
                setPrefs((current) => ({
                    ...current,
                    cropInstancePrints: enabled
                }));
                return () =>
                    setPrefs((current) => ({
                        ...current,
                        cropInstancePrints: !enabled
                    }));
            }
        );
        if (saved && enabled) {
            await promptCropExistingPrints().catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.settings.toast.failed_to_crop_existing_prints'
                          )
                );
            });
        }
    }
    async function handleGameLogDisabledChange(checked: unknown) {
        const enabled = normalizeCheckedState(checked);
        if (gameState.isGameRunning) {
            toast.error(t('message.gamelog.vrchat_must_be_closed'));
            return;
        }
        if (enabled) {
            const result = await confirm({
                title: t('confirm.title'),
                description: t('confirm.disable_gamelog')
            });
            if (!result.ok) {
                return;
            }
        }
        await saveBoolPreference(
            'gameLogDisabled',
            'VRCX_gameLogDisabled',
            enabled
        );
    }
    return {
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        deleteAllScreenshotMetadata,
        cleanupAppDataDir,
        dismissAppDataDirCleanup,
        openAppDataDirSelector,
        resetAppDataDir,
        promptAutoLoginDelaySeconds,
        promptBackgroundModeDelayMinutes,
        resetUgcFolder,
        purgeAvatarFeedData,
        openUgcFolderSelector,
        handleCropInstancePrintsChange,
        handleGameLogDisabledChange,
        migrateLegacyVrcxData
    };
}
