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
    setTableDensityPreference,
    setTranslationApiEnabledPreference,
    setYoutubeApiEnabledPreference,
    setZoomLevelPreference
} from '@/services/preferencesService';
import { feedFiltersOptions } from '@/shared/constants/feedFilters';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { useFavoriteStore } from '@/state/favoriteStore';
import {
    DEFAULT_PREFERENCES,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import { buildFavoriteFriendGroupOptions } from './settingsFavoriteGroupOptions';
import { buildSettingsPageStateSections } from './settingsPageStateSections';
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
    const [customFontDraft, setCustomFontDraft] = useState({
        primary: '',
        secondary: '',
        override: ''
    });
    const [customFontOptions, setCustomFontOptions] = useState<string[]>([]);
    const [customFontOptionsLoading, setCustomFontOptionsLoading] =
        useState(false);
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
    const [desktopNotificationsDialogOpen, setDesktopNotificationsDialogOpen] =
        useState(false);
    const [webhookNotificationsDialogOpen, setWebhookNotificationsDialogOpen] =
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
        saveDesktopNotificationActivityFilters,
        saveWebhookActivityFilters,
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
        setCustomFontOptions,
        setCustomFontOptionsLoading,
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
    const {
        favoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        selectedFavoriteFriendGroupLabel
    } = useMemo(
        () =>
            buildFavoriteFriendGroupOptions({
                favoriteFriendGroups,
                localFriendFavoriteGroups,
                localFavoriteFriendsGroups
            }),
        [
            favoriteFriendGroups,
            localFavoriteFriendsGroups,
            localFriendFavoriteGroups
        ]
    );

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

    return buildSettingsPageStateSections({
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
        setTranslationApiDialogOpen,
        setTranslationDraftValue,
        setTranslationApiEnabledPreference,
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
    });
}
