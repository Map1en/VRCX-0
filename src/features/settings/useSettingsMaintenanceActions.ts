import { assetBundleRepository } from '@/repositories/assetBundleRepository';
import {
    clearFavoriteRemoteDetailsCache,
    getFavoriteRemoteDetailsCacheStats
} from '@/services/favoriteRemoteDetailsCacheService';
import { promptLegacyVrcxForceMigration } from '@/services/legacyVrcxMigrationService';
import {
    clearAppDataDir,
    deleteAllScreenshotMetadata as deleteAllScreenshotMetadataFromShell,
    getAppDataDirState,
    openFolderSelectorDialog,
    restartApplication,
    setAppDataDir,
    validateAppDataDir
} from '@/services/shellIntegrationService';

import { normalizeCheckedState } from './settingsValues';

export function useSettingsMaintenanceActions({
    auth,
    avatarProfileRepository,
    clearEntityQueryCache,
    commit,
    configRepository,
    confirm,
    databaseMaintenanceRepository,
    feedRepository,
    formatByteSize,
    gameState,
    getEntityQueryCacheSize,
    getEntityQueryCacheStats,
    mediaRepository,
    normalizeSharedFeedFilters,
    prefs,
    prompt,
    purgePeriod,
    saveBoolPreference,
    savePreferenceValue,
    saveStringPreference,
    setCacheStats,
    setCacheStatsVisible,
    setAppDataDirState,
    setCropInstancePrintsPreference,
    setIntConfigPreference,
    setPrefs,
    setPurgeDialogOpen,
    setPurgeInProgress,
    setSharedFeedFilters,
    setSharedFeedFiltersPreference,
    setUserGeneratedContentPathPreference,
    sharedFeedFilters,
    sharedFeedFiltersDefaults,
    speakNotificationTts,
    t,
    toast,
    useRuntimeStore
}: any) {
    async function saveNotificationTtsMode(value: any) {
        if (prefs.notificationTTS === 'Never' && value !== 'Never') {
            speakNotificationTts('Notification text-to-speech enabled');
        } else if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        await saveStringPreference('notificationTTS', 'notificationTTS', value);
    }
    async function saveNotificationTtsVoice(value: any) {
        await saveStringPreference(
            'notificationTTSVoice',
            'notificationTTSVoice',
            value
        );
        speakNotificationTts(
            'Notification text-to-speech voice selected',
            Number.parseInt(value, 10) || 0
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
    function appDataDirConfirmDescription(validation: any) {
        const description = [
            t(
                'view.settings.advanced.advanced.data_directory.confirm_description',
                {
                    path: validation.path
                }
            )
        ];
        if (validation.warningKind === 'empty') {
            description.push(
                t(
                    'view.settings.advanced.advanced.data_directory.confirm_empty'
                )
            );
        } else if (validation.warningKind === 'missingProfileFiles') {
            description.push(
                t(
                    'view.settings.advanced.advanced.data_directory.confirm_missing_profile'
                )
            );
        }
        return description.join(' ');
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
        ).catch((error: any) => {
            toast.error(error instanceof Error ? error.message : String(error));
            return '';
        });
        if (!selectedPath) {
            return;
        }
        let validation;
        try {
            validation = await validateAppDataDir(selectedPath);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
            return;
        }
        const result = await confirm({
            title: t(
                'view.settings.advanced.advanced.data_directory.confirm_title'
            ),
            description: appDataDirConfirmDescription(validation),
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            setAppDataDirState(await setAppDataDir(validation.path));
            toast.success(
                t(
                    'view.settings.advanced.advanced.data_directory.saved_restart_required'
                )
            );
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
        const result = await confirm({
            title: t(
                'view.settings.advanced.advanced.data_directory.reset_confirm_title'
            ),
            description: t(
                'view.settings.advanced.advanced.data_directory.reset_confirm_description'
            ),
            confirmText: t('common.actions.reset'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            setAppDataDirState(await clearAppDataDir());
            toast.success(
                t('view.settings.advanced.advanced.data_directory.reset_saved')
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
    async function restartForAppDataDir() {
        try {
            await restartApplication();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
    async function refreshCacheSize() {
        const favoriteStats = getFavoriteRemoteDetailsCacheStats();
        const queryStats = getEntityQueryCacheStats();
        const runtimeState = useRuntimeStore.getState();
        let assetBundleCacheSize = '';
        try {
            assetBundleCacheSize = formatByteSize(
                await assetBundleRepository.getCacheSize()
            );
        } catch {
            assetBundleCacheSize = 'Unavailable';
        }
        setCacheStats({
            queryCache: getEntityQueryCacheSize(),
            userCache: queryStats.users,
            worldCache: queryStats.worlds,
            avatarCache: queryStats.avatars,
            groupCache: queryStats.groups,
            avatarNameCache: avatarProfileRepository.getAvatarNameCacheSize(),
            instanceCache: runtimeState.groupInstances.instances.length,
            favoriteDetailsCache: favoriteStats.detailCacheCount,
            favoriteDetailsPending: favoriteStats.detailPromiseCount,
            assetBundleCacheSize
        });
        setCacheStatsVisible(true);
    }
    async function clearVrcxCache() {
        const queryCacheCount = getEntityQueryCacheSize();
        await clearEntityQueryCache();
        const avatarNameCacheCount =
            avatarProfileRepository.clearAvatarNameCache();
        const favoriteStats = clearFavoriteRemoteDetailsCache();
        setCacheStats((current: any) => ({
            ...current,
            queryCache: 0,
            userCache: 0,
            worldCache: 0,
            avatarCache: 0,
            groupCache: 0,
            avatarNameCache: 0,
            instanceCache: 0,
            favoriteDetailsCache: 0,
            favoriteDetailsPending: 0
        }));
        toast.success(
            t(
                'view.settings.dynamic.cleared_value_query_cache_entries_value_avatar_name_entries_and_value_favorite_detail_entries',
                {
                    value: queryCacheCount,
                    value2: avatarNameCacheCount,
                    value3: favoriteStats.detailCacheCount
                }
            )
        );
    }
    async function promptAutoClearVrcxCacheFrequency() {
        const frequency = await configRepository.getInt(
            'VRCX_clearVRCXCacheFrequency',
            172800
        );
        const result = await prompt({
            title: t('prompt.auto_clear_cache.header'),
            description: t('prompt.auto_clear_cache.description'),
            confirmText: t('prompt.auto_clear_cache.ok'),
            cancelText: t('prompt.auto_clear_cache.cancel'),
            inputValue: String(
                Math.max(1, Math.round((Number(frequency) || 172800) / 7200))
            ),
            pattern: /\d+$/,
            errorMessage: t('prompt.auto_clear_cache.input_error')
        });
        if (!result.ok) {
            return;
        }
        const units = Number.parseInt(result.value, 10);
        if (!Number.isFinite(units) || units <= 0) {
            return;
        }
        await configRepository.setInt(
            'VRCX_clearVRCXCacheFrequency',
            units * 7200
        );
        toast.success(t('common.settings_saved'));
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
            Math.max(0, Number.parseInt(result.value, 10) || 0)
        );
        await savePreferenceValue('autoLoginDelaySeconds', seconds, () =>
            setIntConfigPreference('autoLoginDelaySeconds', seconds, {
                min: 0,
                max: 10,
                fallback: 0
            })
        );
    }
    async function resetUgcFolder() {
        await commit(
            () => setUserGeneratedContentPathPreference(''),
            () => {
                const previous = prefs.userGeneratedContentPath;
                setPrefs((current: any) => ({
                    ...current,
                    userGeneratedContentPath: ''
                }));
                return () =>
                    setPrefs((current: any) => ({
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
            await new Promise((resolve: any) =>
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
        ).catch((error: any) => {
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
    async function handleCropInstancePrintsChange(checked: any) {
        const enabled = normalizeCheckedState(checked);
        const saved = await commit(
            () => setCropInstancePrintsPreference(enabled),
            () => {
                setPrefs((current: any) => ({
                    ...current,
                    cropInstancePrints: enabled
                }));
                return () =>
                    setPrefs((current: any) => ({
                        ...current,
                        cropInstancePrints: !enabled
                    }));
            }
        );
        if (saved && enabled) {
            await promptCropExistingPrints().catch((error: any) => {
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
    async function handleGameLogDisabledChange(checked: any) {
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
    function saveSharedFeedFilters(nextFilters: any) {
        setSharedFeedFilters(nextFilters);
        setSharedFeedFiltersPreference(nextFilters).catch((error: any) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_save_feed_filters')
            );
        });
    }
    function updateSharedFeedFilter(mode: any, key: any, value: any) {
        const nextFilters = normalizeSharedFeedFilters({
            ...sharedFeedFilters,
            [mode]: {
                ...sharedFeedFilters[mode],
                [key]: value
            }
        });
        saveSharedFeedFilters(nextFilters);
    }
    function resetSharedFeedFilters(mode: any) {
        const nextFilters = normalizeSharedFeedFilters({
            ...sharedFeedFilters,
            [mode]: {
                ...sharedFeedFiltersDefaults[mode]
            }
        });
        saveSharedFeedFilters(nextFilters);
    }
    return {
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        deleteAllScreenshotMetadata,
        openAppDataDirSelector,
        resetAppDataDir,
        restartForAppDataDir,
        refreshCacheSize,
        clearVrcxCache,
        promptAutoClearVrcxCacheFrequency,
        promptAutoLoginDelaySeconds,
        resetUgcFolder,
        purgeAvatarFeedData,
        openUgcFolderSelector,
        handleCropInstancePrintsChange,
        handleGameLogDisabledChange,
        migrateLegacyVrcxData,
        updateSharedFeedFilter,
        resetSharedFeedFilters
    };
}
