import { openUGCPhotosFolder } from '@/services/shellIntegrationService';
import { recordViewModeUsage } from '@/services/telemetry/telemetryViewModeUsage';
import {
    normalizeAutoDeletePrintsLimit,
    normalizeFeedTimeDisplayMode
} from '@/state/preferencesStore';

import type { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import type { FavoriteFriendGroupOption } from './settingsFavoriteGroupOptions';
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

export type SettingsPagePrefs = ReturnType<typeof createDefaultSettingsPrefs> &
    Record<string, unknown>;
type SettingsPrefs = SettingsPagePrefs;
type SettingsAction = () => unknown | Promise<unknown>;
type SettingsAppDataDirState = {
    cliOverride?: boolean;
    currentDir?: string | null;
    defaultDir?: string | null;
    persistedDir?: string | null;
    source?: string;
};
type SettingsCallback<Args extends unknown[] = unknown[]> = {
    bivarianceHack(...args: Args): unknown;
}['bivarianceHack'];
type SetSettingsPrefs = SettingsCallback<
    [
        | SettingsPrefs
        | ((current: SettingsPrefs) => SettingsPrefs | Record<string, unknown>)
    ]
>;

export type BuildSettingsPageStateSectionsInput = Record<string, unknown> & {
    activeSettingsTab: string;
    appDataDirState?: SettingsAppDataDirState | null;
    cacheStatsVisible: boolean;
    clearVrcxCache: SettingsCallback;
    commit: SettingsCallback<
        [action: SettingsAction, optimistic?: () => unknown]
    >;
    deleteAllScreenshotMetadata: SettingsCallback;
    handleCropInstancePrintsChange: SettingsCallback<[boolean]>;
    handleGameLogDisabledChange: SettingsCallback<[boolean]>;
    loading: boolean;
    migrateLegacyVrcxData: SettingsCallback;
    normalizeRecentActionCooldownMinutes: (value: unknown) => number;
    notificationTtsTest: string;
    notificationTtsTestVisible: boolean;
    openAppDataDirSelector: SettingsCallback;
    openCustomFontDialog: SettingsCallback;
    openTableLimitsDialog: SettingsCallback;
    openTablePageSizesDialog: SettingsCallback;
    openTranslationApiDialog: SettingsCallback;
    openUgcFolderSelector: SettingsCallback;
    openYoutubeApiDialog: SettingsCallback;
    promptAutoClearVrcxCacheFrequency: SettingsCallback;
    promptAutoLoginDelaySeconds: SettingsCallback;
    promptProxySettings: SettingsCallback;
    prefs: SettingsPrefs;
    refreshCacheSize: SettingsCallback;
    refreshConfigTreeData: SettingsCallback;
    refreshOnlineVisits: SettingsCallback;
    refreshRuntimeAppSnapshot: SettingsCallback;
    refreshSqliteTableSizes: SettingsCallback;
    resetAppDataDir: SettingsCallback;
    resetTrustColors: SettingsCallback;
    resetUgcFolder: SettingsCallback;
    restartForAppDataDir: SettingsCallback;
    saveAvatarProviderEnabled: SettingsCallback<[boolean]>;
    saveBoolPreference: SettingsCallback<[string, string, boolean]>;
    saveDiscordBoolPreference: SettingsCallback<[string, boolean]>;
    saveFontFamilyPreference: SettingsCallback<[unknown]>;
    saveIntegrationBoolPreference: SettingsCallback<
        [string, boolean, SettingsAction]
    >;
    saveInterfaceZoomLevel: SettingsCallback<[unknown]>;
    savePreferenceValue: SettingsCallback<[string, unknown, SettingsAction]>;
    saveStringPreference: SettingsCallback<[string, string, string]>;
    saveTrustColor: SettingsCallback<[string, string]>;
    saveNotificationTtsMode: SettingsCallback<[string]>;
    saveNotificationTtsVoice: SettingsCallback<[string]>;
    saveWristOverlayEnabled: SettingsCallback<[boolean]>;
    selectCjkFontPack: SettingsCallback<[unknown]>;
    setAccessibleStatusIndicatorsPreference: SettingsCallback<[boolean]>;
    setActiveSettingsTab: SettingsCallback<[string]>;
    setAppLanguagePreference: SettingsCallback<[unknown]>;
    setAvatarProviderDialogOpen: SettingsCallback<[boolean]>;
    setCloseToTrayPreference: SettingsCallback<[boolean]>;
    setConfigTreeData: SettingsCallback<[Record<string, unknown>]>;
    setDataTableStripedPreference: SettingsCallback<[boolean]>;
    setDesktopNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setFeedFilterDialogOpen: SettingsCallback<[boolean]>;
    setIntConfigPreference: SettingsCallback<
        [string, number, { min?: number; max?: number; fallback?: number }]
    >;
    setNotificationLayoutPreference: SettingsCallback<[string]>;
    setNotificationTtsTest: SettingsCallback<[string]>;
    setNotificationTtsTestVisible: SettingsCallback<[boolean]>;
    setPrefs: SetSettingsPrefs;
    setPurgeDialogOpen: SettingsCallback<[boolean]>;
    setRecentActionCooldownEnabledPreference: SettingsCallback<[boolean]>;
    setRecentActionCooldownMinutesPreference: SettingsCallback<[number]>;
    setSaveInstanceEmojiPreference: SettingsCallback<[boolean]>;
    setSaveInstancePrintsPreference: SettingsCallback<[boolean]>;
    setSaveInstanceStickersPreference: SettingsCallback<[boolean]>;
    setScreenshotHelperCopyToClipboardPreference: SettingsCallback<[boolean]>;
    setScreenshotHelperModifyFilenamePreference: SettingsCallback<[boolean]>;
    setScreenshotHelperPreference: SettingsCallback<[boolean]>;
    setShowNewDashboardButtonPreference: SettingsCallback<[boolean]>;
    setStartAsMinimizedPreference: SettingsCallback<[boolean]>;
    setStartAtWindowsStartupPreference: SettingsCallback<[boolean]>;
    setTableDensityPreference: SettingsCallback<[unknown]>;
    setTranslationApiEnabledPreference: SettingsCallback<[boolean]>;
    setVrNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setWristFeedNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setYoutubeApiEnabledPreference: SettingsCallback<[boolean]>;
    setZoomInput: SettingsCallback<[unknown]>;
    speakNotificationTts: SettingsCallback<[unknown]>;
    toggleLocalFavoriteFriendsGroup: SettingsCallback<[unknown, boolean]>;
    ttsVoices: SpeechSynthesisVoice[];
    addFeedHiddenUser: SettingsCallback<[string]>;
    favoriteFriendGroupOptions: FavoriteFriendGroupOption[];
    localFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
    localFavoriteFriendsGroups: string[];
    remoteFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
    removeFeedHiddenUser: SettingsCallback<[string]>;
    selectedFavoriteFriendGroupLabel: string;
};

export function buildSettingsPageStateSections({
    activeSettingsTab,
    addFeedHiddenUser,
    addAvatarProvider,
    appDataDirState,
    applyAvatarProviderConfig,
    avatarProviderConfig,
    avatarProviderConfigRef,
    avatarProviderDialogOpen,
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
    llmEndpoints,
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
    removeFeedHiddenUser,
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
}: BuildSettingsPageStateSectionsInput) {
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
            onLanguageChange: (value: unknown) => {
                setAppLanguagePreference(value);
            },
            onFontFamilyChange: (value: unknown) => {
                if (value === 'custom') {
                    openCustomFontDialog();
                    return;
                }
                saveFontFamilyPreference(value);
            },
            onCjkFontPackChange: (value: unknown) => {
                selectCjkFontPack(value);
            },
            onZoomInputChange: (value: unknown) => {
                setZoomInput(value);
            },
            onZoomBlur: (
                event: { target?: { value?: unknown } } | null | undefined
            ) => {
                saveInterfaceZoomLevel(event?.target?.value ?? zoomInput);
            },
            onTableDensityChange: (value: unknown) => {
                savePreferenceValue('tableDensity', value, () =>
                    setTableDensityPreference(value)
                );
            },
            onDataTableStripedChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('dataTableStriped', enabled, () =>
                    setDataTableStripedPreference(enabled)
                );
            },
            onAccessibleStatusIndicatorsChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('accessibleStatusIndicators', enabled, () =>
                    setAccessibleStatusIndicatorsPreference(enabled)
                );
            },
            onShowInstanceIdInLocationChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'showInstanceIdInLocation',
                    'VRCX_showInstanceIdInLocation',
                    enabled
                );
            },
            onAgeGatedInstancesVisibleChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'isAgeGatedInstancesVisible',
                    'VRCX_isAgeGatedInstancesVisible',
                    enabled
                );
            },
            onHideNicknamesChange: (checked: unknown) => {
                saveBoolPreference(
                    'hideNicknames',
                    'hideNicknames',
                    !normalizeCheckedState(checked)
                );
            },
            onDisplayVrcPlusIconsAsAvatarChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'displayVRCPlusIconsAsAvatar',
                    'displayVRCPlusIconsAsAvatar',
                    enabled
                );
            },
            onShowNewDashboardButtonChange: (checked: unknown) => {
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
            onHour12Change: (value: unknown) => {
                saveBoolPreference('dtHour12', 'dtHour12', value === '12');
            },
            onIsoFormatChange: (checked: unknown) => {
                saveBoolPreference(
                    'dtIsoFormat',
                    'dtIsoFormat',
                    normalizeCheckedState(checked)
                );
            },
            onWeekStartsOnChange: (value: string) => {
                const nextValue = Number.parseInt(value, 10);
                savePreferenceValue('weekStartsOn', nextValue, () =>
                    setIntConfigPreference('weekStartsOn', nextValue, {
                        min: 0,
                        max: 6,
                        fallback: 1
                    })
                );
            },
            onFeedTimeDisplayModeChange: (value: unknown) => {
                const nextValue = normalizeFeedTimeDisplayMode(value);
                saveStringPreference(
                    'feedTimeDisplayMode',
                    'feedTimeDisplayMode',
                    nextValue
                );
                recordViewModeUsage('feedTimeDisplayMode', nextValue);
            },
            onHideUserNotesChange: (checked: unknown) => {
                saveBoolPreference(
                    'hideUserNotes',
                    'hideUserNotes',
                    !normalizeCheckedState(checked)
                );
            },
            onHideUserMemosChange: (checked: unknown) => {
                saveBoolPreference(
                    'hideUserMemos',
                    'hideUserMemos',
                    !normalizeCheckedState(checked)
                );
            },
            onHideUnfriendsChange: (checked: unknown) => {
                saveBoolPreference(
                    'hideUnfriends',
                    'hideUnfriends',
                    normalizeCheckedState(checked)
                );
            },
            onRandomUserColoursChange: (checked: unknown) => {
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
            onSaveTrustColor: (key: string, value: string) => {
                saveTrustColor(key, value);
            },
            onTrustColorDraftChange: (key: string, value: string) => {
                setPrefs((current) => ({
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
            onScreenshotHelperChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('screenshotHelper', enabled, () =>
                    setScreenshotHelperPreference(enabled)
                );
            },
            onScreenshotHelperModifyFilenameChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue(
                    'screenshotHelperModifyFilename',
                    enabled,
                    () => setScreenshotHelperModifyFilenamePreference(enabled)
                );
            },
            onScreenshotHelperCopyToClipboardChange: (checked: unknown) => {
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
            onSaveInstancePrintsChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('saveInstancePrints', enabled, () =>
                    setSaveInstancePrintsPreference(enabled)
                );
            },
            onCropInstancePrintsChange: (checked: unknown) => {
                handleCropInstancePrintsChange(normalizeCheckedState(checked));
            },
            onAutoDeleteOldPrintsChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'autoDeleteOldPrints',
                    'autoDeleteOldPrints',
                    enabled
                );
            },
            onAutoDeletePrintsLimitChange: (value: unknown) => {
                setPrefs((current) => ({
                    ...current,
                    autoDeletePrintsLimit: value
                }));
            },
            onAutoDeletePrintsLimitBlur: (value: unknown) => {
                const nextValue = normalizeAutoDeletePrintsLimit(value);
                savePreferenceValue('autoDeletePrintsLimit', nextValue, () =>
                    setIntConfigPreference('autoDeletePrintsLimit', nextValue, {
                        min: 30,
                        max: 60,
                        fallback: 60
                    })
                );
            },
            onSaveInstanceStickersChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('saveInstanceStickers', enabled, () =>
                    setSaveInstanceStickersPreference(enabled)
                );
            },
            onSaveInstanceEmojiChange: (checked: unknown) => {
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
            onDiscordActiveChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordActive',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordWorldIntegrationChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordWorldIntegration',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordInstanceChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordInstance',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordShowPlatformChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordShowPlatform',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordShowPrivateDetailsChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordHideInvite',
                    !normalizeCheckedState(checked)
                );
            },
            onDiscordJoinButtonChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordJoinButton',
                    normalizeCheckedState(checked)
                );
            },
            onDiscordShowImagesChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordHideImage',
                    !normalizeCheckedState(checked)
                );
            },
            onDiscordWorldNameAsStatusChange: (checked: unknown) => {
                saveDiscordBoolPreference(
                    'discordWorldNameAsDiscordStatus',
                    normalizeCheckedState(checked)
                );
            },
            onTranslationApiEnabledChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveIntegrationBoolPreference('translationAPI', enabled, () =>
                    setTranslationApiEnabledPreference(enabled)
                );
            },
            onOpenTranslationApiDialog: () => {
                openTranslationApiDialog();
            },
            onYoutubeApiEnabledChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveIntegrationBoolPreference('youtubeAPI', enabled, () =>
                    setYoutubeApiEnabledPreference(enabled)
                );
            },
            onOpenYoutubeApiDialog: () => {
                openYoutubeApiDialog();
            },
            onAvatarProviderEnabledChange: (checked: unknown) => {
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
            feedHiddenUsers: prefs.feedHiddenUsers,
            commit,
            onAddFeedHiddenUser: addFeedHiddenUser,
            onRemoveFeedHiddenUser: removeFeedHiddenUser,
            setRecentActionCooldownEnabledPreference,
            setRecentActionCooldownMinutesPreference,
            toggleLocalFavoriteFriendsGroup,
            setPrefs,
            onRecentActionCooldownEnabledChange: (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue(
                    'recentActionCooldownEnabled',
                    enabled,
                    () => setRecentActionCooldownEnabledPreference(enabled)
                );
            },
            onRecentActionCooldownMinutesChange: (value: unknown) => {
                setPrefs((current) => ({
                    ...current,
                    recentActionCooldownMinutes: value
                }));
            },
            onRecentActionCooldownMinutesBlur: (value: unknown) => {
                const nextValue = normalizeRecentActionCooldownMinutes(value);
                savePreferenceValue(
                    'recentActionCooldownMinutes',
                    nextValue,
                    () => setRecentActionCooldownMinutesPreference(nextValue)
                );
            },
            onToggleLocalFavoriteFriendsGroup: (
                groupKey: unknown,
                checked: unknown
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
            onAnonymousUsageTelemetryChange: (checked: unknown) => {
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
            llmEndpoints,
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

export type SettingsPageStateSections = ReturnType<
    typeof buildSettingsPageStateSections
>;
