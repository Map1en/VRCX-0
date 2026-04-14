/**
 * Centralized config key registry.
 *
 * Every config key lives here. Adding a new setting =
 * add one line to this file + use it anywhere via configRepository.
 *
 * DB storage format: "config:vrcx_{key_lowercase}"
 */

export const ConfigKeys = {
    // ── App Core ─────────────────────────────────────
    databaseVersion: { type: 'int', default: 0 },
    appLanguage: { type: 'string', default: null },
    maxTableSize_v2: { type: 'int', default: 500 },
    searchLimit: { type: 'int', default: 50000 },
    clearVRCXCacheFrequency: { type: 'int', default: 172800 },
    autoUpdateVRCX: { type: 'string', default: 'Auto Download' },
    id: { type: 'string', default: '' },
    branch: { type: 'string', default: '' },
    enableCustomEndpoint: { type: 'bool', default: false },
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
    sidebarSortMethod1: { type: 'string', default: 'Sort by Status' },
    sidebarSortMethod2: { type: 'string', default: 'Sort Alphabetically' },
    sidebarSortMethod3: { type: 'string', default: '' },
    sidebarFavoriteGroupOrder: { type: 'string', default: null },

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
    lastDarkTheme: { type: 'string', default: null },
    fontFamily: { type: 'string', default: 'inter' },
    customFontFamily: { type: 'string', default: '' },
    cjkFontPack: { type: 'string', default: 'noto' },
    dtHour12: { type: 'bool', default: false },
    dtIsoFormat: { type: 'bool', default: false },
    hideNicknames: { type: 'bool', default: false },
    hideUserMemos: { type: 'bool', default: false },
    hideUserNotes: { type: 'bool', default: false },
    showPointerOnHover: { type: 'bool', default: false },
    compactTableMode: { type: 'bool', default: false },
    dataTableStriped: { type: 'bool', default: false },
    tableDensity: { type: 'string', default: null },
    tablePageSize: { type: 'int', default: null },
    randomUserColours: { type: 'bool', default: false },

    // ── Settings - Advanced ──────────────────────────
    bioLanguage: { type: 'string', default: null },
    relaunchVRChatAfterCrash: { type: 'bool', default: false },
    vrcQuitFix: { type: 'bool', default: true },
    autoSweepVRChatCache: { type: 'bool', default: false },
    saveInstancePrints: { type: 'bool', default: false },
    cropInstancePrints: { type: 'bool', default: false },
    saveInstanceStickers: { type: 'bool', default: false },
    saveInstanceEmoji: { type: 'bool', default: false },
    avatarRemoteDatabase: { type: 'bool', default: true },
    enableAppLauncher: { type: 'bool', default: true },
    enableAppLauncherAutoClose: { type: 'bool', default: true },
    enableAppLauncherRunProcessOnce: { type: 'bool', default: true },
    screenshotHelper: { type: 'bool', default: true },
    screenshotHelperModifyFilename: { type: 'bool', default: false },
    screenshotHelperCopyToClipboard: { type: 'bool', default: false },
    gameLogDisabled: { type: 'bool', default: false },
    avatarAutoCleanup: { type: 'string', default: 'Off' },
    userGeneratedContentPath: { type: 'string', default: '' },
    logEmptyAvatars: { type: 'bool', default: false },
    logResourceLoad: { type: 'bool', default: false },
    udonExceptionLogging: { type: 'bool', default: false },
    showNewDashboardButton: { type: 'bool', default: true },

    // ── Settings - Integrations ──────────────────────
    youtubeAPI: { type: 'bool', default: false },
    youtubeAPIKey: { type: 'string', default: '' },
    translationAPI: { type: 'bool', default: false },
    translationAPIKey: { type: 'string', default: '' },
    translationAPIType: { type: 'string', default: 'google' },
    translationAPIEndpoint: { type: 'string', default: '' },
    translationAPIModel: { type: 'string', default: '' },
    translationAPIPrompt: { type: 'string', default: '' },

    // ── Settings - Notifications ─────────────────────
    desktopToast: { type: 'string', default: 'Never' },
    afkDesktopToast: { type: 'bool', default: false },
    notificationLayout: { type: 'string', default: null },
    notificationTTS: { type: 'string', default: 'Never' },
    notificationTTSVoice: { type: 'string', default: '0' },
    notificationTTSNickName: { type: 'bool', default: false },
    notificationIconDot: { type: 'bool', default: true },

    // ── Settings - Overlay ───────────────────────────
    // ── Settings - VR Background ─────────────────────
    // ── Auto State Change ────────────────────────────
    autoStateChangeEnabled: { type: 'bool', default: false },
    autoStateChangeAloneDesc: { type: 'string', default: null },
    autoStateChangeCompanyDesc: { type: 'string', default: null },
    autoStateChangeNoFriends: { type: 'bool', default: false },
    autoStateChangeGroups: { type: 'string', default: null },
    autoAcceptInviteRequests: { type: 'bool', default: false },
    autoAcceptInviteGroups: { type: 'string', default: null },

    // ── Registry Backup ──────────────────────────────
    vrcRegistryAutoBackup: { type: 'bool', default: false },
    vrcRegistryAskRestore: { type: 'bool', default: false },
    VRChatRegistryBackups: { type: 'string', default: null },
    VRChatRegistryLastBackupDate: { type: 'string', default: null },
    VRChatRegistryLastRestoreCheck: { type: 'string', default: null },

    // ── Feed ─────────────────────────────────────────
    feedTableFilters: { type: 'string', default: '[]' },
    hidePrivateFromFeed: { type: 'bool', default: false },
    hideDevicesFromFeed: { type: 'bool', default: false },
    hideUptimeFromFeed: { type: 'bool', default: false },
    hideUnfriends: { type: 'bool', default: false },
    pcUptimeOnFeed: { type: 'bool', default: false },
    minimalFeed: { type: 'bool', default: false },
    recentActionCooldownEnabled: { type: 'bool', default: false },
    recentActionCooldownMinutes: { type: 'int', default: 60 },
    sortFavorites: { type: 'bool', default: true },

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
    FriendLocationCardScale: { type: 'string', default: '1' },
    FriendLocationCardSpacing: { type: 'string', default: '1' },
    FriendLocationShowSameInstance: { type: 'bool', default: null },
    InstanceActivityBarWidth: { type: 'int', default: 25 },
    groupCalendarShowFeaturedEvents: { type: 'bool', default: false },
    toolsCategoryCollapsed: { type: 'string', default: null },

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

    // ── Onboarding ───────────────────────────────────
    onboarding_welcome_seen: { type: 'bool', default: false },

    // ── Avatar Provider ──────────────────────────────
    avatarRemoteDatabaseProviderList: {
        type: 'string',
        default: '["https://api.avtrdb.com/v3/avatar/search/vrcx"]'
    },
    avatarRemoteDatabaseProvider: { type: 'string', default: '' },
    showConfirmationOnSwitchAvatar: { type: 'bool', default: true }
};

/** DB key prefix */
export const DB_KEY_PREFIX = 'config:vrcx_';

/**
 * Schema name → DB key
 * e.g. "appLanguage" → "config:vrcx_applanguage"
 */
export function toDbKey(name) {
    return `${DB_KEY_PREFIX}${name.toLowerCase()}`;
}
