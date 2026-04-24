import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { PageHeader, PageTitle } from '@/components/layout/PageScaffold.jsx';
import { openExternalLink } from '@/lib/entityMedia.js';
import { backend } from '@/platform/index.js';
import {
    avatarProfileRepository,
    avatarSearchProviderRepository,
    configRepository,
    databaseMaintenanceRepository,
    feedRepository,
    mediaRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import {
    clearEntityQueryCache,
    getEntityQueryCacheSize,
    getEntityQueryCacheStats
} from '@/lib/entityQueryCache.js';
import {
    loadPreferenceSnapshot,
    setAccessibleStatusIndicatorsPreference,
    setAppLanguagePreference,
    setDataTableStripedPreference,
    setNotificationLayoutPreference,
    setPointerOnHoverPreference,
    setRecentActionCooldownEnabledPreference,
    setRecentActionCooldownMinutesPreference,
    setShowNewDashboardButtonPreference,
    setScreenshotHelperCopyToClipboardPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperPreference,
    setCropInstancePrintsPreference,
    setAppLauncherPreference,
    setBoolConfigPreference,
    setCloseToTrayPreference,
    setIntConfigPreference,
    setSaveInstanceEmojiPreference,
    setSaveInstancePrintsPreference,
    setSaveInstanceStickersPreference,
    setSharedFeedFiltersPreference,
    setStartAsMinimizedPreference,
    setStartAtWindowsStartupPreference,
    setStringConfigPreference,
    setTableLimitsPreference,
    setTranslationApiEnabledPreference,
    setTrustColorPreference,
    setUserGeneratedContentPathPreference,
    setYoutubeApiEnabledPreference,
    loadTrustColorPreference,
    resetTrustColorsPreference,
    setLocalFavoriteFriendsGroupsPreference,
    setProxyServerPreference,
    setZoomLevelPreference
} from '@/services/preferencesService.js';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    normalizeAppCjkFontPack,
    normalizeAppFontFamily,
    normalizeZoomLevel
} from '@/services/themeService.js';
import {
    feedFiltersOptions,
    sharedFeedFiltersDefaults
} from '@/shared/constants/feedFilters.js';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT,
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_MIN,
    TABLE_MAX_SIZE_MAX,
    TABLE_MAX_SIZE_MIN
} from '@/shared/constants/settings.js';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useModalStore } from '@/state/modalStore.js';
import {
    DEFAULT_PREFERENCES,
    normalizePreferenceSnapshot,
    usePreferencesStore
} from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { SettingsAdvancedTab } from './components/settings-tabs/SettingsAdvancedTab.jsx';
import { SettingsIntegrationsTab } from './components/settings-tabs/SettingsIntegrationsTab.jsx';
import { SettingsInterfaceTab } from './components/settings-tabs/SettingsInterfaceTab.jsx';
import { SettingsMediaTab } from './components/settings-tabs/SettingsMediaTab.jsx';
import { SettingsNotificationsTab } from './components/settings-tabs/SettingsNotificationsTab.jsx';
import { SettingsSocialTab } from './components/settings-tabs/SettingsSocialTab.jsx';
import { SettingsSystemTab } from './components/settings-tabs/SettingsSystemTab.jsx';
import { SettingsDialogs } from './components/SettingsDialogs.jsx';
import { createDefaultSettingsPrefs } from './settingsDefaultPrefs.js';
import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsOptions,
    settingsTabs,
    sqliteTableSizeRows,
    translationProviderOptions
} from './settingsOptions.js';
import {
    formatByteSize,
    isValidFontFamilyList,
    normalizeSharedFeedFilters,
    parseIntegerInput
} from './settingsValues.js';
import { useAvatarProviderConfig } from './useAvatarProviderConfig.js';
import { useSettingsIntegrations } from './useSettingsIntegrations.js';
import { useSettingsPageActions } from './useSettingsPageActions.js';
import { useSettingsPageEffects } from './useSettingsPageEffects.js';

const FEED_FILTER_OPTIONS = feedFiltersOptions();
const SETTINGS_PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES);

export function useSettingsPageController() {
    const { t } = useTranslation();
    const locale = useShellStore((state) => state.locale);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const preferenceState = usePreferencesStore(
        useShallow((state) => {
            const snapshot = {
                preferencesHydrated: state.preferencesHydrated
            };
            for (const key of SETTINGS_PREFERENCE_KEYS) {
                snapshot[key] = state[key];
            }
            return snapshot;
        })
    );
    const auth = useMemo(
        () => ({
            currentUserId,
            currentUserEndpoint
        }),
        [currentUserEndpoint, currentUserId]
    );
    const gameState = useMemo(
        () => ({
            isGameRunning
        }),
        [isGameRunning]
    );
    const [prefs, setPrefs] = useState(() => createDefaultSettingsPrefs());
    const [sqliteTableSizes, setSqliteTableSizes] = useState({});
    const [cacheStats, setCacheStats] = useState({
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
    const [configTreeData, setConfigTreeData] = useState({});
    const [localFavoriteFriendsGroups, setLocalFavoriteFriendsGroups] =
        useState([]);
    const [zoomInput, setZoomInput] = useState('100');
    const [ttsVoices, setTtsVoices] = useState([]);
    const [notificationTtsTest, setNotificationTtsTest] = useState('');
    const [customFontDialogOpen, setCustomFontDialogOpen] = useState(false);
    const [customFontDraft, setCustomFontDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeSettingsTab, setActiveSettingsTab] = useState('system');
    const [feedFilterMode, setFeedFilterMode] = useState('noty');
    const [feedFilterDialogOpen, setFeedFilterDialogOpen] = useState(false);
    const [sharedFeedFilters, setSharedFeedFilters] = useState(() =>
        normalizeSharedFeedFilters()
    );
    const [notificationTtsTestVisible, setNotificationTtsTestVisible] =
        useState(false);
    const [openSourceNoticeOpen, setOpenSourceNoticeOpen] = useState(false);
    const [tablePageSizesDialogOpen, setTablePageSizesDialogOpen] =
        useState(false);
    const [tableLimitsDialogOpen, setTableLimitsDialogOpen] = useState(false);
    const [tableLimitsDraft, setTableLimitsDraft] = useState({
        maxTableSize: String(DEFAULT_MAX_TABLE_SIZE),
        searchLimit: String(DEFAULT_SEARCH_LIMIT)
    });
    const [avatarProviderDialogOpen, setAvatarProviderDialogOpen] =
        useState(false);
    const tableMaxSizeValue = Number.parseInt(
        tableLimitsDraft.maxTableSize,
        10
    );
    const tableMaxSizeError =
        !Number.isFinite(tableMaxSizeValue) ||
        tableMaxSizeValue < TABLE_MAX_SIZE_MIN ||
        tableMaxSizeValue > TABLE_MAX_SIZE_MAX
            ? t('prompt.table_entries_settings.table_max_entries_error', {
                  min: TABLE_MAX_SIZE_MIN,
                  max: TABLE_MAX_SIZE_MAX
              })
            : '';
    const searchLimitValue = Number.parseInt(tableLimitsDraft.searchLimit, 10);
    const searchLimitError =
        !Number.isFinite(searchLimitValue) ||
        searchLimitValue < SEARCH_LIMIT_MIN ||
        searchLimitValue > SEARCH_LIMIT_MAX
            ? t('prompt.table_entries_settings.search_limit_returns_error', {
                  min: SEARCH_LIMIT_MIN,
                  max: SEARCH_LIMIT_MAX
              })
            : '';
    const tableLimitsSaveDisabled = Boolean(
        tableMaxSizeError || searchLimitError
    );

    async function commit(action, optimistic) {
        const rollback = optimistic?.();
        try {
            await action();
            return true;
        } catch (error) {
            rollback?.();
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.generated_toast.failed_to_save_setting')
            );
            return false;
        }
    }

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
        commit,
        t
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
        saveAppLauncherField,
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
        updateSharedFeedFilter,
        resetSharedFeedFilters
    } = useSettingsPageActions({
        APP_FONT_DEFAULT_KEY,
        DEFAULT_MAX_TABLE_SIZE,
        DEFAULT_SEARCH_LIMIT,
        applyAppFontPreferences,
        auth,
        avatarProfileRepository,
        backend,
        clearEntityQueryCache,
        commit,
        configRepository,
        confirm,
        customFontDraft,
        databaseMaintenanceRepository,
        feedRepository,
        formatByteSize,
        gameState,
        getEntityQueryCacheSize,
        getEntityQueryCacheStats,
        isValidFontFamilyList,
        loadTrustColorPreference,
        localFavoriteFriendsGroups,
        mediaRepository,
        normalizeAppCjkFontPack,
        normalizeAppFontFamily,
        normalizePreferenceSnapshot,
        normalizeSharedFeedFilters,
        parseIntegerInput,
        prefs,
        prompt,
        purgePeriod,
        resetTrustColorsPreference,
        setAppLauncherPreference,
        setBoolConfigPreference,
        setCacheStats,
        setConfigTreeData,
        setCropInstancePrintsPreference,
        setCustomFontDialogOpen,
        setCustomFontDraft,
        setDiscordPrefs,
        setIntConfigPreference,
        setIntegrationPrefs,
        setLocalFavoriteFriendsGroups,
        setLocalFavoriteFriendsGroupsPreference,
        setOnlineVisitCount,
        setPrefs,
        setProxyServerPreference,
        setPurgeDialogOpen,
        setPurgeInProgress,
        setSharedFeedFilters,
        setSharedFeedFiltersPreference,
        setSqliteTableSizes,
        setStringConfigPreference,
        setTableLimitsDialogOpen,
        setTableLimitsDraft,
        setTableLimitsPreference,
        setTablePageSizesDialogOpen,
        setTrustColorPreference,
        setUserGeneratedContentPathPreference,
        sharedFeedFilters,
        sharedFeedFiltersDefaults,
        t,
        tableLimitsDraft,
        tableLimitsSaveDisabled,
        toast,
        usePreferencesStore,
        useRuntimeStore,
        vrchatAuthRepository
    });
    useSettingsPageEffects({
        APP_CJK_FONT_PACK_DEFAULT_KEY,
        APP_FONT_DEFAULT_KEY,
        applyAppFontPreferences,
        applyAvatarProviderConfig,
        applyPreferenceSnapshotToLocalState,
        avatarSearchProviderRepository,
        configRepository,
        loadPreferenceSnapshot,
        normalizeAppCjkFontPack,
        normalizeAppFontFamily,
        normalizeZoomLevel,
        preferenceState,
        setLoading,
        setPrefs,
        setTtsVoices,
        setZoomInput,
        sidebarOpen,
        t,
        toast,
        zoomLevel
    });
    const feedFilterOptions = FEED_FILTER_OPTIONS;
    const currentSharedFeedFilterOptions =
        feedFilterMode === 'noty'
            ? feedFilterOptions.notyFeedFiltersOptions
            : feedFilterOptions.wristFeedFiltersOptions;
    const remoteFavoriteFriendGroupOptions = useMemo(
        () =>
            (favoriteFriendGroups || [])
                .map((group) => ({
                    value: group?.key,
                    label: group?.displayName || group?.name || group?.key
                }))
                .filter((group) => group.value),
        [favoriteFriendGroups]
    );
    const localFavoriteFriendGroupOptions = useMemo(
        () =>
            (localFriendFavoriteGroups || [])
                .map((groupName) => ({
                    value: `local:${groupName}`,
                    label: groupName
                }))
                .filter((group) => group.value),
        [localFriendFavoriteGroups]
    );
    const favoriteFriendGroupOptions = useMemo(
        () => [
            ...remoteFavoriteFriendGroupOptions,
            ...localFavoriteFriendGroupOptions
        ],
        [localFavoriteFriendGroupOptions, remoteFavoriteFriendGroupOptions]
    );
    const selectedFavoriteFriendGroupLabel =
        favoriteFriendGroupOptions
            .filter((group) => localFavoriteFriendsGroups.includes(group.value))
            .map((group) => group.label)
            .join(', ') ||
        t('view.settings.general.favorites.group_placeholder');
    return {
        shell: {
            PageHeader,
            PageTitle,
            t,
            Tabs,
            activeSettingsTab,
            setActiveSettingsTab,
            TabsList,
            settingsTabs,
            TabsTrigger,
            loading,
            Spinner
        },
        system: {
            SettingsSystemTab,
            t,
            formatReleaseDisplayVersion,
            prefs,
            openExternalLink,
            savePreferenceValue,
            setStartAtWindowsStartupPreference,
            setStartAsMinimizedPreference,
            setCloseToTrayPreference,
            promptProxySettings,
            setOpenSourceNoticeOpen
        },
        interface: {
            SettingsInterfaceTab,
            t,
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
            setPointerOnHoverPreference,
            setAccessibleStatusIndicatorsPreference,
            setShowNewDashboardButtonPreference,
            openTablePageSizesDialog,
            openTableLimitsDialog,
            setIntConfigPreference,
            resetTrustColors,
            saveTrustColor,
            setPrefs
        },
        media: {
            SettingsMediaTab,
            t,
            prefs,
            commit,
            setScreenshotHelperPreference,
            setScreenshotHelperModifyFilenamePreference,
            setScreenshotHelperCopyToClipboardPreference,
            deleteAllScreenshotMetadata,
            backend,
            openUgcFolderSelector,
            resetUgcFolder,
            setSaveInstancePrintsPreference,
            handleCropInstancePrintsChange,
            setSaveInstanceStickersPreference,
            setSaveInstanceEmojiPreference,
            setPrefs
        },
        integrations: {
            SettingsIntegrationsTab,
            t,
            discordPrefs,
            integrationPrefs,
            avatarProviderConfig,
            setSystemHostOpen,
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
            setAvatarProviderDialogOpen
        },
        social: {
            SettingsSocialTab,
            t,
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
            setPrefs
        },
        notifications: {
            SettingsNotificationsTab,
            t,
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
            backend,
            saveStringPreference,
            saveBoolPreference,
            saveNotificationTtsMode,
            saveNotificationTtsVoice,
            setNotificationTtsTestVisible,
            setNotificationTtsTest,
            speakNotificationTts
        },
        advanced: {
            SettingsAdvancedTab,
            t,
            prefs,
            cacheStats,
            avatarAutoCleanupOptions,
            sqliteTableSizes,
            sqliteTableSizeRows,
            onlineVisitCount,
            configTreeData,
            saveBoolPreference,
            promptAutoLoginDelaySeconds,
            backend,
            saveAppLauncherField,
            clearVrcxCache,
            promptAutoClearVrcxCacheFrequency,
            refreshCacheSize,
            handleGameLogDisabledChange,
            saveStringPreference,
            setPurgeDialogOpen,
            setSystemHostOpen,
            refreshSqliteTableSizes,
            refreshOnlineVisits,
            refreshConfigTreeData,
            setConfigTreeData
        },
        dialogs: {
            SettingsDialogs,
            t,
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
            setFeedFilterMode,
            currentSharedFeedFilterOptions,
            sharedFeedFilters,
            updateSharedFeedFilter,
            resetSharedFeedFilters,
            openSourceNoticeOpen,
            setOpenSourceNoticeOpen
        }
    };
}
