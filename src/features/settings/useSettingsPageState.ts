import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
    setAccessibleStatusIndicatorsPreference,
    setAppLanguagePreference,
    setDataTableStripedPreference,
    setNotificationLayoutPreference,
    setRecentActionCooldownEnabledPreference,
    setRecentActionCooldownMinutesPreference,
    setShowNewDashboardButtonPreference,
    setScreenshotHelperCopyToClipboardPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperPreference,
    setCloseToTrayPreference,
    setIntConfigPreference,
    setSaveInstanceEmojiPreference,
    setSaveInstancePrintsPreference,
    setSaveInstanceStickersPreference,
    setStartAsMinimizedPreference,
    setStartAtWindowsStartupPreference,
    setTranslationApiEnabledPreference,
    setYoutubeApiEnabledPreference,
    setZoomLevelPreference
} from '@/services/preferencesService';
import { openUGCPhotosFolder } from '@/services/shellIntegrationService';
import { feedFiltersOptions } from '@/shared/constants/feedFilters';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { useFavoriteStore } from '@/state/favoriteStore';
import {
    DEFAULT_PREFERENCES,
    normalizeFeedTimeDisplayMode,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsOptions,
    settingsTabs,
    sqliteTableSizeRows,
    translationProviderOptions
} from './settingsOptions';
import { normalizeSharedFeedFilters } from './settingsValues';
import { useAvatarProviderConfig } from './useAvatarProviderConfig';
import { useSettingsActions } from './useSettingsActions';
import { useSettingsCommit } from './useSettingsCommit';
import { useSettingsEffects } from './useSettingsEffects';
import { useSettingsIntegrations } from './useSettingsIntegrations';

const FEED_FILTER_OPTIONS = feedFiltersOptions();
const SETTINGS_PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES);

export function useSettingsPageState() {
    const locale = useShellStore((state: any) => state.locale);
    const zoomLevel = useShellStore((state: any) => state.zoomLevel);
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const favoriteFriendGroups = useFavoriteStore(
        (state: any) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state: any) => state.localFriendFavoriteGroups
    );
    const preferenceState = usePreferencesStore(
        useShallow((state: any) => {
            const snapshot: any = {
                preferencesHydrated: state.preferencesHydrated
            };
            for (const key of SETTINGS_PREFERENCE_KEYS) {
                snapshot[key] = state[key];
            }
            return snapshot;
        })
    );
    const [prefs, setPrefs] = useState(() => createDefaultSettingsPrefs());
    const [sqliteTableSizes, setSqliteTableSizes] = useState<any>({});
    const [appDataDirState, setAppDataDirState] = useState<any>(null);
    const [cacheStatsVisible, setCacheStatsVisible] = useState(false);
    const [cacheStats, setCacheStats] = useState<any>({
        queryCache: 0,
        userCache: 0,
        worldCache: 0,
        avatarCache: 0,
        groupCache: 0,
        avatarNameCache: 0,
        instanceCache: 0,
        favoriteDetailsCache: 0,
        favoriteDetailsPending: 0,
        assetBundleCacheSize: ''
    });
    const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
    const [purgePeriod, setPurgePeriod] = useState('180');
    const [purgeInProgress, setPurgeInProgress] = useState(false);
    const [onlineVisitCount, setOnlineVisitCount] = useState(null);
    const [configTreeData, setConfigTreeData] = useState<any>({});
    const [tauriAppSnapshot, setRuntimeAppSnapshot] = useState(null);
    const [localFavoriteFriendsGroups, setLocalFavoriteFriendsGroups] =
        useState<any[]>([]);
    const [zoomInput, setZoomInput] = useState('100');
    const [ttsVoices, setTtsVoices] = useState<any[]>([]);
    const [notificationTtsTest, setNotificationTtsTest] = useState('');
    const [customFontDialogOpen, setCustomFontDialogOpen] = useState(false);
    const [customFontDraft, setCustomFontDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeSettingsTab, setActiveSettingsTab] = useState('system');
    const feedFilterMode = 'noty';
    const [feedFilterDialogOpen, setFeedFilterDialogOpen] = useState(false);
    const [
        wristFeedNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen
    ] = useState(false);
    const [vrNotificationsDialogOpen, setVrNotificationsDialogOpen] =
        useState(false);
    const [sharedFeedFilters, setSharedFeedFilters] = useState(() =>
        normalizeSharedFeedFilters()
    );
    const [notificationTtsTestVisible, setNotificationTtsTestVisible] =
        useState(false);
    const [tablePageSizesDialogOpen, setTablePageSizesDialogOpen] =
        useState(false);
    const [tableLimitsDialogOpen, setTableLimitsDialogOpen] = useState(false);
    const [tableLimitsDraft, setTableLimitsDraft] = useState<any>({
        maxTableSize: String(DEFAULT_MAX_TABLE_SIZE),
        searchLimit: String(DEFAULT_SEARCH_LIMIT)
    });
    const [avatarProviderDialogOpen, setAvatarProviderDialogOpen] =
        useState(false);
    const commit = useSettingsCommit();

    const {
        availableTranslationModels,
        discordPrefs,
        fetchTranslationModels,
        integrationPrefs,
        integrationStatus,
        openTranslationApiDialog,
        openYoutubeApiDialog,
        saveDiscordBoolPreference,
        saveTranslationApiConfig,
        saveYoutubeApiKey,
        setDiscordPrefs,
        setIntegrationPrefs,
        setIntegrationValue,
        setTranslationApiDialogOpen,
        setTranslationDraftValue,
        setYoutubeApiDialogOpen,
        setYoutubeApiKeyDraft,
        testTranslationApiConfig,
        translationApiDialogOpen,
        translationDraft,
        youtubeApiDialogOpen,
        youtubeApiKeyDraft
    } = useSettingsIntegrations({
        commit
    });
    const {
        addAvatarProvider,
        applyAvatarProviderConfig,
        avatarProviderConfig,
        avatarProviderConfigRef,
        removeAvatarProvider,
        saveAvatarProviderConfig,
        saveAvatarProviderField,
        updateAvatarProvider
    } = useAvatarProviderConfig({
        commit
    });

    const {
        applyPreferenceSnapshotToLocalState,
        savePreferenceValue,
        saveBoolPreference,
        saveStringPreference,
        saveFontFamilyPreference,
        selectCjkFontPack,
        openCustomFontDialog,
        saveCustomFontFamily,
        saveTrustColor,
        resetTrustColors,
        refreshSqliteTableSizes,
        refreshConfigTreeData,
        refreshOnlineVisits,
        promptProxySettings,
        openTablePageSizesDialog,
        openTableLimitsDialog,
        saveTableLimitsDialog,
        toggleLocalFavoriteFriendsGroup,
        speakNotificationTts,
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        deleteAllScreenshotMetadata,
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
        openAppDataDirSelector,
        resetAppDataDir,
        restartForAppDataDir,
        updateSharedFeedFilter,
        resetSharedFeedFilters,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveWristOverlayEnabled,
        refreshRuntimeAppSnapshot,
        searchLimitError,
        tableLimitsSaveDisabled,
        tableMaxSizeError
    } = useSettingsActions({
        commit,
        customFontDraft,
        localFavoriteFriendsGroups,
        prefs,
        purgePeriod,
        setCacheStats,
        setCacheStatsVisible,
        setAppDataDirState,
        setConfigTreeData,
        setCustomFontDialogOpen,
        setCustomFontDraft,
        setDiscordPrefs,
        setIntegrationPrefs,
        setLocalFavoriteFriendsGroups,
        setOnlineVisitCount,
        setPrefs,
        setPurgeDialogOpen,
        setPurgeInProgress,
        setRuntimeAppSnapshot,
        setSharedFeedFilters,
        setSqliteTableSizes,
        setTableLimitsDialogOpen,
        setTableLimitsDraft,
        setTablePageSizesDialogOpen,
        sharedFeedFilters,
        tableLimitsDraft
    });
    useSettingsEffects({
        applyAvatarProviderConfig,
        applyPreferenceSnapshotToLocalState,
        preferenceState,
        setLoading,
        setAppDataDirState,
        setPrefs,
        setTtsVoices,
        setZoomInput,
        sidebarOpen,
        zoomLevel
    });
    const feedFilterOptions = FEED_FILTER_OPTIONS;
    const currentSharedFeedFilterOptions =
        feedFilterOptions.notyFeedFiltersOptions;
    const remoteFavoriteFriendGroupOptions = useMemo(
        () =>
            (favoriteFriendGroups || [])
                .map((group: any) => ({
                    value: group?.key,
                    label: group?.displayName || group?.name || group?.key
                }))
                .filter((group: any) => group.value),
        [favoriteFriendGroups]
    );
    const localFavoriteFriendGroupOptions = useMemo(
        () =>
            (localFriendFavoriteGroups || [])
                .map((groupName: any) => ({
                    value: `local:${groupName}`,
                    label: groupName
                }))
                .filter((group: any) => group.value),
        [localFriendFavoriteGroups]
    );
    const favoriteFriendGroupOptions = useMemo(
        () => [
            ...remoteFavoriteFriendGroupOptions,
            ...localFavoriteFriendGroupOptions
        ],
        [localFavoriteFriendGroupOptions, remoteFavoriteFriendGroupOptions]
    );
    const selectedFavoriteFriendGroupLabel = favoriteFriendGroupOptions
        .filter((group: any) =>
            localFavoriteFriendsGroups.includes(group.value)
        )
        .map((group: any) => group.label)
        .join(', ');

    function normalizeRecentActionCooldownMinutes(value: any) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
            return 60;
        }
        return Math.min(1440, Math.max(1, parsed));
    }

    async function saveInterfaceZoomLevel(value: any) {
        let savedZoom = zoomLevel;
        const saved = await commit(async () => {
            savedZoom = await setZoomLevelPreference(value);
        });
        if (saved) {
            setZoomInput(String(savedZoom));
        }
    }

    function saveIntegrationBoolPreference(key: any, value: any, action: any) {
        commit(action, () => {
            const previous = integrationPrefs[key];
            setIntegrationValue(key, value);
            return () => setIntegrationValue(key, previous);
        });
    }

    function saveAvatarProviderEnabled(value: any) {
        const previousConfig = avatarProviderConfigRef.current;
        const nextConfig = {
            ...previousConfig,
            enabled: Boolean(value)
        };
        commit(
            () => saveAvatarProviderConfig(nextConfig),
            () => {
                applyAvatarProviderConfig(nextConfig);
                return () => applyAvatarProviderConfig(previousConfig);
            }
        );
    }

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
            onDataTableStripedChange: (checked: any) => {
                savePreferenceValue('dataTableStriped', checked, () =>
                    setDataTableStripedPreference(checked)
                );
            },
            onAccessibleStatusIndicatorsChange: (checked: any) => {
                savePreferenceValue('accessibleStatusIndicators', checked, () =>
                    setAccessibleStatusIndicatorsPreference(checked)
                );
            },
            onShowInstanceIdInLocationChange: (checked: any) => {
                saveBoolPreference(
                    'showInstanceIdInLocation',
                    'VRCX_showInstanceIdInLocation',
                    checked
                );
            },
            onAgeGatedInstancesVisibleChange: (checked: any) => {
                saveBoolPreference(
                    'isAgeGatedInstancesVisible',
                    'VRCX_isAgeGatedInstancesVisible',
                    checked
                );
            },
            onHideNicknamesChange: (checked: any) => {
                saveBoolPreference('hideNicknames', 'hideNicknames', !checked);
            },
            onDisplayVrcPlusIconsAsAvatarChange: (checked: any) => {
                saveBoolPreference(
                    'displayVRCPlusIconsAsAvatar',
                    'displayVRCPlusIconsAsAvatar',
                    checked
                );
            },
            onShowNewDashboardButtonChange: (checked: any) => {
                savePreferenceValue('showNewDashboardButton', checked, () =>
                    setShowNewDashboardButtonPreference(checked)
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
                saveBoolPreference('dtIsoFormat', 'dtIsoFormat', checked);
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
            },
            onHideUserNotesChange: (checked: any) => {
                saveBoolPreference('hideUserNotes', 'hideUserNotes', !checked);
            },
            onHideUserMemosChange: (checked: any) => {
                saveBoolPreference('hideUserMemos', 'hideUserMemos', !checked);
            },
            onHideUnfriendsChange: (checked: any) => {
                saveBoolPreference('hideUnfriends', 'hideUnfriends', checked);
            },
            onRandomUserColoursChange: (checked: any) => {
                saveBoolPreference(
                    'randomUserColours',
                    'randomUserColours',
                    checked
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
                savePreferenceValue('screenshotHelper', checked, () =>
                    setScreenshotHelperPreference(checked)
                );
            },
            onScreenshotHelperModifyFilenameChange: (checked: any) => {
                savePreferenceValue(
                    'screenshotHelperModifyFilename',
                    checked,
                    () => setScreenshotHelperModifyFilenamePreference(checked)
                );
            },
            onScreenshotHelperCopyToClipboardChange: (checked: any) => {
                savePreferenceValue(
                    'screenshotHelperCopyToClipboard',
                    checked,
                    () => setScreenshotHelperCopyToClipboardPreference(checked)
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
                savePreferenceValue('saveInstancePrints', checked, () =>
                    setSaveInstancePrintsPreference(checked)
                );
            },
            onCropInstancePrintsChange: (checked: any) => {
                handleCropInstancePrintsChange(checked);
            },
            onSaveInstanceStickersChange: (checked: any) => {
                savePreferenceValue('saveInstanceStickers', checked, () =>
                    setSaveInstanceStickersPreference(checked)
                );
            },
            onSaveInstanceEmojiChange: (checked: any) => {
                savePreferenceValue('saveInstanceEmoji', checked, () =>
                    setSaveInstanceEmojiPreference(checked)
                );
            }
        },
        integrations: {
            discordPrefs,
            integrationPrefs,
            avatarProviderConfig,
            saveDiscordBoolPreference,
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
                saveDiscordBoolPreference('discordActive', checked);
            },
            onDiscordWorldIntegrationChange: (checked: any) => {
                saveDiscordBoolPreference('discordWorldIntegration', checked);
            },
            onDiscordInstanceChange: (checked: any) => {
                saveDiscordBoolPreference('discordInstance', checked);
            },
            onDiscordShowPlatformChange: (checked: any) => {
                saveDiscordBoolPreference('discordShowPlatform', checked);
            },
            onDiscordShowPrivateDetailsChange: (checked: any) => {
                saveDiscordBoolPreference('discordHideInvite', !checked);
            },
            onDiscordJoinButtonChange: (checked: any) => {
                saveDiscordBoolPreference('discordJoinButton', checked);
            },
            onDiscordShowImagesChange: (checked: any) => {
                saveDiscordBoolPreference('discordHideImage', !checked);
            },
            onDiscordWorldNameAsStatusChange: (checked: any) => {
                saveDiscordBoolPreference(
                    'discordWorldNameAsDiscordStatus',
                    checked
                );
            },
            onTranslationApiEnabledChange: (checked: any) => {
                saveIntegrationBoolPreference('translationAPI', checked, () =>
                    setTranslationApiEnabledPreference(checked)
                );
            },
            onOpenTranslationApiDialog: () => {
                openTranslationApiDialog();
            },
            onYoutubeApiEnabledChange: (checked: any) => {
                saveIntegrationBoolPreference('youtubeAPI', checked, () =>
                    setYoutubeApiEnabledPreference(checked)
                );
            },
            onOpenYoutubeApiDialog: () => {
                openYoutubeApiDialog();
            },
            onAvatarProviderEnabledChange: (checked: any) => {
                saveAvatarProviderEnabled(checked);
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
                savePreferenceValue(
                    'recentActionCooldownEnabled',
                    checked,
                    () => setRecentActionCooldownEnabledPreference(checked)
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
                toggleLocalFavoriteFriendsGroup(groupKey, checked);
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
            migrateLegacyVrcxData
        },
        dialogs: {
            customFontDialogOpen,
            setCustomFontDialogOpen,
            customFontDraft,
            setCustomFontDraft,
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
            overlayActivityFilters: prefs.overlayActivityFilters,
            saveOverlayActivityFilters,
            vrNotificationActivityFilters: prefs.vrNotificationActivityFilters,
            saveVrNotificationActivityFilters
        }
    };
}
