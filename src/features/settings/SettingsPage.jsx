import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { PageHeader, PageTitle } from '@/components/layout/PageScaffold.jsx';
import {
    clearFavoriteRemoteDetailsCache,
    getFavoriteRemoteDetailsCacheStats
} from '@/features/favorites/useFavoriteRemoteDetails.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import {
    TRUST_COLOR_DEFAULTS
} from '@/lib/trustColors.js';
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
} from '@/services/entityQueryCacheService.js';
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
    normalizePreferenceSnapshot,
    usePreferencesStore
} from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { SettingsDialogs } from './components/SettingsDialogs.jsx';
import { SettingsAdvancedTab } from './components/settings-tabs/SettingsAdvancedTab.jsx';
import { SettingsIntegrationsTab } from './components/settings-tabs/SettingsIntegrationsTab.jsx';
import { SettingsInterfaceTab } from './components/settings-tabs/SettingsInterfaceTab.jsx';
import { SettingsMediaTab } from './components/settings-tabs/SettingsMediaTab.jsx';
import { SettingsNotificationsTab } from './components/settings-tabs/SettingsNotificationsTab.jsx';
import { SettingsSocialTab } from './components/settings-tabs/SettingsSocialTab.jsx';
import { SettingsSystemTab } from './components/settings-tabs/SettingsSystemTab.jsx';
import {
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    formatByteSize,
    isValidFontFamilyList,
    normalizeSharedFeedFilters,
    parseIntegerInput,
    TABLE_PAGE_SIZE_DEFAULTS
} from './settingsValues.js';
import { appI18n } from '@/services/i18nService.js';
import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsOptions,
    settingsTabs,
    sqliteTableSizeRows,
    translationProviderOptions
} from './settingsOptions.js';
import { useAvatarProviderConfig } from './useAvatarProviderConfig.js';
import { useSettingsIntegrations } from './useSettingsIntegrations.js';

export function SettingsPage() {
    const { t } = useI18n();
    const locale = useShellStore((state) => state.locale);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const auth = useRuntimeStore((state) => state.auth);
    const gameState = useRuntimeStore((state) => state.gameState);
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
    const preferenceState = usePreferencesStore();

    const [prefs, setPrefs] = useState({
        notificationLayout: 'notification-center',
        dataTableStriped: false,
        tableDensity: 'standard',
        showPointerOnHover: true,
        accessibleStatusIndicators: false,
        showNewDashboardButton: false,
        recentActionCooldownEnabled: false,
        recentActionCooldownMinutes: 60,
        screenshotHelper: true,
        screenshotHelperModifyFilename: false,
        screenshotHelperCopyToClipboard: false,
        saveInstancePrints: false,
        cropInstancePrints: false,
        saveInstanceStickers: false,
        saveInstanceEmoji: false,
        userGeneratedContentPath: '',
        showInstanceIdInLocation: false,
        isAgeGatedInstancesVisible: true,
        displayVRCPlusIconsAsAvatar: true,
        sortFavorites: true,
        weekStartsOn: 1,
        dtIsoFormat: false,
        dtHour12: false,
        hideNicknames: false,
        hideUserNotes: false,
        hideUserMemos: false,
        hideUnfriends: false,
        randomUserColours: false,
        notificationIconDot: true,
        desktopToast: 'Never',
        afkDesktopToast: false,
        notificationTTS: 'Never',
        notificationTTSNickName: false,
        notificationTTSVoice: '0',
        relaunchVRChatAfterCrash: false,
        vrcQuitFix: true,
        autoSweepVRChatCache: false,
        showConfirmationOnSwitchAvatar: true,
        gameLogDisabled: false,
        avatarAutoCleanup: 'Off',
        enableAppLauncher: true,
        enableAppLauncherAutoClose: true,
        enableAppLauncherRunProcessOnce: true,
        udonExceptionLogging: false,
        logResourceLoad: false,
        logEmptyAvatars: false,
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        isStartAtWindowsStartup: false,
        isStartAsMinimizedState: false,
        isCloseToTray: false,
        navIsCollapsed: false,
        proxyServer: '',
        tablePageSizes: [...TABLE_PAGE_SIZE_DEFAULTS],
        tableLimits: {
            maxTableSize: DEFAULT_MAX_TABLE_SIZE,
            searchLimit: DEFAULT_SEARCH_LIMIT
        },
        localFavoriteFriendsGroups: [],
        sharedFeedFilters: normalizeSharedFeedFilters(),
        youtubeAPI: false,
        translationAPI: false,
        bioLanguage: 'en',
        translationAPIType: 'google',
        translationAPIEndpoint: DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: '',
        discordActive: false,
        discordInstance: true,
        discordHideInvite: true,
        discordJoinButton: false,
        discordHideImage: false,
        discordShowPlatform: true,
        discordWorldIntegration: true,
        discordWorldNameAsDiscordStatus: false,
        appFontFamily: APP_FONT_DEFAULT_KEY,
        appCjkFontPack: APP_CJK_FONT_PACK_DEFAULT_KEY,
        customFontFamily: '',
        trustColor: { ...TRUST_COLOR_DEFAULTS }
    });
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
    function applyPreferenceSnapshotToLocalState(snapshot) {
        const normalizedSnapshot = normalizePreferenceSnapshot(snapshot);
        setPrefs((current) => ({ ...current, ...normalizedSnapshot }));
        setIntegrationPrefs((current) => ({
            ...current,
            youtubeAPI: normalizedSnapshot.youtubeAPI,
            translationAPI: normalizedSnapshot.translationAPI,
            bioLanguage: normalizedSnapshot.bioLanguage,
            translationAPIType: normalizedSnapshot.translationAPIType,
            translationAPIEndpoint: normalizedSnapshot.translationAPIEndpoint,
            translationAPIModel: normalizedSnapshot.translationAPIModel,
            translationAPIPrompt: normalizedSnapshot.translationAPIPrompt
        }));
        setDiscordPrefs({
            discordActive: normalizedSnapshot.discordActive,
            discordInstance: normalizedSnapshot.discordInstance,
            discordHideInvite: normalizedSnapshot.discordHideInvite,
            discordJoinButton: normalizedSnapshot.discordJoinButton,
            discordHideImage: normalizedSnapshot.discordHideImage,
            discordShowPlatform: normalizedSnapshot.discordShowPlatform,
            discordWorldIntegration: normalizedSnapshot.discordWorldIntegration,
            discordWorldNameAsDiscordStatus:
                normalizedSnapshot.discordWorldNameAsDiscordStatus
        });
        setSharedFeedFilters(normalizedSnapshot.sharedFeedFilters);
        setLocalFavoriteFriendsGroups(
            normalizedSnapshot.localFavoriteFriendsGroups
        );
    }

    useEffect(() => {
        if (!preferenceState.preferencesHydrated) {
            return;
        }
        applyPreferenceSnapshotToLocalState(preferenceState);
    }, [preferenceState]);

    useEffect(() => {
        let active = true;
        Promise.all([
            loadPreferenceSnapshot(),
            avatarSearchProviderRepository.getConfig()
        ])
            .then(([snapshot, avatarConfig]) => {
                if (!active) {
                    return;
                }
                applyPreferenceSnapshotToLocalState(snapshot);
                applyAvatarProviderConfig(avatarConfig);
            })
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.settings.generated_toast.failed_to_load_settings')
                );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('VRCX_fontFamily', APP_FONT_DEFAULT_KEY),
            configRepository.getString(
                'VRCX_cjkFontPack',
                APP_CJK_FONT_PACK_DEFAULT_KEY
            ),
            configRepository.getString('customFontFamily', '')
        ])
            .then(([appFontFamily, appCjkFontPack, customFontFamily]) => {
                if (!active) {
                    return;
                }
                const normalizedFont = normalizeAppFontFamily(appFontFamily);
                const normalizedCjkFont =
                    normalizeAppCjkFontPack(appCjkFontPack);
                setPrefs((current) => ({
                    ...current,
                    appFontFamily: normalizedFont,
                    appCjkFontPack: normalizedCjkFont,
                    customFontFamily: customFontFamily || ''
                }));
                applyAppFontPreferences({
                    fontFamily: normalizedFont,
                    customFontFamily: customFontFamily || '',
                    cjkFontPack: normalizedCjkFont
                });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        setZoomInput(String(normalizeZoomLevel(zoomLevel)));
    }, [zoomLevel]);

    useEffect(() => {
        setPrefs((current) => ({ ...current, navIsCollapsed: !sidebarOpen }));
    }, [sidebarOpen]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return undefined;
        }
        const updateVoices = () => {
            setTtsVoices(window.speechSynthesis.getVoices());
        };
        updateVoices();
        window.speechSynthesis.addEventListener?.(
            'voiceschanged',
            updateVoices
        );
        const timeoutId = window.setTimeout(updateVoices, 5000);
        return () => {
            window.speechSynthesis.removeEventListener?.(
                'voiceschanged',
                updateVoices
            );
            window.clearTimeout(timeoutId);
        };
    }, []);

    const feedFilterOptions = useMemo(() => feedFiltersOptions(), []);
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
    const tableMaxSizeError = useMemo(() => {
        const value = Number.parseInt(tableLimitsDraft.maxTableSize, 10);
        if (
            !Number.isFinite(value) ||
            value < TABLE_MAX_SIZE_MIN ||
            value > TABLE_MAX_SIZE_MAX
        ) {
            return t('prompt.table_entries_settings.table_max_entries_error', {
                min: TABLE_MAX_SIZE_MIN,
                max: TABLE_MAX_SIZE_MAX
            });
        }
        return '';
    }, [t, tableLimitsDraft.maxTableSize]);
    const searchLimitError = useMemo(() => {
        const value = Number.parseInt(tableLimitsDraft.searchLimit, 10);
        if (
            !Number.isFinite(value) ||
            value < SEARCH_LIMIT_MIN ||
            value > SEARCH_LIMIT_MAX
        ) {
            return t(
                'prompt.table_entries_settings.search_limit_returns_error',
                {
                    min: SEARCH_LIMIT_MIN,
                    max: SEARCH_LIMIT_MAX
                }
            );
        }
        return '';
    }, [t, tableLimitsDraft.searchLimit]);
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
                    : appI18n.t('view.settings.generated_toast.failed_to_save_setting')
            );
            return false;
        }
    }

    const {
        addAvatarProvider,
        applyAvatarProviderConfig,
        avatarProviderConfig,
        avatarProviderConfigRef,
        removeAvatarProvider,
        saveAvatarProviderConfig,
        saveAvatarProviderField,
        updateAvatarProvider
    } = useAvatarProviderConfig({ commit });
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
    } = useSettingsIntegrations({ commit, t });


    async function savePreferenceValue(key, value, action) {
        await commit(action, () => {
            const previous = prefs[key];
            setPrefs((current) => ({ ...current, [key]: value }));
            return () =>
                setPrefs((current) => ({ ...current, [key]: previous }));
        });
    }

    async function saveBoolPreference(key, configKey, value) {
        await savePreferenceValue(key, value, () =>
            setBoolConfigPreference(configKey, value)
        );
    }

    async function saveStringPreference(key, configKey, value) {
        await savePreferenceValue(key, value, () =>
            setStringConfigPreference(configKey, value)
        );
    }

    async function saveFontPreferences({
        fontFamily = prefs.appFontFamily,
        cjkFontPack = prefs.appCjkFontPack,
        customFontFamily = prefs.customFontFamily
    } = {}) {
        const nextFontFamily = normalizeAppFontFamily(fontFamily);
        const nextCjkFontPack = normalizeAppCjkFontPack(cjkFontPack);
        await configRepository.setMany([
            ['VRCX_fontFamily', nextFontFamily],
            ['VRCX_cjkFontPack', nextCjkFontPack]
        ]);
        setPrefs((current) => ({
            ...current,
            appFontFamily: nextFontFamily,
            appCjkFontPack: nextCjkFontPack
        }));
        applyAppFontPreferences({
            fontFamily: nextFontFamily,
            customFontFamily,
            cjkFontPack: nextCjkFontPack
        });
    }

    async function saveFontFamilyPreference(
        fontFamily,
        customFontFamily = prefs.customFontFamily
    ) {
        await saveFontPreferences({ fontFamily, customFontFamily });
    }

    async function selectCjkFontPack(cjkFontPack) {
        await saveFontPreferences({
            fontFamily:
                prefs.appFontFamily === 'custom'
                    ? APP_FONT_DEFAULT_KEY
                    : prefs.appFontFamily,
            cjkFontPack
        });
    }

    function openCustomFontDialog() {
        setCustomFontDraft(
            prefs.customFontFamily || "'My Font', Arial, sans-serif"
        );
        setCustomFontDialogOpen(true);
    }

    async function saveCustomFontFamily(value = customFontDraft) {
        const nextValue = String(value ?? '').trim();
        if (!isValidFontFamilyList(nextValue)) {
            toast.error(
                t(
                    'view.settings.appearance.appearance.font_family_custom_invalid'
                )
            );
            return;
        }
        const previousFontFamily = prefs.appFontFamily;
        const previousCustomFontFamily = prefs.customFontFamily;
        const saved = await commit(
            () =>
                configRepository.setMany([
                    ['customFontFamily', nextValue],
                    ['VRCX_fontFamily', 'custom']
                ]),
            () => {
                setPrefs((current) => ({
                    ...current,
                    appFontFamily: 'custom',
                    customFontFamily: nextValue
                }));
                applyAppFontPreferences({
                    fontFamily: 'custom',
                    customFontFamily: nextValue,
                    cjkFontPack: prefs.appCjkFontPack
                });
                return () => {
                    setPrefs((current) => ({
                        ...current,
                        appFontFamily: previousFontFamily,
                        customFontFamily: previousCustomFontFamily
                    }));
                    applyAppFontPreferences({
                        fontFamily: previousFontFamily,
                        customFontFamily: previousCustomFontFamily,
                        cjkFontPack: prefs.appCjkFontPack
                    });
                };
            }
        );
        if (!saved) {
            return;
        }
        setCustomFontDialogOpen(false);
        toast.success(t('common.settings_saved'));
    }

    async function restorePersistedTrustColors() {
        const persisted = await loadTrustColorPreference();
        setPrefs((current) => ({ ...current, trustColor: persisted }));
    }

    async function saveTrustColor(key, value) {
        try {
            const nextTrustColor = await setTrustColorPreference(key, value);
            setPrefs((current) => ({ ...current, trustColor: nextTrustColor }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_save_trust_color')
            );
            await restorePersistedTrustColors();
        }
    }

    async function resetTrustColors() {
        try {
            const nextTrustColor = await resetTrustColorsPreference();
            setPrefs((current) => ({ ...current, trustColor: nextTrustColor }));
            toast.success(t('common.settings_saved'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_save_trust_color')
            );
        }
    }

    async function refreshSqliteTableSizes() {
        try {
            const sizes = await databaseMaintenanceRepository.getTableSizes(
                auth.currentUserId
            );
            setSqliteTableSizes({
                gps: sizes.gps,
                status: sizes.status,
                bio: sizes.bio,
                avatar: sizes.avatar,
                onlineOffline: sizes.onlineOffline,
                friendLogHistory: sizes.friendLogHistory,
                notification: sizes.notification,
                location: sizes.location,
                joinLeave: sizes.joinLeave,
                portalSpawn: sizes.portalSpawn,
                videoPlay: sizes.videoPlay,
                event: sizes.event,
                external: sizes.external
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_refresh_sqlite_table_sizes')
            );
        }
    }

    async function refreshConfigTreeData() {
        try {
            const response = await vrchatAuthRepository.getConfig({
                endpoint: auth.currentUserEndpoint || ''
            });
            setConfigTreeData(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : {}
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_refresh_config_json')
            );
        }
    }

    async function refreshOnlineVisits() {
        try {
            const response = await vrchatAuthRepository.executeGet('visits', {
                endpoint: auth.currentUserEndpoint || ''
            });
            setOnlineVisitCount(Number(response.json) || 0);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_refresh_online_user_count')
            );
        }
    }

    async function promptProxySettings() {
        let result;
        try {
            result = await prompt({
                title: t('view.settings.general.application.proxy'),
                description: t(
                    'view.settings.general.application.proxy_description'
                ),
                inputValue: usePreferencesStore.getState().proxyServer || '',
                confirmText: t('prompt.proxy_settings.restart'),
                cancelText: t('dialog.alertdialog.cancel')
            });
            if (!result.ok) {
                return;
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_load_proxy_settings')
            );
            return;
        }

        const nextProxyServer = String(result.value ?? '').trim();
        try {
            const proxyServer = await setProxyServerPreference(nextProxyServer);
            setPrefs((current) => ({ ...current, proxyServer }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_save_proxy_settings')
            );
        }
    }

    async function openTablePageSizesDialog() {
        setTablePageSizesDialogOpen(true);
    }

    async function openTableLimitsDialog() {
        const { maxTableSize, searchLimit } =
            usePreferencesStore.getState().tableLimits;
        setTableLimitsDraft({
            maxTableSize: String(
                parseIntegerInput(maxTableSize, DEFAULT_MAX_TABLE_SIZE)
            ),
            searchLimit: String(
                parseIntegerInput(searchLimit, DEFAULT_SEARCH_LIMIT)
            )
        });
        setTableLimitsDialogOpen(true);
    }

    async function saveTableLimitsDialog() {
        if (tableLimitsSaveDisabled) {
            return;
        }
        const nextMaxTableSize = Number.parseInt(
            tableLimitsDraft.maxTableSize,
            10
        );
        const nextSearchLimit = Number.parseInt(
            tableLimitsDraft.searchLimit,
            10
        );
        let savedLimits;
        const saved = await commit(async () => {
            savedLimits = await setTableLimitsPreference({
                maxTableSize: nextMaxTableSize,
                searchLimit: nextSearchLimit
            });
        });
        if (!saved) {
            return;
        }
        setPrefs((current) => ({ ...current, tableLimits: savedLimits }));
        setTableLimitsDialogOpen(false);
        toast.success(t('common.settings_saved'));
    }

    async function toggleLocalFavoriteFriendsGroup(groupKey, checked) {
        const previousGroups = localFavoriteFriendsGroups;
        const nextGroups = checked
            ? Array.from(new Set([...localFavoriteFriendsGroups, groupKey]))
            : localFavoriteFriendsGroups.filter((value) => value !== groupKey);
        await commit(
            () => setLocalFavoriteFriendsGroupsPreference(nextGroups),
            () => {
                setLocalFavoriteFriendsGroups(nextGroups);
                return () => {
                    setLocalFavoriteFriendsGroups(previousGroups);
                };
            }
        );
    }

    async function saveAppLauncherField(key, value) {
        const nextPrefs = { ...prefs, [key]: value };
        await savePreferenceValue(key, value, () =>
            setAppLauncherPreference({
                enabled: nextPrefs.enableAppLauncher,
                autoClose: nextPrefs.enableAppLauncherAutoClose,
                runProcessOnce: nextPrefs.enableAppLauncherRunProcessOnce
            })
        );
    }

    function speakNotificationTts(
        text,
        voiceIndex = Number.parseInt(prefs.notificationTTSVoice, 10) || 0
    ) {
        if (
            typeof window === 'undefined' ||
            !window.speechSynthesis ||
            !window.SpeechSynthesisUtterance
        ) {
            return;
        }
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) {
            toast.warning(t('view.settings.generated.no_text_to_speech_voices_are_available'));
            return;
        }
        const utterance = new window.SpeechSynthesisUtterance();
        utterance.voice =
            voices[Math.min(Math.max(voiceIndex, 0), voices.length - 1)];
        utterance.text = text || 'Notification text-to-speech test';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }

    async function saveNotificationTtsMode(value) {
        if (prefs.notificationTTS === 'Never' && value !== 'Never') {
            speakNotificationTts('Notification text-to-speech enabled');
        } else if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        await saveStringPreference('notificationTTS', 'notificationTTS', value);
    }

    async function saveNotificationTtsVoice(value) {
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
        await backend.app.DeleteAllScreenshotMetadata();
        toast.success(t('view.settings.generated.screenshot_metadata_removed'));
    }

    async function refreshCacheSize() {
        const favoriteStats = getFavoriteRemoteDetailsCacheStats();
        const queryStats = getEntityQueryCacheStats();
        const runtimeState = useRuntimeStore.getState();
        let assetBundleCacheSize = '';
        try {
            assetBundleCacheSize = formatByteSize(
                await backend.assetBundle.GetCacheSize()
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
    }

    async function clearVrcxCache() {
        const queryCacheCount = getEntityQueryCacheSize();
        await clearEntityQueryCache();
        const avatarNameCacheCount =
            avatarProfileRepository.clearAvatarNameCache();
        const favoriteStats = clearFavoriteRemoteDetailsCache();
        setCacheStats((current) => ({
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
            appI18n.t('view.settings.generated_dynamic.cleared_value_query_cache_entries_value_avatar_n', { value: queryCacheCount, value2: avatarNameCacheCount, value3: favoriteStats.detailCacheCount })
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
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            await backend.app.RestartApplication(false);
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

    async function openUgcFolderSelector() {
        const selectedPath = await backend.app
            .OpenFolderSelectorDialog(prefs.userGeneratedContentPath || '')
            .catch((error) => {
                toast.error(
                    error instanceof Error ? error.message : String(error)
                );
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
            title: appI18n.t('view.settings.generated_modal.crop_existing_prints'),
            description:
                appI18n.t('view.settings.generated_modal.crop_already_saved_instance_prints_in_the_config'),
            confirmText: appI18n.t('view.settings.generated_modal.crop_prints'),
            cancelText: appI18n.t('view.settings.generated_modal.skip')
        });
        if (!result.ok) {
            return;
        }

        const ugcFolderPath = await mediaRepository.getUgcPhotoLocation(
            prefs.userGeneratedContentPath
        );
        await mediaRepository.cropAllPrints(ugcFolderPath);
        toast.success(t('view.settings.generated.existing_saved_prints_cropped'));
    }

    async function handleCropInstancePrintsChange(checked) {
        const saved = await commit(
            () => setCropInstancePrintsPreference(checked),
            () => {
                setPrefs((current) => ({
                    ...current,
                    cropInstancePrints: checked
                }));
                return () =>
                    setPrefs((current) => ({
                        ...current,
                        cropInstancePrints: !checked
                    }));
            }
        );
        if (saved && checked) {
            await promptCropExistingPrints().catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.settings.generated_toast.failed_to_crop_existing_prints')
                );
            });
        }
    }

    async function handleGameLogDisabledChange(checked) {
        if (gameState.isGameRunning) {
            toast.error(t('message.gamelog.vrchat_must_be_closed'));
            return;
        }
        if (checked) {
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
            checked
        );
    }

    function saveSharedFeedFilters(nextFilters) {
        setSharedFeedFilters(nextFilters);
        void setSharedFeedFiltersPreference(nextFilters).catch((error) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.settings.generated_toast.failed_to_save_feed_filters')
            );
        });
    }

    function updateSharedFeedFilter(mode, key, value) {
        const nextFilters = normalizeSharedFeedFilters({
            ...sharedFeedFilters,
            [mode]: {
                ...sharedFeedFilters[mode],
                [key]: value
            }
        });
        saveSharedFeedFilters(nextFilters);
    }

    function resetSharedFeedFilters(mode) {
        const nextFilters = normalizeSharedFeedFilters({
            ...sharedFeedFilters,
            [mode]: { ...sharedFeedFiltersDefaults[mode] }
        });
        saveSharedFeedFilters(nextFilters);
    }

    return (
        <div className="x-container flex flex-1 flex-col overflow-hidden p-4">
            <PageHeader>
                <PageTitle>{t('view.settings.header')}</PageTitle>
            </PageHeader>
            <Tabs
                value={activeSettingsTab}
                onValueChange={setActiveSettingsTab}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div className="max-w-full shrink-0 overflow-x-auto">
                    <TabsList>
                        {settingsTabs.map(([value, labelKey]) => (
                            <TabsTrigger key={value} value={value}>
                                {t(labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                {loading ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Spinner />
                        {t('view.settings.generated.loading_settings_snapshot')}
                    </div>
                ) : null}
                <SettingsSystemTab
                    t={t}
                    versionText={
                        formatReleaseDisplayVersion(VERSION || '') || '-'
                    }
                    isStartAtWindowsStartup={prefs.isStartAtWindowsStartup}
                    isStartAsMinimizedState={prefs.isStartAsMinimizedState}
                    isCloseToTray={prefs.isCloseToTray}
                    onOpenRepository={() =>
                        void openExternalLink(
                            'https://github.com/Map1en/VRCX-0'
                        )
                    }
                    onOpenSupport={() =>
                        void openExternalLink(
                            'https://github.com/Map1en/VRCX-0/issues'
                        )
                    }
                    onStartAtWindowsStartupChange={(checked) =>
                        void savePreferenceValue(
                            'isStartAtWindowsStartup',
                            checked,
                            () => setStartAtWindowsStartupPreference(checked)
                        )
                    }
                    onStartAsMinimizedChange={(checked) =>
                        void savePreferenceValue(
                            'isStartAsMinimizedState',
                            checked,
                            () => setStartAsMinimizedPreference(checked)
                        )
                    }
                    onCloseToTrayChange={(checked) =>
                        void savePreferenceValue('isCloseToTray', checked, () =>
                            setCloseToTrayPreference(checked)
                        )
                    }
                    onProxySettings={() => void promptProxySettings()}
                    onOpenSourceNotice={() => setOpenSourceNoticeOpen(true)}
                />
                <SettingsInterfaceTab
                    t={t}
                    locale={locale}
                    prefs={prefs}
                    zoomInput={zoomInput}
                    zoomLevel={zoomLevel}
                    onLanguageChange={(value) =>
                        void commit(() => setAppLanguagePreference(value))
                    }
                    onFontFamilyChange={(value) => {
                        if (value === 'custom') {
                            openCustomFontDialog();
                            return;
                        }
                        void saveFontFamilyPreference(value);
                    }}
                    onCjkFontPackChange={(value) =>
                        void selectCjkFontPack(value)
                    }
                    onZoomInputChange={setZoomInput}
                    onZoomBlur={() =>
                        void commit(async () => {
                            const nextZoom = await setZoomLevelPreference(
                                zoomInput
                            );
                            setZoomInput(String(nextZoom));
                        })
                    }
                    onNotificationIconDotChange={(checked) =>
                        void saveBoolPreference(
                            'notificationIconDot',
                            'notificationIconDot',
                            checked
                        )
                    }
                    onDataTableStripedChange={(checked) =>
                        void savePreferenceValue(
                            'dataTableStriped',
                            checked,
                            () => setDataTableStripedPreference(checked)
                        )
                    }
                    onPointerOnHoverChange={(checked) =>
                        void savePreferenceValue(
                            'showPointerOnHover',
                            checked,
                            () => setPointerOnHoverPreference(checked)
                        )
                    }
                    onAccessibleStatusIndicatorsChange={(checked) =>
                        void savePreferenceValue(
                            'accessibleStatusIndicators',
                            checked,
                            () =>
                                setAccessibleStatusIndicatorsPreference(checked)
                        )
                    }
                    onShowInstanceIdInLocationChange={(checked) =>
                        void saveBoolPreference(
                            'showInstanceIdInLocation',
                            'VRCX_showInstanceIdInLocation',
                            checked
                        )
                    }
                    onAgeGatedInstancesVisibleChange={(checked) =>
                        void saveBoolPreference(
                            'isAgeGatedInstancesVisible',
                            'VRCX_isAgeGatedInstancesVisible',
                            checked
                        )
                    }
                    onHideNicknamesChange={(checked) =>
                        void saveBoolPreference(
                            'hideNicknames',
                            'hideNicknames',
                            !checked
                        )
                    }
                    onDisplayVrcPlusIconsAsAvatarChange={(checked) =>
                        void saveBoolPreference(
                            'displayVRCPlusIconsAsAvatar',
                            'displayVRCPlusIconsAsAvatar',
                            checked
                        )
                    }
                    onShowNewDashboardButtonChange={(checked) =>
                        void savePreferenceValue(
                            'showNewDashboardButton',
                            checked,
                            () => setShowNewDashboardButtonPreference(checked)
                        )
                    }
                    onSortFavoritesChange={(value) =>
                        void saveBoolPreference(
                            'sortFavorites',
                            'sortFavorites',
                            value === 'date'
                        )
                    }
                    onOpenTablePageSizes={() => void openTablePageSizesDialog()}
                    onOpenTableLimits={() => void openTableLimitsDialog()}
                    onHour12Change={(value) =>
                        void saveBoolPreference(
                            'dtHour12',
                            'dtHour12',
                            value === '12'
                        )
                    }
                    onIsoFormatChange={(checked) =>
                        void saveBoolPreference(
                            'dtIsoFormat',
                            'dtIsoFormat',
                            checked
                        )
                    }
                    onWeekStartsOnChange={(value) =>
                        void savePreferenceValue(
                            'weekStartsOn',
                            Number.parseInt(value, 10),
                            () =>
                                setIntConfigPreference('weekStartsOn', value, {
                                    min: 0,
                                    max: 6,
                                    fallback: 1
                                })
                        )
                    }
                    onHideUserNotesChange={(checked) =>
                        void saveBoolPreference(
                            'hideUserNotes',
                            'hideUserNotes',
                            !checked
                        )
                    }
                    onHideUserMemosChange={(checked) =>
                        void saveBoolPreference(
                            'hideUserMemos',
                            'hideUserMemos',
                            !checked
                        )
                    }
                    onHideUnfriendsChange={(checked) =>
                        void saveBoolPreference(
                            'hideUnfriends',
                            'hideUnfriends',
                            checked
                        )
                    }
                    onRandomUserColoursChange={(checked) =>
                        void saveBoolPreference(
                            'randomUserColours',
                            'VRCX_randomUserColours',
                            checked
                        )
                    }
                    onResetTrustColors={() => void resetTrustColors()}
                    onSaveTrustColor={(key, value) =>
                        void saveTrustColor(key, value)
                    }
                    onTrustColorDraftChange={(key, value) =>
                        setPrefs((current) => ({
                            ...current,
                            trustColor: {
                                ...current.trustColor,
                                [key]: value
                            }
                        }))
                    }
                />                <SettingsMediaTab
                    t={t}
                    prefs={prefs}
                    onScreenshotHelperChange={(checked) =>
                        void commit(
                            () => setScreenshotHelperPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    screenshotHelper: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        screenshotHelper: !checked
                                    }));
                            }
                        )
                    }
                    onScreenshotHelperModifyFilenameChange={(checked) =>
                        void commit(
                            () =>
                                setScreenshotHelperModifyFilenamePreference(
                                    checked
                                ),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    screenshotHelperModifyFilename: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        screenshotHelperModifyFilename: !checked
                                    }));
                            }
                        )
                    }
                    onScreenshotHelperCopyToClipboardChange={(checked) =>
                        void commit(
                            () =>
                                setScreenshotHelperCopyToClipboardPreference(
                                    checked
                                ),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    screenshotHelperCopyToClipboard: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        screenshotHelperCopyToClipboard: !checked
                                    }));
                            }
                        )
                    }
                    onDeleteAllScreenshotMetadata={() =>
                        void deleteAllScreenshotMetadata()
                    }
                    onOpenUgcPhotosFolder={() =>
                        void backend.app.OpenUGCPhotosFolder(
                            prefs.userGeneratedContentPath || ''
                        )
                    }
                    onOpenUgcFolderSelector={() =>
                        void openUgcFolderSelector()
                    }
                    onResetUgcFolder={() => void resetUgcFolder()}
                    onSaveInstancePrintsChange={(checked) =>
                        void commit(
                            () => setSaveInstancePrintsPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    saveInstancePrints: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        saveInstancePrints: !checked
                                    }));
                            }
                        )
                    }
                    onCropInstancePrintsChange={(checked) =>
                        void handleCropInstancePrintsChange(checked)
                    }
                    onSaveInstanceStickersChange={(checked) =>
                        void commit(
                            () => setSaveInstanceStickersPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    saveInstanceStickers: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        saveInstanceStickers: !checked
                                    }));
                            }
                        )
                    }
                    onSaveInstanceEmojiChange={(checked) =>
                        void commit(
                            () => setSaveInstanceEmojiPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    saveInstanceEmoji: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        saveInstanceEmoji: !checked
                                    }));
                            }
                        )
                    }
                />
                <SettingsIntegrationsTab
                    t={t}
                    discordPrefs={discordPrefs}
                    integrationPrefs={integrationPrefs}
                    avatarProviderConfig={avatarProviderConfig}
                    onOpenVrchatConfig={() =>
                        setSystemHostOpen('vrchatConfigOpen', true)
                    }
                    onDiscordActiveChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordActive',
                            checked
                        )
                    }
                    onDiscordWorldIntegrationChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordWorldIntegration',
                            checked
                        )
                    }
                    onDiscordInstanceChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordInstance',
                            checked
                        )
                    }
                    onDiscordShowPlatformChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordShowPlatform',
                            checked
                        )
                    }
                    onDiscordShowPrivateDetailsChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordHideInvite',
                            !checked
                        )
                    }
                    onDiscordJoinButtonChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordJoinButton',
                            checked
                        )
                    }
                    onDiscordShowImagesChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordHideImage',
                            !checked
                        )
                    }
                    onDiscordWorldNameAsStatusChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordWorldNameAsDiscordStatus',
                            checked
                        )
                    }
                    onTranslationApiEnabledChange={(checked) =>
                        void commit(
                            () =>
                                setTranslationApiEnabledPreference(checked),
                            () => {
                                setIntegrationValue('translationAPI', checked);
                                return () =>
                                    setIntegrationValue(
                                        'translationAPI',
                                        !checked
                                    );
                            }
                        )
                    }
                    onOpenTranslationApiDialog={openTranslationApiDialog}
                    onYoutubeApiEnabledChange={(checked) =>
                        void commit(
                            () => setYoutubeApiEnabledPreference(checked),
                            () => {
                                setIntegrationValue('youtubeAPI', checked);
                                return () =>
                                    setIntegrationValue('youtubeAPI', !checked);
                            }
                        )
                    }
                    onOpenYoutubeApiDialog={openYoutubeApiDialog}
                    onAvatarProviderEnabledChange={(checked) =>
                        void commit(
                            () =>
                                saveAvatarProviderConfig({
                                    ...avatarProviderConfigRef.current,
                                    enabled: checked
                                }),
                            () => {
                                const previous =
                                    avatarProviderConfigRef.current;
                                applyAvatarProviderConfig({
                                    ...avatarProviderConfigRef.current,
                                    enabled: checked
                                });
                                return () =>
                                    applyAvatarProviderConfig(previous);
                            }
                        )
                    }
                    onOpenAvatarProviderDialog={() =>
                        setAvatarProviderDialogOpen(true)
                    }
                />
                <SettingsSocialTab
                    t={t}
                    prefs={prefs}
                    selectedFavoriteFriendGroupLabel={
                        selectedFavoriteFriendGroupLabel
                    }
                    favoriteFriendGroupOptions={favoriteFriendGroupOptions}
                    remoteFavoriteFriendGroupOptions={
                        remoteFavoriteFriendGroupOptions
                    }
                    localFavoriteFriendGroupOptions={
                        localFavoriteFriendGroupOptions
                    }
                    localFavoriteFriendsGroups={localFavoriteFriendsGroups}
                    onRecentActionCooldownEnabledChange={(checked) =>
                        void commit(
                            () =>
                                setRecentActionCooldownEnabledPreference(
                                    checked
                                ),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    recentActionCooldownEnabled: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        recentActionCooldownEnabled: !checked
                                    }));
                            }
                        )
                    }
                    onRecentActionCooldownMinutesChange={(value) =>
                        setPrefs((current) => ({
                            ...current,
                            recentActionCooldownMinutes: value
                        }))
                    }
                    onRecentActionCooldownMinutesBlur={(value) =>
                        void commit(async () => {
                            const minutes =
                                await setRecentActionCooldownMinutesPreference(
                                    value
                                );
                            setPrefs((current) => ({
                                ...current,
                                recentActionCooldownMinutes: minutes
                            }));
                        })
                    }
                    onToggleLocalFavoriteFriendsGroup={(groupId, checked) =>
                        void toggleLocalFavoriteFriendsGroup(groupId, checked)
                    }
                />
                <SettingsNotificationsTab
                    t={t}
                    prefs={prefs}
                    notificationLayoutOptions={notificationLayoutOptions}
                    desktopToastOptions={desktopToastOptions}
                    notificationTtsOptions={notificationTtsOptions}
                    ttsVoices={ttsVoices}
                    notificationTtsTestVisible={notificationTtsTestVisible}
                    notificationTtsTest={notificationTtsTest}
                    onNotificationLayoutChange={(value) =>
                        void commit(
                            async () => {
                                const nextLayout =
                                    await setNotificationLayoutPreference(
                                        value
                                    );
                                setPrefs((current) => ({
                                    ...current,
                                    notificationLayout: nextLayout
                                }));
                            },
                            () => {
                                const previous = prefs.notificationLayout;
                                setPrefs((current) => ({
                                    ...current,
                                    notificationLayout: value
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        notificationLayout: previous
                                    }));
                            }
                        )
                    }
                    onOpenFeedFilterDialog={() =>
                        setFeedFilterDialogOpen(true)
                    }
                    onTestDesktopNotification={() =>
                        void backend.app.DesktopNotification(
                            'VRCX-0',
                            t(
                                'view.settings.notifications.notifications.test_message'
                            )
                        )
                    }
                    onDesktopToastChange={(value) =>
                        void saveStringPreference(
                            'desktopToast',
                            'desktopToast',
                            value
                        )
                    }
                    onAfkDesktopToastChange={(checked) =>
                        void saveBoolPreference(
                            'afkDesktopToast',
                            'afkDesktopToast',
                            checked
                        )
                    }
                    onNotificationTtsModeChange={(value) =>
                        void saveNotificationTtsMode(value)
                    }
                    onNotificationTtsVoiceChange={(value) =>
                        void saveNotificationTtsVoice(value)
                    }
                    onNotificationTtsNicknameChange={(checked) =>
                        void saveBoolPreference(
                            'notificationTTSNickName',
                            'notificationTTSNickName',
                            checked
                        )
                    }
                    onNotificationTtsTestVisibleChange={
                        setNotificationTtsTestVisible
                    }
                    onNotificationTtsTestChange={setNotificationTtsTest}
                    onSpeakNotificationTts={(message) =>
                        speakNotificationTts(message)
                    }
                />
                <SettingsAdvancedTab
                    t={t}
                    prefs={prefs}
                    cacheStats={cacheStats}
                    avatarAutoCleanupOptions={avatarAutoCleanupOptions}
                    sqliteTableSizes={sqliteTableSizes}
                    sqliteTableSizeRows={sqliteTableSizeRows}
                    onlineVisitCount={onlineVisitCount}
                    configTreeData={configTreeData}
                    gameLogDisabledLabel={appI18n.t(
                        'view.settings.generated_dynamic.value_value',
                        {
                            value: t(
                                'view.settings.advanced.advanced.cache_debug.disable_gamelog'
                            ),
                            value2: t(
                                'view.settings.advanced.advanced.cache_debug.disable_gamelog_notice'
                            )
                        }
                    )}
                    onRelaunchVRChatAfterCrashChange={(checked) =>
                        void saveBoolPreference(
                            'relaunchVRChatAfterCrash',
                            'VRCX_relaunchVRChatAfterCrash',
                            checked
                        )
                    }
                    onVrcQuitFixChange={(checked) =>
                        void saveBoolPreference('vrcQuitFix', 'vrcQuitFix', checked)
                    }
                    onAutoSweepVRChatCacheChange={(checked) =>
                        void saveBoolPreference(
                            'autoSweepVRChatCache',
                            'VRCX_autoSweepVRChatCache',
                            checked
                        )
                    }
                    onUdonExceptionLoggingChange={(checked) =>
                        void saveBoolPreference(
                            'udonExceptionLogging',
                            'VRCX_udonExceptionLogging',
                            checked
                        )
                    }
                    onLogResourceLoadChange={(checked) =>
                        void saveBoolPreference(
                            'logResourceLoad',
                            'logResourceLoad',
                            checked
                        )
                    }
                    onLogEmptyAvatarsChange={(checked) =>
                        void saveBoolPreference(
                            'logEmptyAvatars',
                            'logEmptyAvatars',
                            checked
                        )
                    }
                    onAutoLoginDelayEnabledChange={(checked) =>
                        void saveBoolPreference(
                            'autoLoginDelayEnabled',
                            'VRCX_autoLoginDelayEnabled',
                            checked
                        )
                    }
                    onPromptAutoLoginDelaySeconds={() =>
                        void promptAutoLoginDelaySeconds()
                    }
                    onOpenShortcutFolder={() =>
                        void backend.app.OpenShortcutFolder()
                    }
                    onEnableAppLauncherChange={(checked) =>
                        void saveAppLauncherField('enableAppLauncher', checked)
                    }
                    onEnableAppLauncherAutoCloseChange={(checked) =>
                        void saveAppLauncherField(
                            'enableAppLauncherAutoClose',
                            checked
                        )
                    }
                    onEnableAppLauncherRunProcessOnceChange={(checked) =>
                        void saveAppLauncherField(
                            'enableAppLauncherRunProcessOnce',
                            checked
                        )
                    }
                    onShowConfirmationOnSwitchAvatarChange={(checked) =>
                        void saveBoolPreference(
                            'showConfirmationOnSwitchAvatar',
                            'showConfirmationOnSwitchAvatar',
                            checked
                        )
                    }
                    onClearVrcxCache={() => void clearVrcxCache()}
                    onPromptAutoClearVrcxCacheFrequency={() =>
                        void promptAutoClearVrcxCacheFrequency()
                    }
                    onRefreshCacheSize={() => void refreshCacheSize()}
                    onGameLogDisabledChange={(checked) =>
                        void handleGameLogDisabledChange(checked)
                    }
                    onAvatarAutoCleanupChange={(value) =>
                        void saveStringPreference(
                            'avatarAutoCleanup',
                            'avatarAutoCleanup',
                            value
                        )
                    }
                    onOpenPurgeDialog={() => setPurgeDialogOpen(true)}
                    onOpenLaunchOptions={() =>
                        setSystemHostOpen('launchOptionsOpen', true)
                    }
                    onOpenRegistryBackup={() =>
                        setSystemHostOpen('registryBackupOpen', true)
                    }
                    onRefreshSqliteTableSizes={() =>
                        void refreshSqliteTableSizes()
                    }
                    onRefreshOnlineVisits={() => void refreshOnlineVisits()}
                    onRefreshConfigTreeData={() =>
                        void refreshConfigTreeData()
                    }
                    onClearConfigTreeData={() => setConfigTreeData({})}
                />
            </Tabs>
            <SettingsDialogs
                t={t}
                customFont={{
                    open: customFontDialogOpen,
                    setOpen: setCustomFontDialogOpen,
                    draft: customFontDraft,
                    setDraft: setCustomFontDraft,
                    onSave: saveCustomFontFamily
                }}
                youtubeApi={{
                    open: youtubeApiDialogOpen,
                    setOpen: setYoutubeApiDialogOpen,
                    draft: youtubeApiKeyDraft,
                    setDraft: setYoutubeApiKeyDraft,
                    integrationStatus,
                    onSave: saveYoutubeApiKey
                }}
                translationApi={{
                    open: translationApiDialogOpen,
                    setOpen: setTranslationApiDialogOpen,
                    draft: translationDraft,
                    setDraftValue: setTranslationDraftValue,
                    providerOptions: translationProviderOptions,
                    fetchedModels: availableTranslationModels,
                    integrationStatus,
                    onFetchModels: fetchTranslationModels,
                    onTest: testTranslationApiConfig,
                    onSave: saveTranslationApiConfig
                }}
                tablePageSizes={{
                    open: tablePageSizesDialogOpen,
                    setOpen: setTablePageSizesDialogOpen,
                    onSaved: (tablePageSizes) =>
                        setPrefs((current) => ({ ...current, tablePageSizes }))
                }}
                tableLimits={{
                    open: tableLimitsDialogOpen,
                    setOpen: setTableLimitsDialogOpen,
                    draft: tableLimitsDraft,
                    setDraft: setTableLimitsDraft,
                    tableMaxSizeError,
                    searchLimitError,
                    saveDisabled: tableLimitsSaveDisabled,
                    onSave: saveTableLimitsDialog
                }}
                avatarProvider={{
                    open: avatarProviderDialogOpen,
                    setOpen: setAvatarProviderDialogOpen,
                    config: avatarProviderConfig,
                    onUpdate: updateAvatarProvider,
                    onSaveField: saveAvatarProviderField,
                    onRemove: removeAvatarProvider,
                    onAdd: addAvatarProvider
                }}
                purge={{
                    open: purgeDialogOpen,
                    setOpen: setPurgeDialogOpen,
                    period: purgePeriod,
                    setPeriod: setPurgePeriod,
                    inProgress: purgeInProgress,
                    onConfirm: purgeAvatarFeedData
                }}
                feedFilter={{
                    open: feedFilterDialogOpen,
                    setOpen: setFeedFilterDialogOpen,
                    mode: feedFilterMode,
                    setMode: setFeedFilterMode,
                    options: currentSharedFeedFilterOptions,
                    filters: sharedFeedFilters,
                    onUpdate: updateSharedFeedFilter,
                    onReset: resetSharedFeedFilters
                }}
                openSourceNotice={{
                    open: openSourceNoticeOpen,
                    setOpen: setOpenSourceNoticeOpen
                }}
            />
        </div>
    );
}
