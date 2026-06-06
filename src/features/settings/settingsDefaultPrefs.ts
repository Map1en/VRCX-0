import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY
} from '@/services/themeService';
import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { TRUST_COLOR_DEFAULTS } from '@/shared/utils/trustColors';

import {
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    DEFAULT_OVERLAY_ACTIVITY_FILTERS,
    DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
    normalizeSharedFeedFilters,
    TABLE_PAGE_SIZE_DEFAULTS
} from './settingsValues';

export function createDefaultSettingsPrefs() {
    return {
        notificationLayout: 'notification-center',
        dataTableStriped: false,
        tableDensity: 'standard',
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
        weekStartsOn: 1,
        dtIsoFormat: false,
        dtHour12: false,
        hideNicknames: false,
        hideUserNotes: false,
        hideUserMemos: false,
        hideUnfriends: false,
        randomUserColours: false,
        notificationIconDot: true,
        showPostUpdateChangelogToast: true,
        desktopToast: 'Never',
        afkDesktopToast: false,
        desktopNotificationSound: false,
        notificationTTS: 'Never',
        notificationTTSNickName: false,
        notificationTTSVoice: '0',
        xsNotifications: true,
        ovrtHudNotifications: true,
        ovrtWristNotifications: false,
        imageNotifications: true,
        notificationTimeout: 3000,
        notificationOpacity: 100,
        wristOverlayEnabled: false,
        wristOverlayStartMode: 'vrchatVrMode',
        wristOverlayButton: 'grip',
        wristOverlayHand: 'left',
        wristOverlaySize: 'normal',
        wristOverlayHidePrivateWorlds: false,
        wristOverlayDarkBackground: true,
        wristOverlayShowDevices: true,
        wristOverlayShowBatteryPercent: false,
        relaunchVRChatAfterCrash: false,
        vrcQuitFix: true,
        autoSweepVRChatCache: false,
        showConfirmationOnSwitchAvatar: true,
        gameLogDisabled: false,
        avatarAutoCleanup: 'Off',
        defaultLaunchMode: 'vr',
        udonExceptionLogging: false,
        logResourceLoad: false,
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        backgroundModeEnabled: false,
        isStartAtWindowsStartup: false,
        isStartAsMinimizedState: false,
        isCloseToTray: false,
        navIsCollapsed: false,
        proxyServer: '',
        tablePageSize: 20,
        tablePageSizes: [...TABLE_PAGE_SIZE_DEFAULTS],
        tableLimits: {
            maxTableSize: DEFAULT_MAX_TABLE_SIZE,
            searchLimit: DEFAULT_SEARCH_LIMIT
        },
        localFavoriteFriendsGroups: [],
        sharedFeedFilters: normalizeSharedFeedFilters(
            sharedFeedFiltersDefaults
        ),
        overlayActivityFilters: DEFAULT_OVERLAY_ACTIVITY_FILTERS,
        vrNotificationActivityFilters: DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
        feedTimeDisplayMode: 'relative',
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
        trustColor: {
            ...TRUST_COLOR_DEFAULTS
        }
    };
}
