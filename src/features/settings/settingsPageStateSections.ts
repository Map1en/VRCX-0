import { openUGCPhotosFolder } from '@/services/shellIntegrationService';
import { recordViewModeUsage } from '@/services/telemetry/telemetryViewModeUsage';
import { normalizeFeedTimeDisplayMode } from '@/state/preferencesStore';

import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsOptions,
    settingsTabs,
    sqliteTableSizeRows,
    translationProviderOptions
} from './settingsOptions';
import { normalizeCheckedState } from './settingsValues';

export function buildSettingsPageStateSections({
    activeSettingsTab,
    addAvatarProvider,
    appDataDirState,
    applyAvatarProviderConfig,
    avatarProviderConfig,
    avatarProviderConfigRef,
    avatarProviderDialogOpen,
    availableTranslationModels,
    cacheStats,
    cacheStatsVisible,
    clearVrcxCache,
    commit,
    configTreeData,
    currentSharedFeedFilterOptions,
    customFontDialogOpen,
    customFontDraft,
    customFontOptions,
    customFontOptionsLoading,
    deleteAllScreenshotMetadata,
    desktopNotificationsDialogOpen,
    discordPrefs,
    favoriteFriendGroupOptions,
    feedFilterDialogOpen,
    feedFilterMode,
    fetchTranslationModels,
    handleCropInstancePrintsChange,
    handleGameLogDisabledChange,
    integrationPrefs,
    integrationStatus,
    locale,
    localFavoriteFriendGroupOptions,
    localFavoriteFriendsGroups,
    loading,
    migrateLegacyVrcxData,
    normalizeRecentActionCooldownMinutes,
    notificationTtsTest,
    notificationTtsTestVisible,
    onlineVisitCount,
    openAppDataDirSelector,
    openCustomFontDialog,
    openTableLimitsDialog,
    openTablePageSizesDialog,
    openTranslationApiDialog,
    openUgcFolderSelector,
    openYoutubeApiDialog,
    prefs,
    promptAutoClearVrcxCacheFrequency,
    promptAutoLoginDelaySeconds,
    promptProxySettings,
    purgeAvatarFeedData,
    purgeDialogOpen,
    purgeInProgress,
    purgePeriod,
    refreshCacheSize,
    refreshConfigTreeData,
    refreshOnlineVisits,
    refreshRuntimeAppSnapshot,
    refreshSqliteTableSizes,
    remoteFavoriteFriendGroupOptions,
    removeAvatarProvider,
    resetAppDataDir,
    resetSharedFeedFilters,
    resetTrustColors,
    resetUgcFolder,
    restartForAppDataDir,
    saveAvatarProviderConfig,
    saveAvatarProviderEnabled,
    saveAvatarProviderField,
    saveBoolPreference,
    saveCustomFontFamily,
    saveDesktopNotificationActivityFilters,
    saveDiscordBoolPreference,
    saveFontFamilyPreference,
    saveIntegrationBoolPreference,
    saveInterfaceZoomLevel,
    saveNotificationTtsMode,
    saveNotificationTtsVoice,
    saveOverlayActivityFilters,
    savePreferenceValue,
    saveStringPreference,
    saveTableLimitsDialog,
    saveTranslationApiConfig,
    saveTrustColor,
    saveVrNotificationActivityFilters,
    saveWebhookActivityFilters,
    saveWristOverlayEnabled,
    saveYoutubeApiKey,
    searchLimitError,
    selectCjkFontPack,
    selectedFavoriteFriendGroupLabel,
    setAccessibleStatusIndicatorsPreference,
    setActiveSettingsTab,
    setAppLanguagePreference,
    setAvatarProviderDialogOpen,
    setCloseToTrayPreference,
    setConfigTreeData,
    setCustomFontDialogOpen,
    setCustomFontDraft,
    setDataTableStripedPreference,
    setDesktopNotificationsDialogOpen,
    setFeedFilterDialogOpen,
    setIntConfigPreference,
    setIntegrationValue,
    setNotificationLayoutPreference,
    setNotificationTtsTest,
    setNotificationTtsTestVisible,
    setPrefs,
    setPurgeDialogOpen,
    setPurgePeriod,
    setRecentActionCooldownEnabledPreference,
    setRecentActionCooldownMinutesPreference,
    setSaveInstanceEmojiPreference,
    setSaveInstancePrintsPreference,
    setSaveInstanceStickersPreference,
    setScreenshotHelperCopyToClipboardPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperPreference,
    setShowNewDashboardButtonPreference,
    setStartAsMinimizedPreference,
    setStartAtWindowsStartupPreference,
    setTableDensityPreference,
    setTableLimitsDialogOpen,
    setTableLimitsDraft,
    setTablePageSizesDialogOpen,
    setTranslationApiEnabledPreference,
    setTranslationApiDialogOpen,
    setTranslationDraftValue,
    setVrNotificationsDialogOpen,
    setWebhookNotificationsDialogOpen,
    setWristFeedNotificationsDialogOpen,
    setYoutubeApiDialogOpen,
    setYoutubeApiEnabledPreference,
    setYoutubeApiKeyDraft,
    setZoomInput,
    setZoomLevelPreference,
    sharedFeedFilters,
    sqliteTableSizes,
    speakNotificationTts,
    tableLimitsDialogOpen,
    tableLimitsDraft,
    tableLimitsSaveDisabled,
    tableMaxSizeError,
    tablePageSizesDialogOpen,
    tauriAppSnapshot,
    testTranslationApiConfig,
    translationApiDialogOpen,
    translationDraft,
    ttsVoices,
    toggleLocalFavoriteFriendsGroup,
    updateAvatarProvider,
    updateSharedFeedFilter,
    vrNotificationsDialogOpen,
    webhookNotificationsDialogOpen,
    wristFeedNotificationsDialogOpen,
    youtubeApiDialogOpen,
    youtubeApiKeyDraft,
    zoomInput,
    zoomLevel
}: any) {
    return {
        shell: {
            activeSettingsTab,
            setActiveSettingsTab,
            settingsTabs,
            loading
        },
        system: {
            prefs,
            savePreferenceValue,
            saveBoolPreference,
            setStartAtWindowsStartupPreference,
            setStartAsMinimizedPreference,
            setCloseToTrayPreference,
            promptProxySettings,
            promptAutoLoginDelaySeconds
        },
        interface: {
            locale,
            prefs,
            zoomInput,
            zoomLevel,
            commit,
            setAppLanguagePreference,
            openCustomFontDialog,
            saveFontFamilyPreference,
            selectCjkFontPack,
            setZoomInput,
            setZoomLevelPreference,
            saveBoolPreference,
            savePreferenceValue,
            setDataTableStripedPreference,
            setAccessibleStatusIndicatorsPreference,
            setShowNewDashboardButtonPreference,
            openTablePageSizesDialog,
            openTableLimitsDialog,
            setIntConfigPreference,
            resetTrustColors,
            saveTrustColor,
            setPrefs,
            onLanguageChange: (value: any) => {
                setAppLanguagePreference(value);
            },
            onFontFamilyChange: (value: any) => {
                if (value === 'custom') {
                    openCustomFontDialog();
                    return;
                }
                saveFontFamilyPreference(value);
            },
            onCjkFontPackChange: (value: any) => {
                selectCjkFontPack(value);
            },
            onZoomInputChange: (value: any) => {
                setZoomInput(value);
            },
            onZoomBlur: (event: any) => {
                saveInterfaceZoomLevel(event?.target?.value ?? zoomInput);
            },
            onTableDensityChange: (value: any) => {
                savePreferenceValue('tableDensity', value, () =>
                    setTableDensityPreference(value)
                );
            },
            onDataTableStripedChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('dataTableStriped', enabled, () =>
                    setDataTableStripedPreference(enabled)
                );
            },
            onAccessibleStatusIndicatorsChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('accessibleStatusIndicators', enabled, () =>
                    setAccessibleStatusIndicatorsPreference(enabled)
                );
            },
            onShowInstanceIdInLocationChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'showInstanceIdInLocation',
                    'VRCX_showInstanceIdInLocation',
                    enabled
                );
            },
            onAgeGatedInstancesVisibleChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'isAgeGatedInstancesVisible',
                    'VRCX_isAgeGatedInstancesVisible',
                    enabled
                );
            },
            onHideNicknamesChange: (checked: any) => {
                saveBoolPreference(
                    'hideNicknames',
                    'hideNicknames',
                    !normalizeCheckedState(checked)
                );
            },
            onDisplayVrcPlusIconsAsAvatarChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'displayVRCPlusIconsAsAvatar',
                    'displayVRCPlusIconsAsAvatar',
                    enabled
                );
            },
            onShowNewDashboardButtonChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('showNewDashboardButton', enabled, () =>
                    setShowNewDashboardButtonPreference(enabled)
                );
            },
            onOpenTablePageSizes: () => {
                openTablePageSizesDialog();
            },
            onOpenTableLimits: () => {
                openTableLimitsDialog();
            },
            onHour12Change: (value: any) => {
                saveBoolPreference('dtHour12', 'dtHour12', value === '12');
            },
            onIsoFormatChange: (checked: any) => {
                saveBoolPreference(
                    'dtIsoFormat',
                    'dtIsoFormat',
                    normalizeCheckedState(checked)
                );
            },
            onWeekStartsOnChange: (value: any) => {
                const nextValue = Number.parseInt(value, 10);
                savePreferenceValue('weekStartsOn', nextValue, () =>
                    setIntConfigPreference('weekStartsOn', nextValue, {
                        min: 0,
                        max: 6,
                        fallback: 1
                    })
                );
            },
            onFeedTimeDisplayModeChange: (value: any) => {
                const nextValue = normalizeFeedTimeDisplayMode(value);
                saveStringPreference(
                    'feedTimeDisplayMode',
                    'feedTimeDisplayMode',
                    nextValue
                );
                recordViewModeUsage('feedTimeDisplayMode', nextValue);
            },
            onHideUserNotesChange: (checked: any) => {
                saveBoolPreference(
                    'hideUserNotes',
                    'hideUserNotes',
                    !normalizeCheckedState(checked)
                );
            },
            onHideUserMemosChange: (checked: any) => {
                saveBoolPreference(
                    'hideUserMemos',
                    'hideUserMemos',
                    !normalizeCheckedState(checked)
                );
            },
            onHideUnfriendsChange: (checked: any) => {
                saveBoolPreference(
                    'hideUnfriends',
                    'hideUnfriends',
                    normalizeCheckedState(checked)
                );
            },
            onRandomUserColoursChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'randomUserColours',
                    'randomUserColours',
                    enabled
                );
            },
            onResetTrustColors: () => {
                resetTrustColors();
            },
            onSaveTrustColor: (key: any, value: any) => {
                saveTrustColor(key, value);
            },
            onTrustColorDraftChange: (key: any, value: any) => {
                setPrefs((current: any) => ({
                    ...current,
                    trustColor: {
                        ...current.trustColor,
                        [key]: value
                    }
                }));
            }
        },
        media: {
            prefs,
            commit,
            setScreenshotHelperPreference,
            setScreenshotHelperModifyFilenamePreference,
            setScreenshotHelperCopyToClipboardPreference,
            deleteAllScreenshotMetadata,
            openUgcFolderSelector,
            resetUgcFolder,
            setSaveInstancePrintsPreference,
            handleCropInstancePrintsChange,
            setSaveInstanceStickersPreference,
            setSaveInstanceEmojiPreference,
            setPrefs,
            onScreenshotHelperChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('screenshotHelper', enabled, () =>
                    setScreenshotHelperPreference(enabled)
                );
            },
            onScreenshotHelperModifyFilenameChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue(
                    'screenshotHelperModifyFilename',
                    enabled,
                    () => setScreenshotHelperModifyFilenamePreference(enabled)
                );
            },
            onScreenshotHelperCopyToClipboardChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue(
                    'screenshotHelperCopyToClipboard',
                    enabled,
                    () => setScreenshotHelperCopyToClipboardPreference(enabled)
                );
            },
            onDeleteAllScreenshotMetadata: () => {
                deleteAllScreenshotMetadata();
            },
            onOpenUgcPhotosFolder: () => {
                commit(() =>
                    openUGCPhotosFolder(prefs.userGeneratedContentPath)
                );
            },
            onOpenUgcFolderSelector: () => {
                openUgcFolderSelector();
            },
            onResetUgcFolder: () => {
                resetUgcFolder();
            },
            onSaveInstancePrintsChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('saveInstancePrints', enabled, () =>
                    setSaveInstancePrintsPreference(enabled)
                );
            },
            onCropInstancePrintsChange: (checked: any) => {
                handleCropInstancePrintsChange(normalizeCheckedState(checked));
            },
            onSaveInstanceStickersChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('saveInstanceStickers', enabled, () =>
                    setSaveInstanceStickersPreference(enabled)
                );
            },
            onSaveInstanceEmojiChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('saveInstanceEmoji', enabled, () =>
                    setSaveInstanceEmojiPreference(enabled)
                );
            }
        },
        integrations: {
            prefs,
            discordPrefs,
            integrationPrefs,
            avatarProviderConfig,
            saveDiscordBoolPreference,
            setPrefs,
            setWebhookNotificationsDialogOpen,
            saveStringPreference,
            saveBoolPreference,
            commit,
            setTranslationApiEnabledPreference,
            setIntegrationValue,
            openTranslationApiDialog,
            setYoutubeApiEnabledPreference,
            openYoutubeApiDialog,
            saveAvatarProviderConfig,
            avatarProviderConfigRef,
            applyAvatarProviderConfig,
            setAvatarProviderDialogOpen,
            onDiscordActiveChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordActive',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordWorldIntegrationChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordWorldIntegration',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordInstanceChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordInstance',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordShowPlatformChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordShowPlatform',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordShowPrivateDetailsChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordHideInvite',
                    !normalizeCheckedState(checked)
                );
            },
            onDiscordJoinButtonChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordJoinButton',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordShowImagesChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordHideImage',
                    !normalizeCheckedState(checked)
                );
            },
            onDiscordWorldNameAsStatusChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordWorldNameAsDiscordStatus',
                    normalizeCheckedState(checked)
                );
            },
            onTranslationApiEnabledChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveIntegrationBoolPreference('translationAPI', enabled, () =>
                    setTranslationApiEnabledPreference(enabled)
                );
            },
            onOpenTranslationApiDialog: () => {
                openTranslationApiDialog();
            },
            onYoutubeApiEnabledChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveIntegrationBoolPreference('youtubeAPI', enabled, () =>
                    setYoutubeApiEnabledPreference(enabled)
                );
            },
            onOpenYoutubeApiDialog: () => {
                openYoutubeApiDialog();
            },
            onAvatarProviderEnabledChange: (checked: any) => {
                saveAvatarProviderEnabled(normalizeCheckedState(checked));
            },
            onOpenAvatarProviderDialog: () => {
                setAvatarProviderDialogOpen(true);
            }
        },
        social: {
            prefs,
            selectedFavoriteFriendGroupLabel,
            favoriteFriendGroupOptions,
            remoteFavoriteFriendGroupOptions,
            localFavoriteFriendGroupOptions,
            localFavoriteFriendsGroups,
            commit,
            setRecentActionCooldownEnabledPreference,
            setRecentActionCooldownMinutesPreference,
            toggleLocalFavoriteFriendsGroup,
            setPrefs,
            onRecentActionCooldownEnabledChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue(
                    'recentActionCooldownEnabled',
                    enabled,
                    () => setRecentActionCooldownEnabledPreference(enabled)
                );
            },
            onRecentActionCooldownMinutesChange: (value: any) => {
                setPrefs((current: any) => ({
                    ...current,
                    recentActionCooldownMinutes: value
                }));
            },
            onRecentActionCooldownMinutesBlur: (value: any) => {
                const nextValue = normalizeRecentActionCooldownMinutes(value);
                savePreferenceValue(
                    'recentActionCooldownMinutes',
                    nextValue,
                    () => setRecentActionCooldownMinutesPreference(nextValue)
                );
            },
            onToggleLocalFavoriteFriendsGroup: (
                groupKey: any,
                checked: any
            ) => {
                toggleLocalFavoriteFriendsGroup(
                    groupKey,
                    normalizeCheckedState(checked)
                );
            }
        },
        notifications: {
            prefs,
            notificationLayoutOptions,
            desktopToastOptions,
            notificationTtsOptions,
            ttsVoices,
            notificationTtsTestVisible,
            notificationTtsTest,
            commit,
            setNotificationLayoutPreference,
            setPrefs,
            setFeedFilterDialogOpen,
            setDesktopNotificationsDialogOpen,
            saveStringPreference,
            saveBoolPreference,
            saveNotificationTtsMode,
            saveNotificationTtsVoice,
            setNotificationTtsTestVisible,
            setNotificationTtsTest,
            speakNotificationTts
        },
        vr: {
            prefs,
            setVrNotificationsDialogOpen,
            setWristFeedNotificationsDialogOpen,
            savePreferenceValue,
            saveStringPreference,
            saveBoolPreference,
            setIntConfigPreference,
            saveWristOverlayEnabled
        },
        advanced: {
            prefs,
            cacheStats,
            cacheStatsVisible,
            avatarAutoCleanupOptions,
            sqliteTableSizes,
            sqliteTableSizeRows,
            onlineVisitCount,
            configTreeData,
            appDataDirState,
            tauriAppSnapshot,
            saveBoolPreference,
            clearVrcxCache,
            promptAutoClearVrcxCacheFrequency,
            refreshCacheSize,
            handleGameLogDisabledChange,
            saveStringPreference,
            setPurgeDialogOpen,
            refreshSqliteTableSizes,
            refreshOnlineVisits,
            refreshConfigTreeData,
            refreshRuntimeAppSnapshot,
            openAppDataDirSelector,
            resetAppDataDir,
            restartForAppDataDir,
            setConfigTreeData,
            migrateLegacyVrcxData,
            onAnonymousUsageTelemetryChange: (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'anonymousUsageTelemetry',
                    'anonymousUsageTelemetry',
                    enabled
                );
            }
        },
        dialogs: {
            customFontDialogOpen,
            setCustomFontDialogOpen,
            customFontDraft,
            setCustomFontDraft,
            customFontOptions,
            customFontOptionsLoading,
            saveCustomFontFamily,
            youtubeApiDialogOpen,
            setYoutubeApiDialogOpen,
            youtubeApiKeyDraft,
            setYoutubeApiKeyDraft,
            integrationStatus,
            saveYoutubeApiKey,
            translationApiDialogOpen,
            setTranslationApiDialogOpen,
            translationDraft,
            setTranslationDraftValue,
            translationProviderOptions,
            availableTranslationModels,
            fetchTranslationModels,
            testTranslationApiConfig,
            saveTranslationApiConfig,
            tablePageSizesDialogOpen,
            setTablePageSizesDialogOpen,
            setPrefs,
            tableLimitsDialogOpen,
            setTableLimitsDialogOpen,
            tableLimitsDraft,
            setTableLimitsDraft,
            tableMaxSizeError,
            searchLimitError,
            tableLimitsSaveDisabled,
            saveTableLimitsDialog,
            avatarProviderDialogOpen,
            setAvatarProviderDialogOpen,
            avatarProviderConfig,
            updateAvatarProvider,
            saveAvatarProviderField,
            removeAvatarProvider,
            addAvatarProvider,
            purgeDialogOpen,
            setPurgeDialogOpen,
            purgePeriod,
            setPurgePeriod,
            purgeInProgress,
            purgeAvatarFeedData,
            feedFilterDialogOpen,
            setFeedFilterDialogOpen,
            feedFilterMode,
            currentSharedFeedFilterOptions,
            sharedFeedFilters,
            updateSharedFeedFilter,
            resetSharedFeedFilters,
            wristFeedNotificationsDialogOpen,
            setWristFeedNotificationsDialogOpen,
            vrNotificationsDialogOpen,
            setVrNotificationsDialogOpen,
            desktopNotificationsDialogOpen,
            setDesktopNotificationsDialogOpen,
            webhookNotificationsDialogOpen,
            setWebhookNotificationsDialogOpen,
            overlayActivityFilters: prefs.overlayActivityFilters,
            saveOverlayActivityFilters,
            vrNotificationActivityFilters: prefs.vrNotificationActivityFilters,
            saveVrNotificationActivityFilters,
            desktopNotificationActivityFilters:
                prefs.desktopNotificationActivityFilters,
            saveDesktopNotificationActivityFilters,
            webhookActivityFilters: prefs.webhookActivityFilters,
            saveWebhookActivityFilters
        }
    };
}
