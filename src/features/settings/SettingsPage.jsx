import { ChevronDownIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { PageHeader, PageTitle } from '@/components/layout/PageScaffold.jsx';
import {
    clearFavoriteRemoteDetailsCache,
    getFavoriteRemoteDetailsCacheStats
} from '@/features/favorites/useFavoriteRemoteDetails.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import {
    isValidTrustColor,
    TRUST_COLOR_DEFAULTS,
    TRUST_COLOR_ENTRIES
} from '@/lib/trustColors.js';
import { getLanguageName, languageCodes } from '@/localization/index.js';
import { backend } from '@/platform/index.js';
import {
    avatarProfileRepository,
    avatarSearchProviderRepository,
    configRepository,
    databaseMaintenanceRepository,
    feedRepository,
    mediaRepository,
    vrchatAuthRepository,
    webRepository
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
    setDiscordBoolPreference,
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
    setTablePageSizesPreference,
    setTranslationApiConfigPreference,
    setTranslationApiEnabledPreference,
    setTrustColorPreference,
    setUserGeneratedContentPathPreference,
    setYoutubeApiEnabledPreference,
    setYoutubeApiKeyPreference,
    loadTrustColorPreference,
    resetTrustColorsPreference,
    setLocalFavoriteFriendsGroupsPreference,
    setProxyServerPreference,
    setZoomLevelPreference
} from '@/services/preferencesService.js';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_CJK_FONT_PACKS,
    APP_FONT_DEFAULT_KEY,
    APP_FONT_FAMILIES,
    applyAppFontPreferences,
    formatZoomPercentage,
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
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Field as ShadcnField,
    FieldLabel as ShadcnFieldLabel
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';

import { OpenSourceNoticeDialog } from './components/OpenSourceNoticeDialog.jsx';
import {
    Field,
    FieldGroup,
    JsonTreeView,
    SegmentedPreference
} from './components/SettingsField.jsx';
import {
    buildOpenAiModelsEndpoint,
    buildTablePageSizeOptions,
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    filterTablePageSizeOptions,
    formatByteSize,
    isValidFontFamilyList,
    normalizeSharedFeedFilters,
    normalizeTablePageSizes,
    parseIntegerInput,
    parseWebJson,
    TABLE_PAGE_SIZE_DEFAULTS
} from './settingsValues.js';

const fontFamilyLabelKeys = {
    inter: 'view.settings.appearance.appearance.font_family_inter',
    noto_sans: 'view.settings.appearance.appearance.font_family_noto_sans',
    geist: 'view.settings.appearance.appearance.font_family_geist',
    nunito_sans: 'view.settings.appearance.appearance.font_family_nunito_sans',
    ibm_plex_sans:
        'view.settings.appearance.appearance.font_family_ibm_plex_sans',
    jetbrains_mono:
        'view.settings.appearance.appearance.font_family_jetbrains_mono',
    fantasque_sans_mono:
        'view.settings.appearance.appearance.font_family_fantasque_sans_mono',
    system_ui: 'view.settings.appearance.appearance.font_family_system_ui',
    custom: 'view.settings.appearance.appearance.font_family_custom'
};
const cjkFontPackLabelKeys = {
    noto: 'view.settings.appearance.appearance.cjk_font_pack_noto',
    puhuiti: 'view.settings.appearance.appearance.cjk_font_pack_puhuiti',
    system: 'view.settings.appearance.appearance.font_family_system_ui'
};
const fontFamilyOptions = APP_FONT_FAMILIES.map((value) => [
    value,
    fontFamilyLabelKeys[value]
]);
const westernFontDropdownOptions = fontFamilyOptions.filter(
    ([value]) => value !== 'custom' && value !== 'system_ui'
);
const cjkFontPackOptions = APP_CJK_FONT_PACKS.map((value) => [
    value,
    cjkFontPackLabelKeys[value]
]);

const notificationLayoutOptions = [
    [
        'notification-center',
        'view.settings.notifications.notifications.layout_notification_center'
    ],
    ['table', 'view.settings.notifications.notifications.layout_table']
];

const desktopToastOptions = [
    ['Never', 'view.settings.notifications.notifications.conditions.never'],
    [
        'Desktop Mode',
        'view.settings.notifications.notifications.conditions.desktop'
    ],
    [
        'Inside VR',
        'view.settings.notifications.notifications.conditions.inside_vr'
    ],
    [
        'Outside VR',
        'view.settings.notifications.notifications.conditions.outside_vr'
    ],
    [
        'Game Running',
        'view.settings.notifications.notifications.conditions.inside_vrchat'
    ],
    [
        'Game Closed',
        'view.settings.notifications.notifications.conditions.outside_vrchat'
    ],
    ['Always', 'view.settings.notifications.notifications.conditions.always']
];
const notificationTtsOptions = [
    ['Never', 'view.settings.notifications.notifications.conditions.never'],
    [
        'Inside VR',
        'view.settings.notifications.notifications.conditions.inside_vr'
    ],
    [
        'Game Running',
        'view.settings.notifications.notifications.conditions.inside_vrchat'
    ],
    [
        'Game Closed',
        'view.settings.notifications.notifications.conditions.outside_vrchat'
    ],
    ['Always', 'view.settings.notifications.notifications.conditions.always']
];
const avatarAutoCleanupOptions = ['Off', '30', '90', '180', '365'];
const sqliteTableSizeRows = [
    ['gps', 'view.settings.advanced.advanced.sqlite_table_size.gps'],
    ['status', 'view.settings.advanced.advanced.sqlite_table_size.status'],
    ['bio', 'view.settings.advanced.advanced.sqlite_table_size.bio'],
    ['avatar', 'view.settings.advanced.advanced.sqlite_table_size.avatar'],
    [
        'onlineOffline',
        'view.settings.advanced.advanced.sqlite_table_size.online_offline'
    ],
    [
        'friendLogHistory',
        'view.settings.advanced.advanced.sqlite_table_size.friend_log_history'
    ],
    [
        'notification',
        'view.settings.advanced.advanced.sqlite_table_size.notification'
    ],
    ['location', 'view.settings.advanced.advanced.sqlite_table_size.location'],
    [
        'joinLeave',
        'view.settings.advanced.advanced.sqlite_table_size.join_leave'
    ],
    [
        'portalSpawn',
        'view.settings.advanced.advanced.sqlite_table_size.portal_spawn'
    ],
    [
        'videoPlay',
        'view.settings.advanced.advanced.sqlite_table_size.video_play'
    ],
    ['event', 'view.settings.advanced.advanced.sqlite_table_size.event']
];
const weekStartOptions = [
    ['1', 'common.days.monday'],
    ['0', 'common.days.sunday'],
    ['6', 'common.days.saturday']
];
const translationProviderOptions = [
    ['google', 'dialog.translation_api.mode_google'],
    ['openai', 'dialog.translation_api.mode_openai']
];

const settingsTabs = [
    ['system', 'view.settings.category.system'],
    ['interface', 'view.settings.category.interface'],
    ['social', 'view.settings.category.social'],
    ['notifications', 'view.settings.category.notifications'],
    ['media', 'view.settings.category.media'],
    ['integrations', 'view.settings.category.integrations'],
    ['advanced', 'view.settings.category.advanced']
];
function SettingsTabContent({ value, children }) {
    return (
        <TabsContent
            value={value}
            className="m-0 min-h-0 w-full min-w-0 gap-4 overflow-x-hidden overflow-y-auto pt-3 pb-4 data-[state=active]:flex data-[state=active]:flex-1 data-[state=active]:flex-col [&>[data-slot=card]]:shrink-0"
        >
            {children}
        </TabsContent>
    );
}

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
    const [avatarProviderConfig, setAvatarProviderConfig] = useState({
        enabled: true,
        providerList: [],
        selectedProvider: ''
    });
    const avatarProviderConfigRef = useRef(avatarProviderConfig);
    const avatarProviderSaveQueueRef = useRef(Promise.resolve());
    const avatarProviderSaveSeqRef = useRef(0);
    const [integrationPrefs, setIntegrationPrefs] = useState({
        youtubeAPI: false,
        youtubeAPIKey: '',
        translationAPI: false,
        bioLanguage: 'en',
        translationAPIType: 'google',
        translationAPIKey: '',
        translationAPIEndpoint: DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: ''
    });
    const [discordPrefs, setDiscordPrefs] = useState({
        discordActive: false,
        discordInstance: true,
        discordHideInvite: true,
        discordJoinButton: false,
        discordHideImage: false,
        discordShowPlatform: true,
        discordWorldIntegration: true,
        discordWorldNameAsDiscordStatus: false
    });
    const [availableTranslationModels, setAvailableTranslationModels] =
        useState([]);
    const [integrationStatus, setIntegrationStatus] = useState({
        youtube: 'idle',
        translation: 'idle',
        models: 'idle'
    });
    const [customFontDialogOpen, setCustomFontDialogOpen] = useState(false);
    const [customFontDraft, setCustomFontDraft] = useState('');
    const [youtubeApiDialogOpen, setYoutubeApiDialogOpen] = useState(false);
    const [youtubeApiKeyDraft, setYoutubeApiKeyDraft] = useState('');
    const [translationApiDialogOpen, setTranslationApiDialogOpen] =
        useState(false);
    const [translationDraft, setTranslationDraft] = useState({
        bioLanguage: 'en',
        translationAPIType: 'google',
        translationAPIKey: '',
        translationAPIEndpoint: DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: ''
    });
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
    const [tablePageSizesDraft, setTablePageSizesDraft] = useState(() => [
        ...TABLE_PAGE_SIZE_DEFAULTS
    ]);
    const [tablePageSizeDraftInput, setTablePageSizeDraftInput] = useState('');
    const [tableLimitsDialogOpen, setTableLimitsDialogOpen] = useState(false);
    const [tableLimitsDraft, setTableLimitsDraft] = useState({
        maxTableSize: String(DEFAULT_MAX_TABLE_SIZE),
        searchLimit: String(DEFAULT_SEARCH_LIMIT)
    });
    const [avatarProviderDialogOpen, setAvatarProviderDialogOpen] =
        useState(false);
    const tablePageSizeOptions = useMemo(
        () => buildTablePageSizeOptions(tablePageSizesDraft),
        [tablePageSizesDraft]
    );
    const filteredTablePageSizeOptions = useMemo(
        () =>
            filterTablePageSizeOptions(
                tablePageSizeOptions,
                tablePageSizeDraftInput
            ),
        [tablePageSizeDraftInput, tablePageSizeOptions]
    );

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
                        : 'Failed to load settings.'
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
        let active = true;
        Promise.all([
            configRepository.getString('youtubeAPIKey', ''),
            configRepository.getString('translationAPIKey', '')
        ])
            .then(([youtubeAPIKey, translationAPIKey]) => {
                if (!active) {
                    return;
                }
                setIntegrationPrefs((current) => ({
                    ...current,
                    youtubeAPIKey: youtubeAPIKey || '',
                    translationAPIKey: translationAPIKey || ''
                }));
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
    const fontDropdownDisplayText =
        prefs.appFontFamily === 'custom'
            ? t('view.settings.appearance.appearance.font_family_custom')
            : `${t(fontFamilyLabelKeys[prefs.appFontFamily] || fontFamilyLabelKeys[APP_FONT_DEFAULT_KEY])} / ${t(cjkFontPackLabelKeys[prefs.appCjkFontPack] || cjkFontPackLabelKeys[APP_CJK_FONT_PACK_DEFAULT_KEY])}`;
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
                    : 'Failed to save setting.'
            );
            return false;
        }
    }

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
                    : 'Failed to save trust color.'
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
                    : 'Failed to save trust color.'
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
                    : 'Failed to refresh SQLite table sizes.'
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
                    : 'Failed to refresh config JSON.'
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
                    : 'Failed to refresh online user count.'
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
                    : 'Failed to load proxy settings.'
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
                    : 'Failed to save proxy settings.'
            );
        }
    }

    async function openTablePageSizesDialog() {
        setTablePageSizesDraft(
            normalizeTablePageSizes(
                usePreferencesStore.getState().tablePageSizes
            )
        );
        setTablePageSizeDraftInput('');
        setTablePageSizesDialogOpen(true);
    }

    async function persistTablePageSizes(
        nextSizes,
        { close = false, showToast = false } = {}
    ) {
        const normalizedSizes = normalizeTablePageSizes(nextSizes);
        setTablePageSizesDraft(normalizedSizes);
        const saved = await commit(() =>
            setTablePageSizesPreference(normalizedSizes)
        );
        if (!saved) {
            return false;
        }
        setPrefs((current) => ({
            ...current,
            tablePageSizes: normalizedSizes
        }));
        if (close) {
            setTablePageSizesDialogOpen(false);
        }
        if (showToast) {
            toast.success(t('common.settings_saved'));
        }
        return true;
    }

    function addTablePageSize(value = tablePageSizeDraftInput, options = {}) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
            toast.error(
                t('view.settings.appearance.appearance.table_page_sizes_error')
            );
            return;
        }
        void persistTablePageSizes([...tablePageSizesDraft, parsed], options);
        setTablePageSizeDraftInput('');
    }

    function removeTablePageSize(value) {
        const next = tablePageSizesDraft.filter((entry) => entry !== value);
        void persistTablePageSizes(
            next.length ? next : [...TABLE_PAGE_SIZE_DEFAULTS]
        );
    }

    function toggleTablePageSize(value) {
        if (tablePageSizesDraft.includes(value)) {
            removeTablePageSize(value);
            return;
        }
        void persistTablePageSizes([...tablePageSizesDraft, value]);
    }

    async function saveTablePageSizesDialog() {
        if (tablePageSizeDraftInput.trim()) {
            addTablePageSize(tablePageSizeDraftInput, {
                close: true,
                showToast: true
            });
            return;
        }
        setTablePageSizesDialogOpen(false);
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
            toast.warning('No text-to-speech voices are available.');
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
        toast.success('Screenshot metadata removed.');
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
            `Cleared ${queryCacheCount} query cache entries, ${avatarNameCacheCount} avatar name entries, and ${favoriteStats.detailCacheCount} favorite detail entries.`
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
            title: 'Crop Existing Prints',
            description:
                'Crop already saved instance prints in the configured UGC folder now?',
            confirmText: 'Crop Prints',
            cancelText: 'Skip'
        });
        if (!result.ok) {
            return;
        }

        const ugcFolderPath = await mediaRepository.getUgcPhotoLocation(
            prefs.userGeneratedContentPath
        );
        await mediaRepository.cropAllPrints(ugcFolderPath);
        toast.success('Existing saved prints cropped.');
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
                        : 'Failed to crop existing prints.'
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

    function applyAvatarProviderConfig(nextConfig) {
        avatarProviderConfigRef.current = nextConfig;
        setAvatarProviderConfig(nextConfig);
    }

    async function saveAvatarProviderConfig(nextConfig) {
        const saveSeq = avatarProviderSaveSeqRef.current + 1;
        avatarProviderSaveSeqRef.current = saveSeq;
        const saveTask = avatarProviderSaveQueueRef.current
            .catch(() => {})
            .then(() => avatarSearchProviderRepository.saveConfig(nextConfig));

        avatarProviderSaveQueueRef.current = saveTask.catch(() => {});
        const saved = await saveTask;
        if (saveSeq === avatarProviderSaveSeqRef.current) {
            applyAvatarProviderConfig(saved);
        }
        return saved;
    }

    function setIntegrationValue(key, value) {
        setIntegrationPrefs((current) => ({ ...current, [key]: value }));
    }

    function setTranslationDraftValue(key, value) {
        setTranslationDraft((current) => ({ ...current, [key]: value }));
    }

    function openYoutubeApiDialog() {
        setYoutubeApiKeyDraft(integrationPrefs.youtubeAPIKey || '');
        setYoutubeApiDialogOpen(true);
    }

    function openTranslationApiDialog() {
        setTranslationDraft({
            bioLanguage: integrationPrefs.bioLanguage || 'en',
            translationAPIType:
                integrationPrefs.translationAPIType === 'openai'
                    ? 'openai'
                    : 'google',
            translationAPIKey: integrationPrefs.translationAPIKey || '',
            translationAPIEndpoint:
                integrationPrefs.translationAPIEndpoint ||
                DEFAULT_TRANSLATION_ENDPOINT,
            translationAPIModel:
                integrationPrefs.translationAPIModel ||
                DEFAULT_TRANSLATION_MODEL,
            translationAPIPrompt: integrationPrefs.translationAPIPrompt || ''
        });
        setAvailableTranslationModels([]);
        setTranslationApiDialogOpen(true);
    }

    function setDiscordValue(key, value) {
        setDiscordPrefs((current) => ({ ...current, [key]: value }));
    }

    async function saveDiscordBoolPreference(key, value) {
        await commit(
            () => setDiscordBoolPreference(key, value),
            () => {
                const previous = discordPrefs[key];
                setDiscordValue(key, value);
                return () => setDiscordValue(key, previous);
            }
        );
    }

    async function validateYoutubeApiKey(apiKey) {
        if (!apiKey) {
            return;
        }
        const response = await webRepository.execute({
            url: `https://www.googleapis.com/youtube/v3/videos?id=dQw4w9WgXcQ&part=snippet,contentDetails&key=${encodeURIComponent(apiKey)}`,
            method: 'GET'
        });
        const payload = parseWebJson(response);
        if (
            response.status !== 200 ||
            !Array.isArray(payload.items) ||
            payload.items.length === 0
        ) {
            throw new Error(t('dialog.youtube_api.msg_test_failed'));
        }
    }

    async function saveYoutubeApiKey() {
        const apiKey = youtubeApiKeyDraft.trim();
        setIntegrationStatus((current) => ({ ...current, youtube: 'running' }));
        try {
            await validateYoutubeApiKey(apiKey);
            await setYoutubeApiKeyPreference(apiKey);
            setIntegrationPrefs((current) => ({
                ...current,
                youtubeAPIKey: apiKey
            }));
            toast.success(
                apiKey
                    ? t('dialog.youtube_api.msg_settings_saved')
                    : t('dialog.youtube_api.msg_removed')
            );
            setYoutubeApiDialogOpen(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.youtube_api.msg_test_failed')
            );
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                youtube: 'idle'
            }));
        }
    }

    async function saveTranslationApiConfig() {
        const nextType =
            translationDraft.translationAPIType === 'openai'
                ? 'openai'
                : 'google';
        const nextEndpoint =
            translationDraft.translationAPIEndpoint.trim() ||
            DEFAULT_TRANSLATION_ENDPOINT;
        const nextModel =
            translationDraft.translationAPIModel.trim() ||
            DEFAULT_TRANSLATION_MODEL;
        const nextKey = translationDraft.translationAPIKey.trim();
        const nextBioLanguage = languageCodes.includes(
            translationDraft.bioLanguage
        )
            ? translationDraft.bioLanguage
            : 'en';
        if (nextType === 'openai' && (!nextEndpoint || !nextModel)) {
            toast.warning(t('dialog.translation_api.msg_fill_endpoint_model'));
            return;
        }

        setIntegrationStatus((current) => ({
            ...current,
            translation: 'running'
        }));
        try {
            const savedConfig = await setTranslationApiConfigPreference({
                bioLanguage: nextBioLanguage,
                translationAPIType: nextType,
                translationAPIKey: nextKey,
                translationAPIEndpoint: nextEndpoint,
                translationAPIModel: nextModel,
                translationAPIPrompt: translationDraft.translationAPIPrompt
            });
            setIntegrationPrefs((current) => ({
                ...current,
                ...savedConfig
            }));
            toast.success(t('dialog.translation_api.msg_settings_saved'));
            setTranslationApiDialogOpen(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to save translation settings.'
            );
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    async function fetchTranslationModels() {
        const endpoint =
            translationDraft.translationAPIEndpoint.trim() ||
            DEFAULT_TRANSLATION_ENDPOINT;
        const headers = {};
        if (translationDraft.translationAPIKey.trim()) {
            headers.Authorization = `Bearer ${translationDraft.translationAPIKey.trim()}`;
        }

        setIntegrationStatus((current) => ({ ...current, models: 'running' }));
        try {
            const response = await webRepository.execute({
                url: buildOpenAiModelsEndpoint(endpoint),
                method: 'GET',
                headers
            });
            if (response.status !== 200) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }
            const payload = parseWebJson(response);
            const models = Array.isArray(payload.data)
                ? payload.data
                      .map((model) => model?.id)
                      .filter(Boolean)
                      .sort()
                : Array.isArray(payload)
                  ? payload
                        .map((model) => model?.id || model?.name)
                        .filter(Boolean)
                        .sort()
                  : [];
            setAvailableTranslationModels(models);
            if (models.length && !translationDraft.translationAPIModel.trim()) {
                setTranslationDraftValue('translationAPIModel', models[0]);
            }
            toast.success(
                models.length
                    ? t('dialog.translation_api.msg_models_fetched', {
                          count: models.length
                      })
                    : t('dialog.translation_api.msg_no_models_found')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to fetch translation models.'
            );
        } finally {
            setIntegrationStatus((current) => ({ ...current, models: 'idle' }));
        }
    }

    async function testTranslationApiConfig() {
        const provider =
            translationDraft.translationAPIType === 'openai'
                ? 'openai'
                : 'google';
        const apiKey = translationDraft.translationAPIKey.trim();
        setIntegrationStatus((current) => ({
            ...current,
            translation: 'running'
        }));
        try {
            if (provider === 'google') {
                if (!apiKey) {
                    toast.warning(t('dialog.translation_api.description'));
                    return;
                }
                const response = await webRepository.execute({
                    url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        q: 'Hello world',
                        target: translationDraft.bioLanguage || 'en',
                        format: 'text'
                    })
                });
                if (response.status !== 200) {
                    throw new Error(
                        t('dialog.translation_api.msg_test_failed')
                    );
                }
            } else {
                const endpoint =
                    translationDraft.translationAPIEndpoint.trim() ||
                    DEFAULT_TRANSLATION_ENDPOINT;
                const model =
                    translationDraft.translationAPIModel.trim() ||
                    DEFAULT_TRANSLATION_MODEL;
                const headers = { 'Content-Type': 'application/json' };
                if (apiKey) {
                    headers.Authorization = `Bearer ${apiKey}`;
                }
                const response = await webRepository.execute({
                    url: endpoint,
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model,
                        messages: [
                            {
                                role: 'system',
                                content:
                                    translationDraft.translationAPIPrompt ||
                                    `Translate the user message into ${translationDraft.bioLanguage || 'en'}. Only return the translated text.`
                            },
                            { role: 'user', content: 'Hello world' }
                        ]
                    })
                });
                if (response.status !== 200) {
                    throw new Error(
                        t('dialog.translation_api.msg_test_failed')
                    );
                }
            }
            toast.success(t('dialog.translation_api.msg_test_success'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.translation_api.msg_test_failed')
            );
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    function updateAvatarProvider(index, value) {
        setAvatarProviderConfig((current) => ({
            ...current,
            providerList: current.providerList.map((provider, providerIndex) =>
                providerIndex === index ? value : provider
            )
        }));
        avatarProviderConfigRef.current = {
            ...avatarProviderConfigRef.current,
            providerList: avatarProviderConfigRef.current.providerList.map(
                (provider, providerIndex) =>
                    providerIndex === index ? value : provider
            )
        };
    }

    function saveAvatarProviderField(index, value) {
        const currentConfig = avatarProviderConfigRef.current;
        const providerList = currentConfig.providerList.map(
            (provider, providerIndex) =>
                providerIndex === index ? value : provider
        );
        const nextConfig = {
            ...currentConfig,
            enabled:
                currentConfig.enabled &&
                providerList.some((provider) => provider.trim()),
            providerList
        };
        applyAvatarProviderConfig(nextConfig);
        void commit(() =>
            saveAvatarProviderConfig({
                ...nextConfig
            })
        );
    }

    function addAvatarProvider() {
        const nextConfig = {
            ...avatarProviderConfigRef.current,
            providerList: [...avatarProviderConfigRef.current.providerList, '']
        };
        applyAvatarProviderConfig(nextConfig);
    }

    function removeAvatarProvider(index) {
        const currentConfig = avatarProviderConfigRef.current;
        const nextProviderList = currentConfig.providerList.filter(
            (_, providerIndex) => providerIndex !== index
        );
        const nextConfig = {
            ...currentConfig,
            enabled: currentConfig.enabled && nextProviderList.length > 0,
            providerList: nextProviderList
        };
        applyAvatarProviderConfig(nextConfig);
        void commit(() => saveAvatarProviderConfig(nextConfig));
    }

    function saveSharedFeedFilters(nextFilters) {
        setSharedFeedFilters(nextFilters);
        void setSharedFeedFiltersPreference(nextFilters).catch((error) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to save feed filters.'
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
                        Loading settings snapshot…
                    </div>
                ) : null}
                <SettingsTabContent value="system">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.general.general.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.general.general.version'
                                        )}
                                        :{' '}
                                        {formatReleaseDisplayVersion(
                                            VERSION || ''
                                        ) || '-'}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void openExternalLink(
                                                    'https://github.com/Map1en/VRCX-0'
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.general.general.repository_url'
                                            )}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void openExternalLink(
                                                    'https://github.com/Map1en/VRCX-0/issues'
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.general.general.support'
                                            )}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.general.application.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.general.application.startup'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.isStartAtWindowsStartup
                                            }
                                            onCheckedChange={(checked) =>
                                                void savePreferenceValue(
                                                    'isStartAtWindowsStartup',
                                                    checked,
                                                    () =>
                                                        setStartAtWindowsStartupPreference(
                                                            checked
                                                        )
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.general.application.minimized'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.isStartAsMinimizedState
                                            }
                                            onCheckedChange={(checked) =>
                                                void savePreferenceValue(
                                                    'isStartAsMinimizedState',
                                                    checked,
                                                    () =>
                                                        setStartAsMinimizedPreference(
                                                            checked
                                                        )
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.general.application.tray'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.isCloseToTray}
                                            onCheckedChange={(checked) =>
                                                void savePreferenceValue(
                                                    'isCloseToTray',
                                                    checked,
                                                    () =>
                                                        setCloseToTrayPreference(
                                                            checked
                                                        )
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.general.application.proxy'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void promptProxySettings()
                                            }
                                        >
                                            {t(
                                                'view.settings.general.application.proxy'
                                            )}
                                        </Button>
                                    </Field>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.general.legal_notice.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <div className="text-muted-foreground rounded-lg border p-4 text-sm">
                                        <p>
                                            {t(
                                                'view.settings.general.legal_notice.info'
                                            )}
                                        </p>
                                        <p>
                                            {t(
                                                'view.settings.general.legal_notice.disclaimer1'
                                            )}
                                        </p>
                                        <p>
                                            {t(
                                                'view.settings.general.legal_notice.disclaimer2'
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setOpenSourceNoticeOpen(true)
                                            }
                                        >
                                            {t(
                                                'view.settings.general.legal_notice.open_source_software_notice'
                                            )}
                                        </Button>
                                    </div>
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
                    <SettingsTabContent value="interface">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.appearance.appearance.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.language'
                                        )}
                                        controlId="settings-language"
                                    >
                                        <Select
                                            value={locale || 'en'}
                                            onValueChange={(value) =>
                                                void commit(() =>
                                                    setAppLanguagePreference(
                                                        value
                                                    )
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-language"
                                                className="w-56"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {languageCodes.map(
                                                        (code) => (
                                                            <SelectItem
                                                                key={code}
                                                                value={code}
                                                            >
                                                                {getLanguageName(
                                                                    code
                                                                )}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.font_family'
                                        )}
                                    >
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="min-w-44 justify-between font-normal"
                                                >
                                                    <span className="truncate">
                                                        {
                                                            fontDropdownDisplayText
                                                        }
                                                    </span>
                                                    <ChevronDownIcon
                                                        data-icon="inline-end"
                                                        className="opacity-50"
                                                    />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuGroup>
                                                    {westernFontDropdownOptions.map(
                                                        ([value, labelKey]) => (
                                                            <DropdownMenuCheckboxItem
                                                                key={value}
                                                                checked={
                                                                    prefs.appFontFamily ===
                                                                    value
                                                                }
                                                                onSelect={() =>
                                                                    void saveFontFamilyPreference(
                                                                        value
                                                                    )
                                                                }
                                                            >
                                                                {t(labelKey)}
                                                            </DropdownMenuCheckboxItem>
                                                        )
                                                    )}
                                                </DropdownMenuGroup>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuGroup>
                                                    {cjkFontPackOptions.map(
                                                        ([value, labelKey]) => (
                                                            <DropdownMenuCheckboxItem
                                                                key={value}
                                                                checked={
                                                                    prefs.appCjkFontPack ===
                                                                        value &&
                                                                    prefs.appFontFamily !==
                                                                        'custom'
                                                                }
                                                                onSelect={() =>
                                                                    void selectCjkFontPack(
                                                                        value
                                                                    )
                                                                }
                                                            >
                                                                {t(labelKey)}
                                                            </DropdownMenuCheckboxItem>
                                                        )
                                                    )}
                                                </DropdownMenuGroup>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuGroup>
                                                    <DropdownMenuCheckboxItem
                                                        checked={
                                                            prefs.appFontFamily ===
                                                            'custom'
                                                        }
                                                        onSelect={
                                                            openCustomFontDialog
                                                        }
                                                    >
                                                        {t(
                                                            'view.settings.appearance.appearance.font_family_custom'
                                                        )}
                                                    </DropdownMenuCheckboxItem>
                                                </DropdownMenuGroup>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.zoom'
                                        )}
                                        controlId="settings-zoom"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Input
                                                id="settings-zoom"
                                                name="zoom"
                                                inputMode="numeric"
                                                type="number"
                                                min={30}
                                                max={300}
                                                step={1}
                                                className="w-28"
                                                value={zoomInput}
                                                onChange={(event) =>
                                                    setZoomInput(
                                                        event.target.value
                                                    )
                                                }
                                                onBlur={() =>
                                                    void commit(async () => {
                                                        const nextZoom =
                                                            await setZoomLevelPreference(
                                                                zoomInput
                                                            );
                                                        setZoomInput(
                                                            String(nextZoom)
                                                        );
                                                    })
                                                }
                                            />
                                            <Badge variant="outline">
                                                {formatZoomPercentage(
                                                    zoomLevel
                                                )}
                                            </Badge>
                                        </div>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.show_notification_icon_dot'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.notificationIconDot}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'notificationIconDot',
                                                    'notificationIconDot',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.striped_data_table_mode'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.dataTableStriped}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setDataTableStripedPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            dataTableStriped:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    dataTableStriped:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.toggle_pointer_on_hover'
                                        )}
                                        description={t(
                                            'view.settings.appearance.appearance.toggle_pointer_on_hover_description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.showPointerOnHover}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setPointerOnHoverPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            showPointerOnHover:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    showPointerOnHover:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.accessible_status_indicators'
                                        )}
                                        description={t(
                                            'view.settings.appearance.appearance.accessible_status_indicators_description'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.accessibleStatusIndicators
                                            }
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setAccessibleStatusIndicatorsPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            accessibleStatusIndicators:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    accessibleStatusIndicators:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.appearance.display.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.show_instance_id'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.showInstanceIdInLocation
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'showInstanceIdInLocation',
                                                    'VRCX_showInstanceIdInLocation',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.age_gated_instances'
                                        )}
                                        description={t(
                                            'view.settings.appearance.appearance.age_gated_instances_description'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.isAgeGatedInstancesVisible
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'isAgeGatedInstancesVisible',
                                                    'VRCX_isAgeGatedInstancesVisible',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.nicknames'
                                        )}
                                        description={t(
                                            'view.settings.appearance.appearance.nicknames_description'
                                        )}
                                    >
                                        <Switch
                                            checked={!prefs.hideNicknames}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'hideNicknames',
                                                    'hideNicknames',
                                                    !checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.vrcplus_profile_icons'
                                        )}
                                        description={t(
                                            'view.settings.appearance.appearance.vrcplus_profile_icons_description'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.displayVRCPlusIconsAsAvatar
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'displayVRCPlusIconsAsAvatar',
                                                    'displayVRCPlusIconsAsAvatar',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.interface.navigation.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.interface.navigation.show_new_dashboard_button'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.showNewDashboardButton
                                            }
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setShowNewDashboardButtonPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            showNewDashboardButton:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    showNewDashboardButton:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.interface.lists_tables.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.sort_favorite_by'
                                        )}
                                    >
                                        <SegmentedPreference
                                            value={
                                                prefs.sortFavorites
                                                    ? 'date'
                                                    : 'name'
                                            }
                                            onChange={(value) =>
                                                void saveBoolPreference(
                                                    'sortFavorites',
                                                    'sortFavorites',
                                                    value === 'date'
                                                )
                                            }
                                            options={[
                                                {
                                                    value: 'name',
                                                    label: t(
                                                        'view.settings.appearance.appearance.sort_favorite_by_name'
                                                    )
                                                },
                                                {
                                                    value: 'date',
                                                    label: t(
                                                        'view.settings.appearance.appearance.sort_favorite_by_date'
                                                    )
                                                }
                                            ]}
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.table_page_sizes'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void openTablePageSizesDialog()
                                            }
                                        >
                                            {t('common.actions.configure')}
                                        </Button>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.appearance.table_entries_settings'
                                        )}
                                        description={t(
                                            'view.settings.appearance.appearance.table_entries_settings_description'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void openTableLimitsDialog()
                                            }
                                        >
                                            {t('common.actions.configure')}
                                        </Button>
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.appearance.timedate.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.timedate.time_format'
                                        )}
                                        controlId="settings-time-format"
                                    >
                                        <Select
                                            value={prefs.dtHour12 ? '12' : '24'}
                                            onValueChange={(value) =>
                                                void saveBoolPreference(
                                                    'dtHour12',
                                                    'dtHour12',
                                                    value === '12'
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-time-format"
                                                className="w-56"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value="12">
                                                        {t(
                                                            'view.settings.appearance.timedate.time_format_12'
                                                        )}
                                                    </SelectItem>
                                                    <SelectItem value="24">
                                                        {t(
                                                            'view.settings.appearance.timedate.time_format_24'
                                                        )}
                                                    </SelectItem>
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.timedate.force_iso_date_format'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.dtIsoFormat}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'dtIsoFormat',
                                                    'dtIsoFormat',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.timedate.week_starts_on'
                                        )}
                                        description={t(
                                            'view.settings.appearance.timedate.week_starts_on_description'
                                        )}
                                        controlId="settings-week-starts-on"
                                    >
                                        <Select
                                            value={String(prefs.weekStartsOn)}
                                            onValueChange={(value) =>
                                                void savePreferenceValue(
                                                    'weekStartsOn',
                                                    Number.parseInt(value, 10),
                                                    () =>
                                                        setIntConfigPreference(
                                                            'weekStartsOn',
                                                            value,
                                                            {
                                                                min: 0,
                                                                max: 6,
                                                                fallback: 1
                                                            }
                                                        )
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-week-starts-on"
                                                className="w-56"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {weekStartOptions.map(
                                                        ([value, labelKey]) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {t(labelKey)}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.appearance.user_dialog.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.user_dialog.vrchat_notes'
                                        )}
                                        description={t(
                                            'view.settings.appearance.user_dialog.vrchat_notes_description'
                                        )}
                                    >
                                        <Switch
                                            checked={!prefs.hideUserNotes}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'hideUserNotes',
                                                    'hideUserNotes',
                                                    !checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.appearance.user_dialog.vrcx_memos'
                                        )}
                                        description={t(
                                            'view.settings.appearance.user_dialog.vrcx_memos_description'
                                        )}
                                    >
                                        <Switch
                                            checked={!prefs.hideUserMemos}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'hideUserMemos',
                                                    'hideUserMemos',
                                                    !checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.appearance.friend_log.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.friend_log.hide_unfriends'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.hideUnfriends}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'hideUnfriends',
                                                    'hideUnfriends',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.appearance.user_colors.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.user_colors.random_colors_from_user_id'
                                        )}
                                        description={t(
                                            'view.settings.appearance.user_colors.random_colors_from_user_id_description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.randomUserColours}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'randomUserColours',
                                                    'VRCX_randomUserColours',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <div className="rounded-lg border p-4">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div className="text-sm font-medium">
                                                {t(
                                                    'view.settings.appearance.user_colors.header'
                                                )}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void resetTrustColors()
                                                }
                                            >
                                                {t(
                                                    'dialog.shared_feed_filters.reset'
                                                )}
                                            </Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {TRUST_COLOR_ENTRIES.map(
                                                (entry) => (
                                                    <div
                                                        key={entry.key}
                                                        className="flex flex-col gap-2 rounded-md border p-3"
                                                    >
                                                        <div
                                                            className={
                                                                entry.className
                                                            }
                                                        >
                                                            {t(entry.labelKey)}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {entry.presets.map(
                                                                (preset) => (
                                                                    <Button
                                                                        key={
                                                                            preset
                                                                        }
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="icon-sm"
                                                                        className="size-6 p-0"
                                                                        style={{
                                                                            backgroundColor:
                                                                                preset
                                                                        }}
                                                                        aria-label={
                                                                            preset
                                                                        }
                                                                        onClick={() =>
                                                                            void saveTrustColor(
                                                                                entry.key,
                                                                                preset
                                                                            )
                                                                        }
                                                                    />
                                                                )
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="color"
                                                                className="h-8 w-12 p-1"
                                                                value={
                                                                    isValidTrustColor(
                                                                        prefs
                                                                            .trustColor?.[
                                                                            entry
                                                                                .key
                                                                        ]
                                                                    )
                                                                        ? prefs
                                                                              .trustColor[
                                                                              entry
                                                                                  .key
                                                                          ]
                                                                        : TRUST_COLOR_DEFAULTS[
                                                                              entry
                                                                                  .key
                                                                          ]
                                                                }
                                                                onChange={(
                                                                    event
                                                                ) =>
                                                                    void saveTrustColor(
                                                                        entry.key,
                                                                        event
                                                                            .target
                                                                            .value
                                                                    )
                                                                }
                                                            />
                                                            <Input
                                                                value={
                                                                    prefs
                                                                        .trustColor?.[
                                                                        entry
                                                                            .key
                                                                    ] ||
                                                                    TRUST_COLOR_DEFAULTS[
                                                                        entry
                                                                            .key
                                                                    ]
                                                                }
                                                                onChange={(
                                                                    event
                                                                ) => {
                                                                    const nextValue =
                                                                        event
                                                                            .target
                                                                            .value;
                                                                    setPrefs(
                                                                        (
                                                                            current
                                                                        ) => ({
                                                                            ...current,
                                                                            trustColor:
                                                                                {
                                                                                    ...current.trustColor,
                                                                                    [entry.key]:
                                                                                        nextValue
                                                                                }
                                                                        })
                                                                    );
                                                                }}
                                                                onBlur={(
                                                                    event
                                                                ) =>
                                                                    void saveTrustColor(
                                                                        entry.key,
                                                                        event
                                                                            .target
                                                                            .value
                                                                    )
                                                                }
                                                                className="font-mono"
                                                            />
                                                        </div>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
                    <SettingsTabContent value="media">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.screenshot_helper.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.screenshot_helper.description'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.screenshot_helper.enable'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.screenshot_helper.description_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.screenshotHelper}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setScreenshotHelperPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            screenshotHelper:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    screenshotHelper:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.screenshot_helper.modify_filename'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.screenshot_helper.modify_filename_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.screenshotHelperModifyFilename
                                            }
                                            disabled={!prefs.screenshotHelper}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setScreenshotHelperModifyFilenamePreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            screenshotHelperModifyFilename:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    screenshotHelperModifyFilename:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.screenshot_helper.copy_to_clipboard'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.screenshotHelperCopyToClipboard
                                            }
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setScreenshotHelperCopyToClipboardPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            screenshotHelperCopyToClipboard:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    screenshotHelperCopyToClipboard:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.delete_all_screenshot_metadata.button'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                void deleteAllScreenshotMetadata()
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.delete_all_screenshot_metadata.button'
                                            )}
                                        </Button>
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.user_generated_content.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.user_generated_content.description'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void backend.app.OpenUGCPhotosFolder(
                                                    prefs.userGeneratedContentPath ||
                                                        ''
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.user_generated_content.folder'
                                            )}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void openUgcFolderSelector()
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.user_generated_content.set_folder'
                                            )}
                                        </Button>
                                        {prefs.userGeneratedContentPath ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void resetUgcFolder()
                                                }
                                            >
                                                {t(
                                                    'view.settings.advanced.advanced.user_generated_content.reset_override'
                                                )}
                                            </Button>
                                        ) : null}
                                    </div>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.save_instance_prints_to_file.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.save_instance_prints_to_file.header_tooltip'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.save_instance_prints_to_file.description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.saveInstancePrints}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setSaveInstancePrintsPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            saveInstancePrints:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    saveInstancePrints:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.save_instance_prints_to_file.crop'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.cropInstancePrints}
                                            disabled={!prefs.saveInstancePrints}
                                            onCheckedChange={(checked) =>
                                                void handleCropInstancePrintsChange(
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.save_instance_stickers_to_file.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.save_instance_stickers_to_file.description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.saveInstanceStickers}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setSaveInstanceStickersPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            saveInstanceStickers:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    saveInstanceStickers:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.save_instance_emoji_to_file.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.save_instance_prints_to_file.header_tooltip'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.save_instance_emoji_to_file.description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.saveInstanceEmoji}
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setSaveInstanceEmojiPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            saveInstanceEmoji:
                                                                checked
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    saveInstanceEmoji:
                                                                        !checked
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
                    <SettingsTabContent value="integrations">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.discord_presence.discord_presence.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription className="flex flex-col gap-2">
                                        <div>
                                            {t(
                                                'view.settings.discord_presence.discord_presence.description'
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="link"
                                            className="text-muted-foreground h-auto justify-start p-0 text-left text-xs font-normal"
                                            onClick={() =>
                                                setSystemHostOpen(
                                                    'vrchatConfigOpen',
                                                    true
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.discord_presence.discord_presence.enable_tooltip'
                                            )}
                                        </Button>
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.enable'
                                        )}
                                    >
                                        <Switch
                                            checked={discordPrefs.discordActive}
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordActive',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.world_integration'
                                        )}
                                        description={t(
                                            'view.settings.discord_presence.discord_presence.world_integration_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                discordPrefs.discordWorldIntegration
                                            }
                                            disabled={
                                                !discordPrefs.discordActive
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordWorldIntegration',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.instance_type_player_count'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                discordPrefs.discordInstance
                                            }
                                            disabled={
                                                !discordPrefs.discordActive
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordInstance',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.show_current_platform'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                discordPrefs.discordShowPlatform
                                            }
                                            disabled={
                                                !discordPrefs.discordActive ||
                                                !discordPrefs.discordInstance
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordShowPlatform',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.show_details_in_private'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                !discordPrefs.discordHideInvite
                                            }
                                            disabled={
                                                !discordPrefs.discordActive
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordHideInvite',
                                                    !checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.join_button'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                discordPrefs.discordJoinButton
                                            }
                                            disabled={
                                                !discordPrefs.discordActive
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordJoinButton',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.show_images'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                !discordPrefs.discordHideImage
                                            }
                                            disabled={
                                                !discordPrefs.discordActive
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordHideImage',
                                                    !checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.discord_presence.discord_presence.display_world_name_as_discord_status'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                discordPrefs.discordWorldNameAsDiscordStatus
                                            }
                                            disabled={
                                                !discordPrefs.discordActive
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveDiscordBoolPreference(
                                                    'discordWorldNameAsDiscordStatus',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                </CardContent>
                            </Card>

                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.translation_api.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.translation_api.enable_tooltip'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.translation_api.enable'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.translation_api.enable_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                integrationPrefs.translationAPI
                                            }
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setTranslationApiEnabledPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setIntegrationValue(
                                                            'translationAPI',
                                                            checked
                                                        );
                                                        return () =>
                                                            setIntegrationValue(
                                                                'translationAPI',
                                                                !checked
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.translation_api.translation_api_key'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={openTranslationApiDialog}
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.translation_api.translation_api_key'
                                            )}
                                        </Button>
                                    </Field>
                                </CardContent>
                            </Card>

                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.youtube_api.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.youtube_api.enable_tooltip'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.youtube_api.enable'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.youtube_api.enable_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                integrationPrefs.youtubeAPI
                                            }
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        setYoutubeApiEnabledPreference(
                                                            checked
                                                        ),
                                                    () => {
                                                        setIntegrationValue(
                                                            'youtubeAPI',
                                                            checked
                                                        );
                                                        return () =>
                                                            setIntegrationValue(
                                                                'youtubeAPI',
                                                                !checked
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.youtube_api.youtube_api_key'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={openYoutubeApiDialog}
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.youtube_api.youtube_api_key'
                                            )}
                                        </Button>
                                    </Field>
                                </CardContent>
                            </Card>

                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.remote_database.header'
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {t(
                                            'view.settings.advanced.advanced.remote_database.enable_description'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.remote_database.enable'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.remote_database.enable_description'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                avatarProviderConfig.enabled
                                            }
                                            onCheckedChange={(checked) =>
                                                void commit(
                                                    () =>
                                                        saveAvatarProviderConfig(
                                                            {
                                                                ...avatarProviderConfigRef.current,
                                                                enabled: checked
                                                            }
                                                        ),
                                                    () => {
                                                        const previous =
                                                            avatarProviderConfigRef.current;
                                                        applyAvatarProviderConfig(
                                                            {
                                                                ...avatarProviderConfigRef.current,
                                                                enabled: checked
                                                            }
                                                        );
                                                        return () =>
                                                            applyAvatarProviderConfig(
                                                                previous
                                                            );
                                                    }
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.remote_database.avatar_database_provider'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setAvatarProviderDialogOpen(
                                                    true
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.remote_database.avatar_database_provider'
                                            )}
                                        </Button>
                                    </Field>
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
                    <SettingsTabContent value="social">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.social.interaction.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.appearance.user_dialog.recent_action_cooldown'
                                        )}
                                        description={t(
                                            'view.settings.appearance.user_dialog.recent_action_cooldown_description'
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Switch
                                                checked={
                                                    prefs.recentActionCooldownEnabled
                                                }
                                                onCheckedChange={(checked) =>
                                                    void commit(
                                                        () =>
                                                            setRecentActionCooldownEnabledPreference(
                                                                checked
                                                            ),
                                                        () => {
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    recentActionCooldownEnabled:
                                                                        checked
                                                                })
                                                            );
                                                            return () =>
                                                                setPrefs(
                                                                    (
                                                                        current
                                                                    ) => ({
                                                                        ...current,
                                                                        recentActionCooldownEnabled:
                                                                            !checked
                                                                    })
                                                                );
                                                        }
                                                    )
                                                }
                                            />
                                            {prefs.recentActionCooldownEnabled ? (
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={1440}
                                                    className="w-28"
                                                    value={
                                                        prefs.recentActionCooldownMinutes
                                                    }
                                                    onChange={(event) =>
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            recentActionCooldownMinutes:
                                                                event.target
                                                                    .value
                                                        }))
                                                    }
                                                    onBlur={(event) =>
                                                        void commit(
                                                            async () => {
                                                                const minutes =
                                                                    await setRecentActionCooldownMinutesPreference(
                                                                        event
                                                                            .target
                                                                            .value
                                                                    );
                                                                setPrefs(
                                                                    (
                                                                        current
                                                                    ) => ({
                                                                        ...current,
                                                                        recentActionCooldownMinutes:
                                                                            minutes
                                                                    })
                                                                );
                                                            }
                                                        )
                                                    }
                                                />
                                            ) : null}
                                        </div>
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.social.favorites.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.general.favorites.header'
                                        )}
                                        description={t(
                                            'view.settings.general.favorites.header_tooltip'
                                        )}
                                    >
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="w-56 justify-between"
                                                >
                                                    <span className="truncate">
                                                        {
                                                            selectedFavoriteFriendGroupLabel
                                                        }
                                                    </span>
                                                    <ChevronDownIcon
                                                        data-icon="inline-end"
                                                        className="opacity-50"
                                                    />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent
                                                align="end"
                                                className="w-56"
                                            >
                                                {favoriteFriendGroupOptions.length ? (
                                                    <>
                                                        <DropdownMenuGroup>
                                                            {remoteFavoriteFriendGroupOptions.map(
                                                                (group) => (
                                                                    <DropdownMenuCheckboxItem
                                                                        key={
                                                                            group.value
                                                                        }
                                                                        checked={localFavoriteFriendsGroups.includes(
                                                                            group.value
                                                                        )}
                                                                        onSelect={(
                                                                            event
                                                                        ) =>
                                                                            event.preventDefault()
                                                                        }
                                                                        onCheckedChange={(
                                                                            checked
                                                                        ) =>
                                                                            void toggleLocalFavoriteFriendsGroup(
                                                                                group.value,
                                                                                checked
                                                                            )
                                                                        }
                                                                    >
                                                                        {
                                                                            group.label
                                                                        }
                                                                    </DropdownMenuCheckboxItem>
                                                                )
                                                            )}
                                                        </DropdownMenuGroup>
                                                        {remoteFavoriteFriendGroupOptions.length &&
                                                        localFavoriteFriendGroupOptions.length ? (
                                                            <DropdownMenuSeparator />
                                                        ) : null}
                                                        <DropdownMenuGroup>
                                                            {localFavoriteFriendGroupOptions.map(
                                                                (group) => (
                                                                    <DropdownMenuCheckboxItem
                                                                        key={
                                                                            group.value
                                                                        }
                                                                        checked={localFavoriteFriendsGroups.includes(
                                                                            group.value
                                                                        )}
                                                                        onSelect={(
                                                                            event
                                                                        ) =>
                                                                            event.preventDefault()
                                                                        }
                                                                        onCheckedChange={(
                                                                            checked
                                                                        ) =>
                                                                            void toggleLocalFavoriteFriendsGroup(
                                                                                group.value,
                                                                                checked
                                                                            )
                                                                        }
                                                                    >
                                                                        {
                                                                            group.label
                                                                        }
                                                                    </DropdownMenuCheckboxItem>
                                                                )
                                                            )}
                                                        </DropdownMenuGroup>
                                                    </>
                                                ) : (
                                                    <div className="text-muted-foreground px-2 py-1.5 text-sm">
                                                        {t(
                                                            'view.settings.general.favorites.group_placeholder'
                                                        )}
                                                    </div>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </Field>
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
                    <SettingsTabContent value="notifications">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.notifications.notifications.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.layout'
                                        )}
                                        controlId="settings-notification-layout"
                                    >
                                        <Select
                                            value={prefs.notificationLayout}
                                            onValueChange={(value) =>
                                                void commit(
                                                    async () => {
                                                        const nextLayout =
                                                            await setNotificationLayoutPreference(
                                                                value
                                                            );
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            notificationLayout:
                                                                nextLayout
                                                        }));
                                                    },
                                                    () => {
                                                        const previous =
                                                            prefs.notificationLayout;
                                                        setPrefs((current) => ({
                                                            ...current,
                                                            notificationLayout:
                                                                value
                                                        }));
                                                        return () =>
                                                            setPrefs(
                                                                (current) => ({
                                                                    ...current,
                                                                    notificationLayout:
                                                                        previous
                                                                })
                                                            );
                                                    }
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-notification-layout"
                                                className="w-56"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {notificationLayoutOptions.map(
                                                        ([value, labelKey]) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {t(labelKey)}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.notification_filter'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                setFeedFilterDialogOpen(true)
                                            }
                                        >
                                            {t(
                                                'view.settings.notifications.notifications.notification_filter'
                                            )}
                                        </Button>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.test_notification'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                void backend.app.DesktopNotification(
                                                    'VRCX',
                                                    t(
                                                        'view.settings.notifications.notifications.test_message'
                                                    )
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.notifications.notifications.test_notification'
                                            )}
                                        </Button>
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.notifications.notifications.desktop_notifications.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.desktop_notifications.when_to_display'
                                        )}
                                        controlId="settings-desktop-toast"
                                    >
                                        <Select
                                            value={prefs.desktopToast}
                                            onValueChange={(value) =>
                                                void saveStringPreference(
                                                    'desktopToast',
                                                    'desktopToast',
                                                    value
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-desktop-toast"
                                                className="w-56"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {desktopToastOptions.map(
                                                        ([value, labelKey]) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {t(labelKey)}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.desktop_notifications.desktop_notification_while_afk'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.afkDesktopToast}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'afkDesktopToast',
                                                    'afkDesktopToast',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.notifications.notifications.text_to_speech.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.text_to_speech.when_to_play'
                                        )}
                                        controlId="settings-notification-tts"
                                    >
                                        <Select
                                            value={prefs.notificationTTS}
                                            onValueChange={(value) =>
                                                void saveNotificationTtsMode(
                                                    value
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-notification-tts"
                                                className="w-56"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {notificationTtsOptions.map(
                                                        ([value, labelKey]) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {t(labelKey)}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.text_to_speech.tts_voice'
                                        )}
                                        controlId="settings-notification-tts-voice"
                                    >
                                        <Select
                                            value={prefs.notificationTTSVoice}
                                            disabled={
                                                prefs.notificationTTS ===
                                                    'Never' || !ttsVoices.length
                                            }
                                            onValueChange={(value) =>
                                                void saveNotificationTtsVoice(
                                                    value
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-notification-tts-voice"
                                                className="w-72"
                                            >
                                                <SelectValue
                                                    placeholder={
                                                        ttsVoices.length
                                                            ? undefined
                                                            : 'No voices'
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {ttsVoices.map(
                                                        (voice, index) => (
                                                            <SelectItem
                                                                key={`${voice.name}-${index}`}
                                                                value={String(
                                                                    index
                                                                )}
                                                            >
                                                                {voice.name}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.text_to_speech.use_memo_nicknames'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.notificationTTSNickName
                                            }
                                            disabled={
                                                prefs.notificationTTS ===
                                                'Never'
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'notificationTTSNickName',
                                                    'notificationTTSNickName',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
                                        )}
                                    >
                                        <Switch
                                            checked={notificationTtsTestVisible}
                                            disabled={
                                                prefs.notificationTTS ===
                                                'Never'
                                            }
                                            onCheckedChange={(checked) =>
                                                setNotificationTtsTestVisible(
                                                    checked === true
                                                )
                                            }
                                        />
                                    </Field>
                                    {notificationTtsTestVisible ? (
                                        <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                                            <Input
                                                value={notificationTtsTest}
                                                disabled={
                                                    prefs.notificationTTS ===
                                                    'Never'
                                                }
                                                placeholder={t(
                                                    'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
                                                )}
                                                onChange={(event) =>
                                                    setNotificationTtsTest(
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={
                                                    prefs.notificationTTS ===
                                                    'Never'
                                                }
                                                onClick={() =>
                                                    speakNotificationTts(
                                                        notificationTtsTest
                                                    )
                                                }
                                            >
                                                {t(
                                                    'view.settings.notifications.notifications.text_to_speech.play'
                                                )}
                                            </Button>
                                        </div>
                                    ) : null}
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
                    <SettingsTabContent value="advanced">
                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.vrchat_settings.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.relaunch_vrchat.header'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.relaunch_vrchat.description'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.relaunchVRChatAfterCrash
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'relaunchVRChatAfterCrash',
                                                    'VRCX_relaunchVRChatAfterCrash',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.vrchat_quit_fix.header'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.vrchat_quit_fix.description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.vrcQuitFix}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'vrcQuitFix',
                                                    'vrcQuitFix',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.auto_cache_management.header'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.auto_cache_management.description'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.autoSweepVRChatCache}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'autoSweepVRChatCache',
                                                    'VRCX_autoSweepVRChatCache',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.general.logging.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.cache_debug.udon_exception_logging'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.udonExceptionLogging}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'udonExceptionLogging',
                                                    'VRCX_udonExceptionLogging',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.general.logging.resource_load'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.logResourceLoad}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'logResourceLoad',
                                                    'logResourceLoad',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.general.logging.empty_avatar'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.logEmptyAvatars}
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'logEmptyAvatars',
                                                    'logEmptyAvatars',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.general.logging.auto_login_delay'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.autoLoginDelayEnabled
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'autoLoginDelayEnabled',
                                                    'VRCX_autoLoginDelayEnabled',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    {prefs.autoLoginDelayEnabled ? (
                                        <Field
                                            label={t(
                                                'view.settings.general.logging.auto_login_delay_button'
                                            )}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline">
                                                    {
                                                        prefs.autoLoginDelaySeconds
                                                    }
                                                    s
                                                </Badge>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        void promptAutoLoginDelaySeconds()
                                                    }
                                                >
                                                    {t(
                                                        'view.settings.general.logging.auto_login_delay_button'
                                                    )}
                                                </Button>
                                            </div>
                                        </Field>
                                    ) : null}

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.app_launcher.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.app_launcher.folder'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.app_launcher.folder_tooltip'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                void backend.app.OpenShortcutFolder()
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.app_launcher.folder'
                                            )}
                                        </Button>
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.app_launcher.enable'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.app_launcher.folder_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={prefs.enableAppLauncher}
                                            onCheckedChange={(checked) =>
                                                void saveAppLauncherField(
                                                    'enableAppLauncher',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.app_launcher.auto_close'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.enableAppLauncherAutoClose
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveAppLauncherField(
                                                    'enableAppLauncherAutoClose',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.app_launcher.run_process_once'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.enableAppLauncherRunProcessOnce
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveAppLauncherField(
                                                    'enableAppLauncherRunProcessOnce',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.launch_commands.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_enable'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_tooltip'
                                        )}
                                    >
                                        <Switch
                                            checked={
                                                prefs.showConfirmationOnSwitchAvatar
                                            }
                                            onCheckedChange={(checked) =>
                                                void saveBoolPreference(
                                                    'showConfirmationOnSwitchAvatar',
                                                    'showConfirmationOnSwitchAvatar',
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.cache_debug.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.cache_debug.header'
                                        )}
                                    >
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void clearVrcxCache()
                                                }
                                            >
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.clear_cache'
                                                )}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void promptAutoClearVrcxCacheFrequency()
                                                }
                                            >
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.auto_clear_cache'
                                                )}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void refreshCacheSize()
                                                }
                                            >
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.refresh_cache'
                                                )}
                                            </Button>
                                        </div>
                                    </Field>
                                    <div className="text-muted-foreground grid gap-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.user_cache'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.userCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.world_cache'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.worldCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.avatar_cache'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.avatarCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.group_cache'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.groupCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>TanStack Query</span>
                                            <span className="font-mono">
                                                {cacheStats.queryCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.avatar_name_cache'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.avatarNameCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'view.settings.advanced.advanced.cache_debug.instance_cache'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.instanceCache}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>Favorite detail cache</span>
                                            <span className="font-mono">
                                                {
                                                    cacheStats.favoriteDetailsCache
                                                }
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>Favorite detail pending</span>
                                            <span className="font-mono">
                                                {
                                                    cacheStats.favoriteDetailsPending
                                                }
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span>
                                                {t(
                                                    'dialog.config_json.cache_size'
                                                )}
                                            </span>
                                            <span className="font-mono">
                                                {cacheStats.assetBundleCacheSize ||
                                                    'Not refreshed'}
                                            </span>
                                        </div>
                                    </div>
                                    <Field
                                        label={`${t('view.settings.advanced.advanced.cache_debug.disable_gamelog')} ${t('view.settings.advanced.advanced.cache_debug.disable_gamelog_notice')}`}
                                    >
                                        <Switch
                                            checked={prefs.gameLogDisabled}
                                            onCheckedChange={(checked) =>
                                                void handleGameLogDisabledChange(
                                                    checked
                                                )
                                            }
                                        />
                                    </Field>

                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced.advanced.database_cleanup.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.database_cleanup.auto_cleanup'
                                        )}
                                        description={t(
                                            'view.settings.advanced.advanced.database_cleanup.auto_cleanup_description'
                                        )}
                                        controlId="settings-avatar-auto-cleanup"
                                    >
                                        <Select
                                            value={prefs.avatarAutoCleanup}
                                            onValueChange={(value) =>
                                                void saveStringPreference(
                                                    'avatarAutoCleanup',
                                                    'avatarAutoCleanup',
                                                    value
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id="settings-avatar-auto-cleanup"
                                                className="w-36"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {avatarAutoCleanupOptions.map(
                                                        (value) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {value === 'Off'
                                                                    ? t(
                                                                          'view.settings.advanced.advanced.database_cleanup.auto_cleanup_off'
                                                                      )
                                                                    : t(
                                                                          `view.settings.advanced.advanced.database_cleanup.auto_cleanup_${value}`
                                                                      )}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.database_cleanup.purge_button'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                setPurgeDialogOpen(true)
                                            }
                                        >
                                            <Trash2Icon data-icon="inline-start" />
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge'
                                            )}
                                        </Button>
                                    </Field>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                setSystemHostOpen(
                                                    'launchOptionsOpen',
                                                    true
                                                )
                                            }
                                        >
                                            {t('dialog.launch_options.header')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                setSystemHostOpen(
                                                    'registryBackupOpen',
                                                    true
                                                )
                                            }
                                        >
                                            {t('dialog.registry_backup.header')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                void openExternalLink(
                                                    'https://github.com/Myrkie/open-in-vrcx'
                                                )
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.launch_commands.website_userscript'
                                            )}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced_groups.database.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.settings.advanced.advanced.sqlite_table_size.refresh'
                                        )}
                                    >
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void refreshSqliteTableSizes()
                                            }
                                        >
                                            {t(
                                                'view.settings.advanced.advanced.sqlite_table_size.refresh'
                                            )}
                                        </Button>
                                    </Field>
                                    {Object.keys(sqliteTableSizes).length ? (
                                        <div className="text-muted-foreground grid gap-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
                                            {sqliteTableSizeRows.map(
                                                ([key, labelKey]) => (
                                                    <div
                                                        key={key}
                                                        className="flex justify-between gap-3"
                                                    >
                                                        <span>
                                                            {t(labelKey)}
                                                        </span>
                                                        <span className="font-mono">
                                                            {
                                                                sqliteTableSizes[
                                                                    key
                                                                ]
                                                            }
                                                        </span>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    ) : null}
                                </CardContent>
                            </Card>

                        <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {t(
                                            'view.settings.advanced_groups.diagnostics.header'
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col">
                                    <Field
                                        label={t(
                                            'view.profile.game_info.online_users'
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            {onlineVisitCount !== null ? (
                                                <span className="text-muted-foreground text-sm">
                                                    {t(
                                                        'view.profile.game_info.user_online',
                                                        {
                                                            count: onlineVisitCount
                                                        }
                                                    )}
                                                </span>
                                            ) : null}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void refreshOnlineVisits()
                                                }
                                            >
                                                {t('common.actions.refresh')}
                                            </Button>
                                        </div>
                                    </Field>
                                    <Field
                                        label={t('view.profile.config_json')}
                                    >
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void refreshConfigTreeData()
                                                }
                                            >
                                                {t('common.actions.refresh')}
                                            </Button>
                                            {Object.keys(configTreeData)
                                                .length ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        setConfigTreeData({})
                                                    }
                                                >
                                                    {t('common.actions.clear')}
                                                </Button>
                                            ) : null}
                                        </div>
                                    </Field>
                                    {Object.keys(configTreeData).length ? (
                                        <div className="bg-muted/30 max-h-[32rem] overflow-auto rounded-lg border p-3">
                                            <JsonTreeView
                                                data={configTreeData}
                                            />
                                        </div>
                                    ) : null}
                                </CardContent>
                        </Card>
                    </SettingsTabContent>
            </Tabs>
            <Dialog
                open={customFontDialogOpen}
                onOpenChange={setCustomFontDialogOpen}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {t(
                                'view.settings.appearance.appearance.font_family_custom_dialog_title'
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.appearance.appearance.font_family_custom_dialog_description'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field
                            label={t(
                                'view.settings.appearance.appearance.font_family_custom'
                            )}
                            controlId="settings-custom-font-family"
                        >
                            <Input
                                id="settings-custom-font-family"
                                value={customFontDraft}
                                name="customFontFamily"
                                placeholder="'My Font', Arial, sans-serif"
                                onChange={(event) =>
                                    setCustomFontDraft(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        void saveCustomFontFamily();
                                    }
                                }}
                            />
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setCustomFontDialogOpen(false)}
                        >
                            {t('dialog.alertdialog.cancel')}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void saveCustomFontFamily()}
                        >
                            {t('dialog.alertdialog.ok')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={youtubeApiDialogOpen}
                onOpenChange={setYoutubeApiDialogOpen}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.youtube_api.header')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('dialog.youtube_api.description')}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field
                            label={t('dialog.youtube_api.header')}
                            controlId="settings-youtube-api-key"
                        >
                            <Textarea
                                id="settings-youtube-api-key"
                                value={youtubeApiKeyDraft}
                                name="youtubeApiKey"
                                placeholder={t(
                                    'dialog.youtube_api.placeholder'
                                )}
                                maxLength={39}
                                rows={2}
                                onChange={(event) =>
                                    setYoutubeApiKeyDraft(event.target.value)
                                }
                            />
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                                void openExternalLink(
                                    'https://smashballoon.com/doc/youtube-api-key/'
                                )
                            }
                        >
                            {t('dialog.youtube_api.guide')}
                        </Button>
                        <Button
                            type="button"
                            disabled={integrationStatus.youtube === 'running'}
                            onClick={() => void saveYoutubeApiKey()}
                        >
                            {t('dialog.youtube_api.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={translationApiDialogOpen}
                onOpenChange={setTranslationApiDialogOpen}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.translation_api.header')}
                        </DialogTitle>
                    </DialogHeader>
                    <FieldGroup>
                        <Field
                            label={t(
                                'view.settings.appearance.appearance.bio_language'
                            )}
                            controlId="settings-translation-bio-language"
                        >
                            <Select
                                value={translationDraft.bioLanguage || 'en'}
                                onValueChange={(value) =>
                                    setTranslationDraftValue(
                                        'bioLanguage',
                                        value
                                    )
                                }
                            >
                                <SelectTrigger
                                    id="settings-translation-bio-language"
                                    className="w-56"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {languageCodes.map((code) => (
                                            <SelectItem key={code} value={code}>
                                                {getLanguageName(code)}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field
                            label={t('dialog.translation_api.mode')}
                            controlId="settings-translation-mode"
                        >
                            <Select
                                value={translationDraft.translationAPIType}
                                onValueChange={(value) =>
                                    setTranslationDraftValue(
                                        'translationAPIType',
                                        value
                                    )
                                }
                            >
                                <SelectTrigger
                                    id="settings-translation-mode"
                                    className="w-56"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {translationProviderOptions.map(
                                            ([value, labelKey]) => (
                                                <SelectItem
                                                    key={value}
                                                    value={value}
                                                >
                                                    {t(labelKey)}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        {translationDraft.translationAPIType === 'openai' ? (
                            <>
                                <Field
                                    label={t(
                                        'dialog.translation_api.openai.endpoint'
                                    )}
                                    controlId="settings-translation-endpoint"
                                >
                                    <Input
                                        id="settings-translation-endpoint"
                                        value={
                                            translationDraft.translationAPIEndpoint
                                        }
                                        name="translationApiEndpoint"
                                        placeholder={
                                            DEFAULT_TRANSLATION_ENDPOINT
                                        }
                                        onChange={(event) =>
                                            setTranslationDraftValue(
                                                'translationAPIEndpoint',
                                                event.target.value
                                            )
                                        }
                                        className="w-96 max-w-full"
                                    />
                                </Field>
                                <Field
                                    label={t(
                                        'dialog.translation_api.openai.model'
                                    )}
                                    controlId="settings-translation-model"
                                >
                                    <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                                        {availableTranslationModels.length ? (
                                            <Select
                                                value={
                                                    translationDraft.translationAPIModel ||
                                                    availableTranslationModels[0]
                                                }
                                                onValueChange={(value) =>
                                                    setTranslationDraftValue(
                                                        'translationAPIModel',
                                                        value
                                                    )
                                                }
                                            >
                                                <SelectTrigger
                                                    id="settings-translation-model"
                                                    className="min-w-56"
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {availableTranslationModels.map(
                                                            (model) => (
                                                                <SelectItem
                                                                    key={model}
                                                                    value={
                                                                        model
                                                                    }
                                                                >
                                                                    {model}
                                                                </SelectItem>
                                                            )
                                                        )}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Input
                                                id="settings-translation-model"
                                                name="translationApiModel"
                                                value={
                                                    translationDraft.translationAPIModel
                                                }
                                                placeholder={
                                                    DEFAULT_TRANSLATION_MODEL
                                                }
                                                onChange={(event) =>
                                                    setTranslationDraftValue(
                                                        'translationAPIModel',
                                                        event.target.value
                                                    )
                                                }
                                            />
                                        )}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={
                                                integrationStatus.models ===
                                                'running'
                                            }
                                            onClick={() =>
                                                void fetchTranslationModels()
                                            }
                                        >
                                            {integrationStatus.models ===
                                            'running'
                                                ? t(
                                                      'dialog.translation_api.fetching_models'
                                                  )
                                                : t(
                                                      'dialog.translation_api.fetch_models'
                                                  )}
                                        </Button>
                                    </div>
                                </Field>
                                <Field
                                    label={t(
                                        'dialog.translation_api.openai.prompt_optional'
                                    )}
                                    description={t(
                                        'dialog.translation_api.openai.prompt_optional_description'
                                    )}
                                    controlId="settings-translation-prompt"
                                >
                                    <Textarea
                                        id="settings-translation-prompt"
                                        rows={3}
                                        name="translationApiPrompt"
                                        value={
                                            translationDraft.translationAPIPrompt
                                        }
                                        onChange={(event) =>
                                            setTranslationDraftValue(
                                                'translationAPIPrompt',
                                                event.target.value
                                            )
                                        }
                                        className="w-96 max-w-full resize-none"
                                    />
                                </Field>
                            </>
                        ) : null}
                        <Field
                            label={
                                translationDraft.translationAPIType === 'openai'
                                    ? t('dialog.translation_api.openai.api_key')
                                    : t('dialog.translation_api.description')
                            }
                            controlId="settings-translation-api-key"
                        >
                            <Input
                                id="settings-translation-api-key"
                                type="password"
                                name="translationApiKey"
                                value={translationDraft.translationAPIKey}
                                placeholder={
                                    translationDraft.translationAPIType ===
                                    'openai'
                                        ? 'sk-...'
                                        : 'AIzaSy...'
                                }
                                onChange={(event) =>
                                    setTranslationDraftValue(
                                        'translationAPIKey',
                                        event.target.value
                                    )
                                }
                                className="w-96 max-w-full"
                            />
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        {translationDraft.translationAPIType === 'google' ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    void openExternalLink(
                                        'https://translatepress.com/docs/automatic-translation/generate-google-api-key/'
                                    )
                                }
                            >
                                {t('dialog.translation_api.guide')}
                            </Button>
                        ) : null}
                        {translationDraft.translationAPIType === 'openai' ? (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    integrationStatus.translation === 'running'
                                }
                                onClick={() => void testTranslationApiConfig()}
                            >
                                {t('dialog.translation_api.test')}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            disabled={
                                integrationStatus.translation === 'running'
                            }
                            onClick={() => void saveTranslationApiConfig()}
                        >
                            {t('dialog.translation_api.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={tablePageSizesDialogOpen}
                onOpenChange={setTablePageSizesDialogOpen}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {t(
                                'view.settings.appearance.appearance.table_page_sizes'
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.appearance.appearance.table_page_sizes'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <div className="flex flex-wrap gap-2">
                            {tablePageSizesDraft.map((size) => (
                                <Badge
                                    key={size}
                                    variant="secondary"
                                    className="gap-2"
                                >
                                    {size}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={`${t('common.actions.remove')} ${size}`}
                                        onClick={() =>
                                            removeTablePageSize(size)
                                        }
                                    >
                                        <XIcon data-icon="inline-start" />
                                    </Button>
                                </Badge>
                            ))}
                        </div>
                        <Field
                            label={t(
                                'view.settings.appearance.appearance.table_page_sizes'
                            )}
                            description="1-1000"
                            controlId="settings-table-page-size-input"
                        >
                            <div className="flex gap-2">
                                <Input
                                    id="settings-table-page-size-input"
                                    type="number"
                                    name="tablePageSize"
                                    inputMode="numeric"
                                    min={1}
                                    max={1000}
                                    value={tablePageSizeDraftInput}
                                    placeholder={t(
                                        'view.settings.appearance.appearance.table_page_sizes'
                                    )}
                                    onChange={(event) =>
                                        setTablePageSizeDraftInput(
                                            event.target.value
                                        )
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            addTablePageSize();
                                        }
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    aria-label={t(
                                        'view.settings.appearance.appearance.table_page_sizes'
                                    )}
                                    onClick={() => addTablePageSize()}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                </Button>
                            </div>
                        </Field>
                        <div className="max-h-64 overflow-y-auto rounded-md border p-1">
                            <FieldGroup>
                                {filteredTablePageSizeOptions.map((size) => {
                                    const optionId = `settings-table-page-size-option-${size}`;
                                    return (
                                        <ShadcnField
                                            key={size}
                                            orientation="horizontal"
                                            className="hover:bg-accent hover:text-accent-foreground rounded-sm px-2 py-1.5"
                                        >
                                            <Checkbox
                                                id={optionId}
                                                checked={tablePageSizesDraft.includes(
                                                    size
                                                )}
                                                onCheckedChange={() =>
                                                    toggleTablePageSize(size)
                                                }
                                            />
                                            <ShadcnFieldLabel
                                                htmlFor={optionId}
                                                className="w-full cursor-pointer"
                                            >
                                                {size}
                                            </ShadcnFieldLabel>
                                        </ShadcnField>
                                    );
                                })}
                            </FieldGroup>
                        </div>
                    </FieldGroup>
                    <DialogFooter>
                        <Button
                            type="button"
                            onClick={() => void saveTablePageSizesDialog()}
                        >
                            {t('dialog.alertdialog.ok')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={tableLimitsDialogOpen}
                onOpenChange={setTableLimitsDialogOpen}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {t('prompt.table_entries_settings.header')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('prompt.table_entries_settings.description')}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field
                            label={t(
                                'prompt.table_entries_settings.table_max_entries'
                            )}
                            description={
                                tableMaxSizeError
                                    ? undefined
                                    : t(
                                          'prompt.table_entries_settings.table_max_entries_hint',
                                          {
                                              min: TABLE_MAX_SIZE_MIN,
                                              max: TABLE_MAX_SIZE_MAX
                                          }
                                      )
                            }
                            controlId="settings-table-max-entries"
                            error={tableMaxSizeError}
                            invalid={Boolean(tableMaxSizeError)}
                        >
                            <Input
                                id="settings-table-max-entries"
                                type="number"
                                name="maxTableSize"
                                inputMode="numeric"
                                min={TABLE_MAX_SIZE_MIN}
                                max={TABLE_MAX_SIZE_MAX}
                                value={tableLimitsDraft.maxTableSize}
                                onChange={(event) =>
                                    setTableLimitsDraft((current) => ({
                                        ...current,
                                        maxTableSize: event.target.value
                                    }))
                                }
                            />
                        </Field>
                        <Field
                            label={t(
                                'prompt.table_entries_settings.search_limit_returns'
                            )}
                            description={
                                searchLimitError ? (
                                    t(
                                        'prompt.table_entries_settings.search_limit_returns_warning'
                                    )
                                ) : (
                                    <span className="flex flex-col gap-1">
                                        <span>
                                            {t(
                                                'prompt.table_entries_settings.search_limit_returns_hint',
                                                {
                                                    min: SEARCH_LIMIT_MIN,
                                                    max: SEARCH_LIMIT_MAX
                                                }
                                            )}
                                        </span>
                                        <span>
                                            {t(
                                                'prompt.table_entries_settings.search_limit_returns_warning'
                                            )}
                                        </span>
                                    </span>
                                )
                            }
                            controlId="settings-search-limit"
                            error={searchLimitError}
                            invalid={Boolean(searchLimitError)}
                        >
                            <Input
                                id="settings-search-limit"
                                type="number"
                                name="searchLimit"
                                inputMode="numeric"
                                min={SEARCH_LIMIT_MIN}
                                max={SEARCH_LIMIT_MAX}
                                value={tableLimitsDraft.searchLimit}
                                onChange={(event) =>
                                    setTableLimitsDraft((current) => ({
                                        ...current,
                                        searchLimit: event.target.value
                                    }))
                                }
                            />
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setTableLimitsDialogOpen(false)}
                        >
                            {t('prompt.table_entries_settings.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={tableLimitsSaveDisabled}
                            onClick={() => void saveTableLimitsDialog()}
                        >
                            {t('prompt.table_entries_settings.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={avatarProviderDialogOpen}
                onOpenChange={setAvatarProviderDialogOpen}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.avatar_database_provider.header')}
                        </DialogTitle>
                    </DialogHeader>
                    <FieldGroup>
                        {avatarProviderConfig.providerList.length > 0 ? (
                            avatarProviderConfig.providerList.map(
                                (provider, index) => (
                                    <Field
                                        key={`avatar-provider-dialog-${index}`}
                                        label={`${t('view.settings.advanced.advanced.remote_database.avatar_database_provider')} ${index + 1}`}
                                        controlId={`settings-avatar-provider-${index}`}
                                    >
                                        <div className="flex gap-2">
                                            <Input
                                                id={`settings-avatar-provider-${index}`}
                                                name={`avatarProvider${index}`}
                                                value={provider}
                                                onChange={(event) =>
                                                    updateAvatarProvider(
                                                        index,
                                                        event.target.value
                                                    )
                                                }
                                                onBlur={(event) =>
                                                    saveAvatarProviderField(
                                                        index,
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                aria-label={t(
                                                    'common.actions.remove'
                                                )}
                                                onClick={() =>
                                                    removeAvatarProvider(index)
                                                }
                                            >
                                                <Trash2Icon data-icon="inline-start" />
                                            </Button>
                                        </div>
                                    </Field>
                                )
                            )
                        ) : (
                            <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                                {t('search.avatar.no_provider')}
                            </div>
                        )}
                        <Field
                            label={t(
                                'dialog.avatar_database_provider.add_provider'
                            )}
                        >
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={addAvatarProvider}
                            >
                                <PlusIcon data-icon="inline-start" />
                                {t(
                                    'dialog.avatar_database_provider.add_provider'
                                )}
                            </Button>
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAvatarProviderDialogOpen(false)}
                        >
                            {t('dialog.alertdialog.ok')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_title'
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_alert'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="text-muted-foreground flex flex-col gap-4 text-sm">
                        <p>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_description_1'
                            )}
                        </p>
                        <p>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_description_2'
                            )}
                        </p>
                        <p>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_description_3'
                            )}
                        </p>
                        <Field
                            label={t(
                                'view.settings.advanced.advanced.database_cleanup.purge_older_than'
                            )}
                            controlId="settings-purge-period"
                        >
                            <Select
                                value={purgePeriod}
                                onValueChange={setPurgePeriod}
                            >
                                <SelectTrigger
                                    id="settings-purge-period"
                                    className="w-36"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="180">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_180'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="365">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_365'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="730">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_730'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="all">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_all'
                                            )}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={purgeInProgress}
                            onClick={() => setPurgeDialogOpen(false)}
                        >
                            {t('confirm.cancel_button')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={purgeInProgress}
                            onClick={() => void purgeAvatarFeedData()}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_button'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={feedFilterDialogOpen}
                onOpenChange={setFeedFilterDialogOpen}
            >
                <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>
                            {feedFilterMode === 'noty'
                                ? t('dialog.shared_feed_filters.notification')
                                : t('dialog.shared_feed_filters.wrist')}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.notifications.notifications.notification_filter'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 overflow-hidden">
                        <Tabs
                            value={feedFilterMode}
                            onValueChange={setFeedFilterMode}
                        >
                            <div className="max-w-full overflow-x-auto">
                                <TabsList>
                                    <TabsTrigger value="noty">
                                        {t(
                                            'dialog.shared_feed_filters.notification'
                                        )}
                                    </TabsTrigger>
                                    <TabsTrigger value="wrist">
                                        {t('dialog.shared_feed_filters.wrist')}
                                    </TabsTrigger>
                                </TabsList>
                            </div>
                        </Tabs>
                        <FieldGroup className="max-h-[60vh] overflow-y-auto pr-1">
                            {currentSharedFeedFilterOptions.map((setting) => (
                                <Field
                                    key={`${feedFilterMode}:${setting.key}`}
                                    label={setting.name}
                                    description={setting.tooltip}
                                    controlId={`settings-feed-filter-${feedFilterMode}-${setting.key}`}
                                >
                                    <Select
                                        value={
                                            sharedFeedFilters[feedFilterMode]?.[
                                                setting.key
                                            ] ||
                                            sharedFeedFiltersDefaults[
                                                feedFilterMode
                                            ]?.[setting.key] ||
                                            setting.options[0]?.label
                                        }
                                        onValueChange={(value) =>
                                            updateSharedFeedFilter(
                                                feedFilterMode,
                                                setting.key,
                                                value
                                            )
                                        }
                                    >
                                        <SelectTrigger
                                            id={`settings-feed-filter-${feedFilterMode}-${setting.key}`}
                                            className="w-40"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {setting.options.map(
                                                    (option) => (
                                                        <SelectItem
                                                            key={option.label}
                                                            value={option.label}
                                                        >
                                                            {t(option.textKey)}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </Field>
                            ))}
                        </FieldGroup>
                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    resetSharedFeedFilters(feedFilterMode)
                                }
                            >
                                {t('dialog.shared_feed_filters.reset')}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => setFeedFilterDialogOpen(false)}
                            >
                                {t('dialog.alertdialog.ok')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <OpenSourceNoticeDialog
                open={openSourceNoticeOpen}
                onOpenChange={setOpenSourceNoticeOpen}
                t={t}
            />
        </div>
    );
}
