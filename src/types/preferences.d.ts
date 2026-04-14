export type NotificationLayoutPreference = 'notification-center' | 'table';
export type TableDensityPreference = 'standard' | 'comfortable' | 'compact';
export type TranslationApiType = 'google' | 'openai';

export interface TableLimitsPreference {
    maxTableSize: number;
    searchLimit: number;
}

export interface SharedFeedFiltersPreference {
    noty: Record<string, string>;
    wrist: Record<string, string>;
}

export type TrustColorKey =
    | 'untrusted'
    | 'basic'
    | 'known'
    | 'trusted'
    | 'veteran'
    | 'vip'
    | 'troll';

export type TrustColorsPreference = Record<TrustColorKey, string>;

export type DiscordPreferenceKey =
    | 'discordActive'
    | 'discordInstance'
    | 'discordHideInvite'
    | 'discordJoinButton'
    | 'discordHideImage'
    | 'discordShowPlatform'
    | 'discordWorldIntegration'
    | 'discordWorldNameAsDiscordStatus';

export interface PreferencesSnapshot {
    notificationLayout: NotificationLayoutPreference;
    dataTableStriped: boolean;
    tableDensity: TableDensityPreference;
    showPointerOnHover: boolean;
    accessibleStatusIndicators: boolean;
    showNewDashboardButton: boolean;
    recentActionCooldownEnabled: boolean;
    recentActionCooldownMinutes: number;
    screenshotHelper: boolean;
    screenshotHelperModifyFilename: boolean;
    screenshotHelperCopyToClipboard: boolean;
    saveInstancePrints: boolean;
    cropInstancePrints: boolean;
    saveInstanceStickers: boolean;
    saveInstanceEmoji: boolean;
    userGeneratedContentPath: string;
    showInstanceIdInLocation: boolean;
    isAgeGatedInstancesVisible: boolean;
    hideNicknames: boolean;
    displayVRCPlusIconsAsAvatar: boolean;
    sortFavorites: boolean;
    weekStartsOn: 0 | 1 | 6;
    dtIsoFormat: boolean;
    dtHour12: boolean;
    hideUserNotes: boolean;
    hideUserMemos: boolean;
    hideUnfriends: boolean;
    randomUserColours: boolean;
    notificationIconDot: boolean;
    desktopToast: string;
    afkDesktopToast: boolean;
    notificationTTS: string;
    notificationTTSNickName: boolean;
    notificationTTSVoice: string;
    relaunchVRChatAfterCrash: boolean;
    vrcQuitFix: boolean;
    autoSweepVRChatCache: boolean;
    showConfirmationOnSwitchAvatar: boolean;
    gameLogDisabled: boolean;
    avatarAutoCleanup: string;
    enableAppLauncher: boolean;
    enableAppLauncherAutoClose: boolean;
    enableAppLauncherRunProcessOnce: boolean;
    udonExceptionLogging: boolean;
    logResourceLoad: boolean;
    logEmptyAvatars: boolean;
    autoLoginDelayEnabled: boolean;
    autoLoginDelaySeconds: number;
    isStartAtWindowsStartup: boolean;
    isStartAsMinimizedState: boolean;
    isCloseToTray: boolean;
    disableGpuAcceleration: boolean;
    navPanelWidth: number;
    navIsCollapsed: boolean;
    proxyServer: string;
    tablePageSizes: number[];
    tableLimits: TableLimitsPreference;
    localFavoriteFriendsGroups: string[];
    sharedFeedFilters: SharedFeedFiltersPreference;
    trustColor: TrustColorsPreference;
    youtubeAPI: boolean;
    translationAPI: boolean;
    bioLanguage: string;
    translationAPIType: TranslationApiType;
    translationAPIEndpoint: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
    discordActive: boolean;
    discordInstance: boolean;
    discordHideInvite: boolean;
    discordJoinButton: boolean;
    discordHideImage: boolean;
    discordShowPlatform: boolean;
    discordWorldIntegration: boolean;
    discordWorldNameAsDiscordStatus: boolean;
}

export interface PreferencesStoreState extends PreferencesSnapshot {
    preferencesHydrated: boolean;
    hydratePreferences(snapshot: Partial<PreferencesSnapshot>): void;
    patchPreferences(patch: Partial<PreferencesSnapshot>): void;
    setPreferenceValue<K extends keyof PreferencesSnapshot>(
        key: K,
        value: PreferencesSnapshot[K]
    ): void;
}
