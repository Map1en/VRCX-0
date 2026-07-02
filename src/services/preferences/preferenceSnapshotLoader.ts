import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import storageRepository from '@/repositories/storageRepository';
import {
    DEFAULT_WEBHOOK_ACTIVITY_FILTERS,
    parseOverlayActivityFilterProfile
} from '@/shared/constants/overlayActivityFilters';
import { normalizeTrustColors } from '@/shared/utils/trustColors';
import {
    DEFAULT_PREFERENCES,
    normalizeAutoDeletePrintsLimit,
    normalizeDefaultLaunchMode,
    normalizeFeedTimeDisplayMode,
    normalizeFeedHiddenUsers,
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    normalizeTranslationApiType,
    normalizeWeekStartsOn,
    normalizeWristOverlayButton,
    normalizeWristOverlayHand,
    normalizeWristOverlaySize,
    normalizeWristOverlayStartMode,
    parseOverlayActivityFiltersPreference,
    parseSharedFeedFilters,
    type PreferencesSnapshot,
    usePreferencesStore
} from '@/state/preferencesStore';
import {
    normalizeNavWidth,
    normalizeTableDensity,
    useShellStore
} from '@/state/shellStore';

import { POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY } from '../changelogService';
import { configureRecentActionCooldown } from '../recentActionService';
import { applyTrustColorClasses } from '../trustColorService';
import {
    DEFAULT_NOTIFICATION_LAYOUT,
    DEFAULT_TABLE_LIMITS,
    DEFAULT_TABLE_PAGE_SIZE,
    DEFAULT_TABLE_PAGE_SIZES,
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL
} from './preferencesConstants';
import {
    applyAccessibleStatusClass,
    applyDataTableStripedClass,
    applyTableDensityClass,
    getBoolConfigWithLegacy,
    getIntConfigWithLegacy,
    normalizeBioLanguage,
    normalizeStringList,
    setDocumentLanguage
} from './preferencesCore';

export async function loadPreferenceSnapshot() {
    const [
        navIsCollapsed,
        navPanelWidth,
        rightSidebarOpen,
        notificationLayout,
        dataTableStriped,
        tableDensity,
        compactTableMode,
        accessibleStatusIndicators,
        showNewDashboardButton,
        recentActionCooldownEnabled,
        recentActionCooldownMinutes,
        screenshotHelper,
        screenshotHelperModifyFilename,
        screenshotHelperCopyToClipboard,
        saveInstancePrints,
        cropInstancePrints,
        autoDeleteOldPrints,
        autoDeletePrintsLimit,
        saveInstanceStickers,
        saveInstanceEmoji,
        userGeneratedContentPath,
        showInstanceIdInLocation,
        isAgeGatedInstancesVisible,
        hideNicknames,
        displayVRCPlusIconsAsAvatar,
        weekStartsOn,
        hideUserNotes,
        hideUserMemos,
        hideUnfriends,
        randomUserColours,
        notificationIconDot,
        showPostUpdateChangelogToast,
        autoInstallUpdatesOnStartup,
        autoBackgroundDownloadUpdates,
        desktopToast,
        afkDesktopToast,
        desktopNotificationSound,
        notificationTTS,
        notificationTTSNickName,
        notificationTTSVoice,
        xsNotifications,
        ovrtHudNotifications,
        ovrtWristNotifications,
        imageNotifications,
        notificationTimeout,
        notificationOpacity,
        webhookEnabled,
        webhookUrl,
        webhookFormat,
        wristOverlayEnabled,
        wristOverlayStartMode,
        wristOverlayButton,
        wristOverlayHand,
        wristOverlaySize,
        wristOverlayHidePrivateWorlds,
        wristOverlayDarkBackground,
        wristOverlayShowDevices,
        wristOverlayShowBatteryPercent,
        relaunchVRChatAfterCrash,
        vrcQuitFix,
        autoSweepVRChatCache,
        showConfirmationOnSwitchAvatar,
        gameLogDisabled,
        avatarAutoCleanup,
        defaultLaunchMode,
        anonymousUsageTelemetry,
        udonExceptionLogging,
        logResourceLoad,
        autoLoginDelayEnabled,
        autoLoginDelaySeconds,
        backgroundModeEnabled,
        isStartAtWindowsStartup,
        isStartAsMinimizedState,
        isCloseToTray,
        dtIsoFormat,
        dtHour12,
        trustColor,
        currentCulture,
        proxyServer,
        tablePageSize,
        tablePageSizes,
        maxTableSize,
        searchLimit,
        localFavoriteFriendsGroups,
        feedHiddenUsers,
        sharedFeedFilters,
        overlayActivityFilters,
        vrNotificationActivityFilters,
        desktopNotificationActivityFilters,
        webhookActivityFilters,
        feedTimeDisplayMode,
        youtubeAPI,
        translationAPI,
        bioLanguage,
        translationAPIType,
        translationEndpointId,
        translationAPIEndpoint,
        translationAPIModel,
        translationAPIPrompt,
        customFontPrimary,
        customFontSecondary,
        customFontOverride,
        discordActive,
        discordInstance,
        discordHideInvite,
        discordJoinButton,
        discordHideImage,
        discordShowPlatform,
        discordWorldIntegration,
        discordWorldNameAsDiscordStatus
    ] = await Promise.all([
        configRepository.getBool('navIsCollapsed', false),
        configRepository.getInt('navPanelWidth', 240),
        configRepository.getBool('rightSidebarOpen', true),
        configRepository.getString(
            'notificationLayout',
            DEFAULT_NOTIFICATION_LAYOUT
        ),
        configRepository.getBool('dataTableStriped', false),
        configRepository.getString('tableDensity', null),
        configRepository.getBool('compactTableMode', false),
        configRepository.getBool('VRCX_accessibleStatusIndicators', false),
        configRepository.getBool('showNewDashboardButton', true),
        configRepository.getBool('recentActionCooldownEnabled', false),
        configRepository.getInt('recentActionCooldownMinutes', 60),
        configRepository.getBool('screenshotHelper', true),
        configRepository.getBool('screenshotHelperModifyFilename', false),
        configRepository.getBool('screenshotHelperCopyToClipboard', false),
        configRepository.getBool('saveInstancePrints', false),
        configRepository.getBool('cropInstancePrints', false),
        configRepository.getBool('autoDeleteOldPrints', false),
        configRepository.getInt('autoDeletePrintsLimit', 60),
        configRepository.getBool('saveInstanceStickers', false),
        configRepository.getBool('saveInstanceEmoji', false),
        configRepository.getString('userGeneratedContentPath', ''),
        configRepository.getBool('VRCX_showInstanceIdInLocation', false),
        configRepository.getBool('VRCX_isAgeGatedInstancesVisible', true),
        configRepository.getBool('hideNicknames', false),
        configRepository.getBool('displayVRCPlusIconsAsAvatar', true),
        configRepository.getInt('weekStartsOn', 1),
        configRepository.getBool('hideUserNotes', false),
        configRepository.getBool('hideUserMemos', false),
        configRepository.getBool('hideUnfriends', false),
        configRepository.getBool('randomUserColours', false),
        configRepository.getBool('notificationIconDot', true),
        configRepository.getBool(POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY, true),
        configRepository.getBool('autoInstallUpdatesOnStartup', true),
        configRepository.getBool('autoBackgroundDownloadUpdates', false),
        configRepository.getString('desktopToast', 'Never'),
        configRepository.getBool('afkDesktopToast', false),
        configRepository.getBool('desktopNotificationSound', false),
        configRepository.getString('notificationTTS', 'Never'),
        configRepository.getBool('notificationTTSNickName', false),
        configRepository.getString('notificationTTSVoice', '0'),
        getBoolConfigWithLegacy('xsNotifications', true),
        getBoolConfigWithLegacy('ovrtHudNotifications', true),
        getBoolConfigWithLegacy('ovrtWristNotifications', false),
        getBoolConfigWithLegacy('imageNotifications', true),
        getIntConfigWithLegacy('notificationTimeout', 3000),
        getIntConfigWithLegacy('notificationOpacity', 100),
        configRepository.getBool('webhookEnabled', false),
        configRepository.getString('webhookUrl', ''),
        configRepository.getString('webhookFormat', 'generic'),
        configRepository.getBool('wristOverlayEnabled', false),
        configRepository.getString('wristOverlayStartMode', 'vrchatVrMode'),
        configRepository.getString('wristOverlayButton', 'grip'),
        configRepository.getString('wristOverlayHand', 'left'),
        configRepository.getString('wristOverlaySize', 'normal'),
        configRepository.getBool('wristOverlayHidePrivateWorlds', false),
        configRepository.getBool('wristOverlayDarkBackground', true),
        configRepository.getBool('wristOverlayShowDevices', true),
        configRepository.getBool('wristOverlayShowBatteryPercent', false),
        configRepository.getBool('relaunchVRChatAfterCrash', false),
        configRepository.getBool('vrcQuitFix', true),
        configRepository.getBool('autoSweepVRChatCache', false),
        configRepository.getBool('showConfirmationOnSwitchAvatar', true),
        configRepository.getBool('gameLogDisabled', false),
        configRepository.getString('avatarAutoCleanup', 'Off'),
        configRepository.getString('defaultLaunchMode', 'vr'),
        configRepository.getBool('anonymousUsageTelemetry', true),
        configRepository.getBool('udonExceptionLogging', false),
        configRepository.getBool('logResourceLoad', false),
        configRepository.getBool('autoLoginDelayEnabled', false),
        configRepository.getInt('autoLoginDelaySeconds', 0),
        configRepository.getBool('backgroundModeEnabled', false),
        configRepository.getBool('StartAtWindowsStartup', false),
        storageRepository.getString('VRCX_StartAsMinimizedState', 'false'),
        storageRepository.getString('VRCX_CloseToTray', 'false'),
        configRepository.getBool('dtIsoFormat', false),
        configRepository.getBool('dtHour12', false),
        configRepository.getObject('VRCX_trustColor', null),
        commands.appSystemCulture().catch(() => navigator.language || 'en-gb'),
        storageRepository.getString('VRCX_ProxyServer', ''),
        configRepository.getInt('VRCX_tablePageSize', DEFAULT_TABLE_PAGE_SIZE),
        configRepository.getArray(
            'VRCX_tablePageSizes',
            DEFAULT_TABLE_PAGE_SIZES
        ),
        configRepository.getInt(
            'maxTableSize_v2',
            DEFAULT_TABLE_LIMITS.maxTableSize
        ),
        configRepository.getInt(
            'searchLimit',
            DEFAULT_TABLE_LIMITS.searchLimit
        ),
        configRepository.getArray('localFavoriteFriendsGroups', []),
        configRepository.getString('feedHiddenUsers', '[]'),
        configRepository.getString(
            'sharedFeedFilters',
            JSON.stringify(DEFAULT_PREFERENCES.sharedFeedFilters)
        ),
        configRepository.getString('overlayActivityFilters', ''),
        configRepository.getString('vrNotificationActivityFilters', ''),
        configRepository.getString('desktopNotificationActivityFilters', ''),
        configRepository.getString('webhookActivityFilters', ''),
        configRepository.getString('feedTimeDisplayMode', 'relative'),
        configRepository.getBool('youtubeAPI', false),
        configRepository.getBool('translationAPI', false),
        configRepository.getString('bioLanguage', 'en'),
        configRepository.getString('translationAPIType', 'google'),
        configRepository.getString('translationEndpointId', ''),
        configRepository.getString(
            'translationAPIEndpoint',
            DEFAULT_TRANSLATION_ENDPOINT
        ),
        configRepository.getString(
            'translationAPIModel',
            DEFAULT_TRANSLATION_MODEL
        ),
        configRepository.getString('translationAPIPrompt', ''),
        configRepository.getString('customFontPrimary', ''),
        configRepository.getString('customFontSecondary', ''),
        configRepository.getString('customFontOverride', ''),
        configRepository.getBool('discordActive', false),
        configRepository.getBool('discordInstance', true),
        configRepository.getBool('discordHideInvite', true),
        configRepository.getBool('discordJoinButton', false),
        configRepository.getBool('discordHideImage', false),
        configRepository.getBool('discordShowPlatform', true),
        configRepository.getBool('discordWorldIntegration', true),
        configRepository.getBool('discordWorldNameAsDiscordStatus', false)
    ]);

    useShellStore.getState().setSidebarOpen(!navIsCollapsed);
    useShellStore.getState().setNavWidth(navPanelWidth);
    useShellStore.getState().setRightSidebarOpen(rightSidebarOpen);
    useShellStore
        .getState()
        .setNotificationLayout(
            notificationLayout || DEFAULT_NOTIFICATION_LAYOUT
        );
    useShellStore.getState().setNotificationIconDot(notificationIconDot);
    useShellStore.getState().setAppearancePreferences({
        displayVRCPlusIconsAsAvatar,
        hideNicknames
    });
    const resolvedTableDensity = normalizeTableDensity(
        tableDensity || (compactTableMode ? 'compact' : 'standard')
    );
    useShellStore.getState().setTableDensity(resolvedTableDensity);
    useShellStore.getState().setDatePreferences({
        dateCulture: String(currentCulture || ''),
        dateIsoFormat: Boolean(dtIsoFormat),
        dateHour12: Boolean(dtHour12)
    });
    const normalizedRecentActionCooldownMinutes = Number.isFinite(
        recentActionCooldownMinutes
    )
        ? recentActionCooldownMinutes
        : 60;
    applyTableDensityClass(resolvedTableDensity);
    applyDataTableStripedClass(dataTableStriped);
    applyAccessibleStatusClass(accessibleStatusIndicators);
    applyTrustColorClasses(trustColor);
    configureRecentActionCooldown({
        enabled: Boolean(recentActionCooldownEnabled),
        minutes: normalizedRecentActionCooldownMinutes
    });
    setDocumentLanguage(useShellStore.getState().locale || 'en');
    if (!tableDensity || tableDensity !== resolvedTableDensity) {
        await configRepository.setString(
            'VRCX_tableDensity',
            resolvedTableDensity
        );
    }

    const parsedSharedFeedFilters = parseSharedFeedFilters(sharedFeedFilters);
    const snapshot: PreferencesSnapshot = {
        notificationLayout: notificationLayout || DEFAULT_NOTIFICATION_LAYOUT,
        dataTableStriped: Boolean(dataTableStriped),
        tableDensity: resolvedTableDensity,
        accessibleStatusIndicators: Boolean(accessibleStatusIndicators),
        showNewDashboardButton: Boolean(showNewDashboardButton),
        recentActionCooldownEnabled: Boolean(recentActionCooldownEnabled),
        recentActionCooldownMinutes: normalizedRecentActionCooldownMinutes,
        screenshotHelper: Boolean(screenshotHelper),
        screenshotHelperModifyFilename: Boolean(screenshotHelperModifyFilename),
        screenshotHelperCopyToClipboard: Boolean(
            screenshotHelperCopyToClipboard
        ),
        saveInstancePrints: Boolean(saveInstancePrints),
        cropInstancePrints: Boolean(cropInstancePrints),
        autoDeleteOldPrints: Boolean(autoDeleteOldPrints),
        autoDeletePrintsLimit: normalizeAutoDeletePrintsLimit(
            autoDeletePrintsLimit
        ),
        saveInstanceStickers: Boolean(saveInstanceStickers),
        saveInstanceEmoji: Boolean(saveInstanceEmoji),
        userGeneratedContentPath: userGeneratedContentPath || '',
        showInstanceIdInLocation: Boolean(showInstanceIdInLocation),
        isAgeGatedInstancesVisible: Boolean(isAgeGatedInstancesVisible),
        hideNicknames: Boolean(hideNicknames),
        displayVRCPlusIconsAsAvatar: Boolean(displayVRCPlusIconsAsAvatar),
        weekStartsOn: normalizeWeekStartsOn(weekStartsOn),
        hideUserNotes: Boolean(hideUserNotes),
        hideUserMemos: Boolean(hideUserMemos),
        hideUnfriends: Boolean(hideUnfriends),
        randomUserColours: Boolean(randomUserColours),
        notificationIconDot: Boolean(notificationIconDot),
        showPostUpdateChangelogToast: Boolean(showPostUpdateChangelogToast),
        autoInstallUpdatesOnStartup: Boolean(autoInstallUpdatesOnStartup),
        autoBackgroundDownloadUpdates: Boolean(autoBackgroundDownloadUpdates),
        desktopToast: desktopToast || 'Never',
        afkDesktopToast: Boolean(afkDesktopToast),
        desktopNotificationSound: Boolean(desktopNotificationSound),
        notificationTTS: notificationTTS || 'Never',
        notificationTTSNickName: Boolean(notificationTTSNickName),
        notificationTTSVoice: notificationTTSVoice || '0',
        xsNotifications: Boolean(xsNotifications),
        ovrtHudNotifications: Boolean(ovrtHudNotifications),
        ovrtWristNotifications: Boolean(ovrtWristNotifications),
        imageNotifications: Boolean(imageNotifications),
        notificationTimeout: Number.isFinite(notificationTimeout)
            ? notificationTimeout
            : 3000,
        notificationOpacity: Number.isFinite(notificationOpacity)
            ? notificationOpacity
            : 100,
        webhookEnabled: Boolean(webhookEnabled),
        webhookUrl: String(webhookUrl || ''),
        webhookFormat: webhookFormat === 'discord' ? 'discord' : 'generic',
        wristOverlayEnabled: Boolean(wristOverlayEnabled),
        wristOverlayStartMode: normalizeWristOverlayStartMode(
            wristOverlayStartMode
        ),
        wristOverlayButton: normalizeWristOverlayButton(wristOverlayButton),
        wristOverlayHand: normalizeWristOverlayHand(wristOverlayHand),
        wristOverlaySize: normalizeWristOverlaySize(wristOverlaySize),
        wristOverlayHidePrivateWorlds: Boolean(wristOverlayHidePrivateWorlds),
        wristOverlayDarkBackground: Boolean(wristOverlayDarkBackground),
        wristOverlayShowDevices: Boolean(wristOverlayShowDevices),
        wristOverlayShowBatteryPercent: Boolean(wristOverlayShowBatteryPercent),
        relaunchVRChatAfterCrash: Boolean(relaunchVRChatAfterCrash),
        vrcQuitFix: Boolean(vrcQuitFix),
        autoSweepVRChatCache: Boolean(autoSweepVRChatCache),
        showConfirmationOnSwitchAvatar: Boolean(showConfirmationOnSwitchAvatar),
        gameLogDisabled: Boolean(gameLogDisabled),
        avatarAutoCleanup: avatarAutoCleanup || 'Off',
        defaultLaunchMode: normalizeDefaultLaunchMode(defaultLaunchMode),
        anonymousUsageTelemetry: Boolean(anonymousUsageTelemetry),
        udonExceptionLogging: Boolean(udonExceptionLogging),
        logResourceLoad: Boolean(logResourceLoad),
        autoLoginDelayEnabled: Boolean(autoLoginDelayEnabled),
        autoLoginDelaySeconds: Number.isFinite(autoLoginDelaySeconds)
            ? autoLoginDelaySeconds
            : 0,
        backgroundModeEnabled: Boolean(backgroundModeEnabled),
        isStartAtWindowsStartup: Boolean(isStartAtWindowsStartup),
        isStartAsMinimizedState: isStartAsMinimizedState === 'true',
        isCloseToTray: isCloseToTray === 'true',
        dtIsoFormat: Boolean(dtIsoFormat),
        dtHour12: Boolean(dtHour12),
        trustColor: normalizeTrustColors(trustColor),
        navPanelWidth: normalizeNavWidth(navPanelWidth),
        navIsCollapsed: Boolean(navIsCollapsed),
        proxyServer: proxyServer || '',
        tablePageSize: normalizeTablePageSize(tablePageSize),
        tablePageSizes: normalizeTablePageSizes(tablePageSizes),
        tableLimits: normalizeTableLimits({ maxTableSize, searchLimit }),
        localFavoriteFriendsGroups: normalizeStringList(
            localFavoriteFriendsGroups
        ),
        feedHiddenUsers: normalizeFeedHiddenUsers(feedHiddenUsers),
        sharedFeedFilters: parsedSharedFeedFilters,
        overlayActivityFilters: parseOverlayActivityFiltersPreference(
            overlayActivityFilters,
            sharedFeedFilters
        ),
        vrNotificationActivityFilters: parseOverlayActivityFilterProfile(
            vrNotificationActivityFilters
        ),
        desktopNotificationActivityFilters: parseOverlayActivityFilterProfile(
            desktopNotificationActivityFilters
        ),
        webhookActivityFilters: parseOverlayActivityFilterProfile(
            webhookActivityFilters || DEFAULT_WEBHOOK_ACTIVITY_FILTERS
        ),
        feedTimeDisplayMode: normalizeFeedTimeDisplayMode(feedTimeDisplayMode),
        youtubeAPI: Boolean(youtubeAPI),
        translationAPI: Boolean(translationAPI),
        bioLanguage: normalizeBioLanguage(bioLanguage),
        translationAPIType: normalizeTranslationApiType(translationAPIType),
        translationEndpointId: String(translationEndpointId || ''),
        translationAPIEndpoint:
            translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: translationAPIModel || DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: translationAPIPrompt || '',
        customFontPrimary: customFontPrimary || '',
        customFontSecondary: customFontSecondary || '',
        customFontOverride: customFontOverride || '',
        discordActive: Boolean(discordActive),
        discordInstance: Boolean(discordInstance),
        discordHideInvite: Boolean(discordHideInvite),
        discordJoinButton: Boolean(discordJoinButton),
        discordHideImage: Boolean(discordHideImage),
        discordShowPlatform: Boolean(discordShowPlatform),
        discordWorldIntegration: Boolean(discordWorldIntegration),
        discordWorldNameAsDiscordStatus: Boolean(
            discordWorldNameAsDiscordStatus
        )
    };
    usePreferencesStore.getState().hydratePreferences(snapshot);
    return snapshot;
}
