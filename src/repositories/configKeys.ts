export type ConfigValueType = 'string' | 'int' | 'bool' | 'float';
export type ConfigDefaultValue = string | number | boolean | null;

export interface ConfigKeyDefinition {
    type: ConfigValueType;
    default: ConfigDefaultValue;
}

const defineConfigKeys = <T extends Record<string, ConfigKeyDefinition>>(
    keys: T
): T => keys;

export const ConfigKeys = defineConfigKeys({
    // ── App Core ─────────────────────────────────────
    databaseVersion: { type: 'int', default: 0 },
    appLanguage: { type: 'string', default: null },
    maxTableSize_v2: { type: 'int', default: 500 },
    searchLimit: { type: 'int', default: 50000 },
    clearVRCXCacheFrequency: { type: 'int', default: 172800 },
    autoUpdateVRCX: { type: 'string', default: 'Auto Download' },
    autoInstallUpdatesOnStartup: { type: 'bool', default: true },
    autoBackgroundDownloadUpdates: { type: 'bool', default: false },
    id: { type: 'string', default: '' },
    branch: { type: 'string', default: '' },
    telemetryInstallId: { type: 'string', default: null },
    telemetryBasicInfoReportedVersion: { type: 'string', default: '' },
    telemetryConfigReportedVersion: { type: 'string', default: '' },
    lastUserLoggedIn: { type: 'string', default: null },
    savedCredentials: { type: 'string', default: '{}' },

    // ── Sidebar ──────────────────────────────────────
    isFriendsGroupMe: { type: 'bool', default: true },
    isFriendsGroupFavorites: { type: 'bool', default: true },
    isFriendsGroupOnline: { type: 'bool', default: true },
    isFriendsGroupActive: { type: 'bool', default: false },
    isFriendsGroupOffline: { type: 'bool', default: true },
    sidebarGroupByInstance: { type: 'bool', default: true },
    sidebarGroupByInstanceCollapsed: { type: 'bool', default: false },
    sidebarFavoriteGroups: { type: 'string', default: null },
    isHideFriendsInSameInstance: { type: 'bool', default: false },
    isSameInstanceAboveFavorites: { type: 'bool', default: false },
    isSidebarDivideByFriendGroup: { type: 'bool', default: false },
    rightSidebarOpen: { type: 'bool', default: true },
    sidebarSortMethod1: { type: 'string', default: 'Sort by Status' },
    sidebarSortMethod2: { type: 'string', default: 'Sort Alphabetically' },
    sidebarSortMethod3: { type: 'string', default: '' },
    sidebarFavoriteGroupOrder: { type: 'string', default: null },
    sidebarTabLayout: { type: 'string', default: null },
    sidebarTabDisplayMode: { type: 'string', default: 'auto' },

    // ── Nav ──────────────────────────────────────────
    navIsCollapsed: { type: 'bool', default: false },
    navPanelWidth: { type: 'int', default: null },

    // ── Settings - General ───────────────────────────
    StartAtWindowsStartup: { type: 'bool', default: false },
    CloseToTray: { type: 'bool', default: false },
    autoLoginDelayEnabled: { type: 'bool', default: false },
    autoLoginDelaySeconds: { type: 'int', default: 0 },
    weekStartsOn: { type: 'int', default: null },

    // ── Settings - Appearance ────────────────────────
    ThemeMode: { type: 'string', default: null },
    themeColor: { type: 'string', default: 'default' },
    lastDarkTheme: { type: 'string', default: null },
    ZoomLevel: { type: 'int', default: 100 },
    fontFamily: { type: 'string', default: 'geist' },
    customFontFamily: { type: 'string', default: '' },
    customFontPrimary: { type: 'string', default: '' },
    customFontSecondary: { type: 'string', default: '' },
    customFontOverride: { type: 'string', default: '' },
    cjkFontPack: { type: 'string', default: 'noto' },
    dtHour12: { type: 'bool', default: false },
    dtIsoFormat: { type: 'bool', default: false },
    hideNicknames: { type: 'bool', default: false },
    showInstanceIdInLocation: { type: 'bool', default: false },
    isAgeGatedInstancesVisible: { type: 'bool', default: true },
    displayVRCPlusIconsAsAvatar: { type: 'bool', default: true },
    hideUserMemos: { type: 'bool', default: false },
    hideUserNotes: { type: 'bool', default: false },
    compactTableMode: { type: 'bool', default: false },
    dataTableStriped: { type: 'bool', default: false },
    tableDensity: { type: 'string', default: null },
    tablePageSize: { type: 'int', default: null },
    randomUserColours: { type: 'bool', default: false },
    backgroundImageEnabled: { type: 'bool', default: false },
    backgroundImageMode: { type: 'string', default: 'off' },
    backgroundImageProviderId: { type: 'string', default: 'nasa-epic' },
    backgroundImageSnapshots: { type: 'string', default: '{}' },
    backgroundImageCustomSource: { type: 'string', default: '{}' },
    officialBackgroundEnabled: { type: 'bool', default: false },
    officialBackgroundProviderId: { type: 'string', default: 'nasa-epic' },
    officialBackgroundSnapshots: { type: 'string', default: '{}' },
    communityThemeEnabled: { type: 'bool', default: false },
    communityThemeId: { type: 'string', default: '' },
    communityThemeVersion: { type: 'string', default: '' },
    communityThemeCssSnapshot: { type: 'string', default: '' },
    communityThemeOverrideCss: { type: 'string', default: '' },
    communityThemeOverrideEnabled: { type: 'bool', default: true },
    communityThemeInstallMetadata: { type: 'string', default: '{}' },
    communityThemeInstalledThemes: { type: 'string', default: '[]' },
    themeMarketplaceCatalogUrl: { type: 'string', default: '' },

    // ── Settings - Advanced ──────────────────────────
    bioLanguage: { type: 'string', default: null },
    relaunchVRChatAfterCrash: { type: 'bool', default: false },
    vrcQuitFix: { type: 'bool', default: true },
    autoSweepVRChatCache: { type: 'bool', default: false },
    saveInstancePrints: { type: 'bool', default: false },
    cropInstancePrints: { type: 'bool', default: false },
    autoDeleteOldPrints: { type: 'bool', default: false },
    autoDeletePrintsLimit: { type: 'int', default: 60 },
    autoDeletePrintsFavoriteIds: { type: 'string', default: '[]' },
    saveInstanceStickers: { type: 'bool', default: false },
    saveInstanceEmoji: { type: 'bool', default: false },
    avatarRemoteDatabase: { type: 'bool', default: true },
    screenshotHelper: { type: 'bool', default: true },
    screenshotHelperModifyFilename: { type: 'bool', default: false },
    screenshotHelperCopyToClipboard: { type: 'bool', default: false },
    gameLogDisabled: { type: 'bool', default: false },
    avatarAutoCleanup: { type: 'string', default: 'Off' },
    defaultLaunchMode: { type: 'string', default: 'vr' },
    anonymousUsageTelemetry: { type: 'bool', default: true },
    userGeneratedContentPath: { type: 'string', default: '' },
    logResourceLoad: { type: 'bool', default: false },
    udonExceptionLogging: { type: 'bool', default: false },
    showNewDashboardButton: { type: 'bool', default: true },
    backgroundModeEnabled: { type: 'bool', default: false },

    // ── Settings - Integrations ──────────────────────
    youtubeAPI: { type: 'bool', default: false },
    youtubeAPIKey: { type: 'string', default: '' },
    translationAPI: { type: 'bool', default: false },
    translationAPIKey: { type: 'string', default: '' },
    translationAPIType: { type: 'string', default: 'google' },
    translationEndpointId: { type: 'string', default: '' },
    translationAPIEndpoint: { type: 'string', default: '' },
    translationAPIModel: { type: 'string', default: '' },
    translationAPIPrompt: { type: 'string', default: '' },

    // ── Settings - Notifications ─────────────────────
    desktopToast: { type: 'string', default: 'Never' },
    afkDesktopToast: { type: 'bool', default: false },
    desktopNotificationSound: { type: 'bool', default: false },
    notificationLayout: { type: 'string', default: null },
    notificationTTS: { type: 'string', default: 'Never' },
    notificationTTSVoice: { type: 'string', default: '0' },
    notificationTTSNickName: { type: 'bool', default: false },
    notificationIconDot: { type: 'bool', default: true },
    showPostUpdateChangelogToast: { type: 'bool', default: true },
    xsNotifications: { type: 'bool', default: true },
    ovrtHudNotifications: { type: 'bool', default: true },
    ovrtWristNotifications: { type: 'bool', default: false },
    imageNotifications: { type: 'bool', default: true },
    notificationTimeout: { type: 'int', default: 3000 },
    notificationOpacity: { type: 'int', default: 100 },
    webhookEnabled: { type: 'bool', default: false },
    webhookUrl: { type: 'string', default: '' },
    webhookFormat: { type: 'string', default: 'generic' },
    webhookFields: {
        type: 'string',
        default:
            '["version","event","category","title","message","user","location","locationId","worldId","worldName","timestamp","localTime"]'
    },
    vrNotificationActivityFilters: { type: 'string', default: '' },
    desktopNotificationActivityFilters: { type: 'string', default: '' },
    webhookActivityFilters: { type: 'string', default: '' },

    // ── Settings - Overlay ───────────────────────────
    wristOverlayEnabled: { type: 'bool', default: false },
    wristOverlayStartMode: { type: 'string', default: 'vrchatVrMode' },
    wristOverlayButton: { type: 'string', default: 'grip' },
    wristOverlayHand: { type: 'string', default: 'left' },
    wristOverlaySize: { type: 'string', default: 'normal' },
    wristOverlayHidePrivateWorlds: { type: 'bool', default: false },
    wristOverlayDarkBackground: { type: 'bool', default: true },
    wristOverlayShowDevices: { type: 'bool', default: true },
    wristOverlayShowBatteryPercent: { type: 'bool', default: false },

    // ── Settings - VR Background ─────────────────────
    // ── Auto State Change ────────────────────────────
    autoStateChangeEnabled: { type: 'bool', default: false },
    autoStateChangeAloneStatus: { type: 'string', default: 'join me' },
    autoStateChangeCompanyStatus: { type: 'string', default: 'busy' },
    autoStateChangeInstanceTypes: { type: 'string', default: '[]' },
    autoStateChangeAloneDescEnabled: { type: 'bool', default: false },
    autoStateChangeAloneDesc: { type: 'string', default: '' },
    autoStateChangeCompanyDescEnabled: { type: 'bool', default: false },
    autoStateChangeCompanyDesc: { type: 'string', default: '' },
    autoStateChangeNoFriends: { type: 'bool', default: false },
    autoStateChangeGroups: { type: 'string', default: '[]' },
    autoAcceptInviteRequests: { type: 'string', default: 'Off' },
    autoAcceptInviteGroups: { type: 'string', default: '[]' },
    presenceAutomationTimeRules: { type: 'string', default: '[]' },
    presenceAutomationContextRules: { type: 'string', default: '[]' },
    presenceAutomationMinStatusWriteIntervalMs: {
        type: 'int',
        default: 60000
    },
    presenceAutomationMinDescriptionWriteIntervalMs: {
        type: 'int',
        default: 60000
    },
    presenceAutomationStableLocationMs: { type: 'int', default: 30000 },

    // ── Registry Backup ──────────────────────────────
    vrcRegistryAutoBackup: { type: 'bool', default: true },
    vrcRegistryAskRestore: { type: 'bool', default: true },
    VRChatRegistryBackups: { type: 'string', default: null },
    VRChatRegistryLastBackupDate: { type: 'string', default: null },
    VRChatRegistryLastRestoreCheck: { type: 'string', default: null },

    // ── Feed ─────────────────────────────────────────
    feedTableFilters: { type: 'string', default: '[]' },
    feedViewMode: { type: 'string', default: 'table' },
    feedColumnsConfig: { type: 'string', default: '[]' },
    feedColumnsDensity: { type: 'string', default: 'compact' },
    feedTimeDisplayMode: { type: 'string', default: 'relative' },
    hidePrivateFromFeed: { type: 'bool', default: false },
    hideDevicesFromFeed: { type: 'bool', default: false },
    hideUptimeFromFeed: { type: 'bool', default: false },
    hideUnfriends: { type: 'bool', default: false },
    pcUptimeOnFeed: { type: 'bool', default: false },
    minimalFeed: { type: 'bool', default: false },
    recentActionCooldownEnabled: { type: 'bool', default: false },
    recentActionCooldownMinutes: { type: 'int', default: 60 },

    // ── Favorites ───────────────────────────────────
    FavoritesFriendSort: { type: 'string', default: 'date' },
    FavoritesWorldSort: { type: 'string', default: 'date' },
    FavoritesAvatarSort: { type: 'string', default: 'date' },
    FavoritesFriendSplitter: { type: 'string', default: '260' },
    FavoritesWorldSplitter: { type: 'string', default: '260' },
    FavoritesAvatarSplitter: { type: 'string', default: '260' },
    FavoritesFriendCardScale: { type: 'string', default: '1' },
    FavoritesWorldCardScale: { type: 'string', default: '1' },
    FavoritesAvatarCardScale: { type: 'string', default: '1' },
    FavoritesFriendCardSpacing: { type: 'string', default: '1' },
    FavoritesWorldCardSpacing: { type: 'string', default: '1' },
    FavoritesAvatarCardSpacing: { type: 'string', default: '1' },

    // ── Table Filters ────────────────────────────────
    notificationTableFilters: { type: 'string', default: '[]' },
    playerModerationTableFilters: { type: 'string', default: '[]' },
    friendLogTableFilters: { type: 'string', default: '[]' },
    gameLogTableFilters: { type: 'string', default: '[]' },
    gameLogTableVIPFilter: { type: 'bool', default: false },
    gameLogSessionsFilters: { type: 'string', default: '[]' },
    gameLogSessionsVIPFilter: { type: 'bool', default: false },
    gameLogSessionsDateFrom: { type: 'string', default: '' },
    gameLogSessionsDateTo: { type: 'string', default: '' },
    gameLogViewMode: { type: 'string', default: null },

    // ── View State ───────────────────────────────────
    MyAvatarsViewMode: { type: 'string', default: 'grid' },
    MyAvatarsCardScale: { type: 'string', default: null },
    MyAvatarsCardSpacing: { type: 'string', default: null },
    UserDialogAvatarSort: { type: 'string', default: 'name' },
    FriendLocationCardScale: { type: 'string', default: '1' },
    FriendLocationCardSpacing: { type: 'string', default: '1' },
    FriendLocationDensity: { type: 'string', default: 'compact' },
    FriendLocationShowSameInstance: { type: 'bool', default: null },
    InstanceActivityBarWidth: { type: 'int', default: 25 },
    groupCalendarShowFeaturedEvents: { type: 'bool', default: false },
    toolsCategoryCollapsed: { type: 'string', default: null },
    screenshotGalleryFolder: { type: 'string', default: '' },
    screenshotGalleryScrollPositions: { type: 'string', default: '{}' },

    // ── Charts ───────────────────────────────────────
    MutualGraphLayoutIterations: { type: 'int', default: null },
    MutualGraphLayoutSpacing: { type: 'int', default: null },
    MutualGraphEdgeCurvature: { type: 'float', default: null },
    MutualGraphCommunitySeparation: { type: 'float', default: null },

    // ── Activity ─────────────────────────────────────
    activitySelfPeriodDays: { type: 'string', default: null },
    activityFriendPeriodDays: { type: 'string', default: null },
    activitySelfTopWorldsSortBy: { type: 'string', default: null },
    activitySelfExcludeHomeWorld: { type: 'bool', default: false },
    overlapExcludeEnabled: { type: 'bool', default: false },
    overlapExcludeStart: { type: 'string', default: '1' },
    overlapExcludeEnd: { type: 'string', default: '6' },

    // ── Status Bar ───────────────────────────────────
    statusBarVisibility: { type: 'string', default: null },
    statusBarClocks: { type: 'string', default: null },
    statusBarClockCount: { type: 'string', default: null },

    // ── Game State ───────────────────────────────────
    lastGameOfflineAt: { type: 'string', default: null },
    lastGameSessionMs: { type: 'string', default: null },

    // ── Dashboard ────────────────────────────────────
    localFavoriteFriendsGroups: { type: 'string', default: null },
    feedHiddenUsers: { type: 'string', default: null },

    // ── Onboarding ───────────────────────────────────
    onboarding_welcome_seen: { type: 'bool', default: false },

    // ── Avatar Provider ──────────────────────────────
    avatarRemoteDatabaseProviderList: {
        type: 'string',
        default: '["https://api.avtrdb.com/v3/avatar/search/vrcx"]'
    },
    avatarRemoteDatabaseProvider: { type: 'string', default: '' },
    showConfirmationOnSwitchAvatar: { type: 'bool', default: true }
});

export type ConfigKeyName = keyof typeof ConfigKeys;

export const DB_KEY_PREFIX = 'config:vrcx_';

export const APP_THEME_CONFIG_KEYS = Object.freeze({
    themeMode: 'ThemeMode',
    themeColor: 'VRCX_themeColor',
    zoomLevel: 'VRCX_ZoomLevel',
    fontFamily: 'VRCX_fontFamily'
});

export const COMMUNITY_THEME_CONFIG_KEYS = Object.freeze({
    enabled: 'VRCX_communityThemeEnabled',
    id: 'VRCX_communityThemeId',
    version: 'VRCX_communityThemeVersion',
    cssSnapshot: 'VRCX_communityThemeCssSnapshot',
    overrideCss: 'VRCX_communityThemeOverrideCss',
    overrideCssEnabled: 'VRCX_communityThemeOverrideEnabled',
    installMetadata: 'VRCX_communityThemeInstallMetadata',
    installedThemes: 'VRCX_communityThemeInstalledThemes',
    legacyMarketplaceCatalogUrl: 'VRCX_themeMarketplaceCatalogUrl'
});

export const BACKGROUND_IMAGE_CONFIG_KEYS = Object.freeze({
    enabled: 'VRCX_backgroundImageEnabled',
    mode: 'VRCX_backgroundImageMode',
    providerId: 'VRCX_backgroundImageProviderId',
    snapshots: 'VRCX_backgroundImageSnapshots',
    customSource: 'VRCX_backgroundImageCustomSource',
    legacyEnabled: 'VRCX_officialBackgroundEnabled',
    legacyProviderId: 'VRCX_officialBackgroundProviderId',
    legacySnapshots: 'VRCX_officialBackgroundSnapshots'
});

export const FAVORITES_LAYOUT_CONFIG_KEYS = Object.freeze({
    splitter: Object.freeze({
        friend: 'VRCX_FavoritesFriendSplitter',
        world: 'VRCX_FavoritesWorldSplitter',
        avatar: 'VRCX_FavoritesAvatarSplitter'
    }),
    cardScale: Object.freeze({
        friend: 'VRCX_FavoritesFriendCardScale',
        world: 'VRCX_FavoritesWorldCardScale',
        avatar: 'VRCX_FavoritesAvatarCardScale'
    }),
    cardSpacing: Object.freeze({
        friend: 'VRCX_FavoritesFriendCardSpacing',
        world: 'VRCX_FavoritesWorldCardSpacing',
        avatar: 'VRCX_FavoritesAvatarCardSpacing'
    }),
    sort: Object.freeze({
        friend: 'VRCX_FavoritesFriendSort',
        world: 'VRCX_FavoritesWorldSort',
        avatar: 'VRCX_FavoritesAvatarSort'
    })
});

export const USER_ACTIVITY_CONFIG_KEYS = Object.freeze({
    selfPeriodDays: 'activitySelfPeriodDays',
    friendPeriodDays: 'activityFriendPeriodDays',
    selfTopWorldsSortBy: 'activitySelfTopWorldsSortBy',
    selfExcludeHomeWorld: 'activitySelfExcludeHomeWorld',
    overlapExcludeEnabled: 'overlapExcludeEnabled',
    overlapExcludeStart: 'overlapExcludeStart',
    overlapExcludeEnd: 'overlapExcludeEnd'
});

export const SCREENSHOT_GALLERY_CONFIG_KEYS = Object.freeze({
    folder: 'screenshotGalleryFolder',
    scrollPositions: 'screenshotGalleryScrollPositions'
});

export const STATUS_BAR_CONFIG_KEYS = Object.freeze({
    visibility: 'VRCX_statusBarVisibility',
    clocks: 'VRCX_statusBarClocks',
    clockCount: 'VRCX_statusBarClockCount'
});

export function toDbKey(name: string): string {
    return `${DB_KEY_PREFIX}${name.toLowerCase()}`;
}
