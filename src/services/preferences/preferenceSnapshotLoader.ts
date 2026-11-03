import { normalizeLanguageCode } from '@/localization/locales';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import storageRepository from '@/repositories/storageRepository';
import { getPrefetchedSystemCulture } from '@/services/startupBootstrapSnapshot';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY
} from '@/shared/constants/fonts';
import { normalizeAvatarAutoCleanupPreference } from '@/shared/constants/settings';
import {
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL
} from '@/shared/constants/settings';
import { MINUTES_PER_DAY } from '@/shared/constants/time';
import { DEFAULT_GENERIC_WEBHOOK_FIELDS } from '@/shared/constants/webhook';
import { normalizeTrustColors } from '@/shared/utils/trustColors';
import {
    normalizeAutoDeletePrintsLimit,
    normalizeBackgroundModeDelayMinutes,
    normalizeFeedTimeDisplayMode,
    normalizeFeedHiddenUsers,
    normalizeHmdNotificationPosition,
    normalizeHmdNotificationStyle,
    normalizeNotificationTtsNameMode,
    normalizeOverlayStartMode,
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    normalizeTranslationApiType,
    normalizeUserNameColourStyle,
    normalizeWeekStartsOn,
    normalizeWristOverlayButton,
    normalizeWristOverlayHand,
    normalizeWristOverlaySize,
    normalizeWristOverlayStartMode,
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
import {
    normalizeAppCjkFontPack,
    normalizeAppFontFamily
} from '../themeService';
import { applyTrustColorClasses } from '../trustColorService';
import {
    DEFAULT_NOTIFICATION_LAYOUT,
    DEFAULT_TABLE_LIMITS,
    DEFAULT_TABLE_PAGE_SIZE,
    DEFAULT_TABLE_PAGE_SIZES
} from './preferencesConstants';
import {
    applyAccessibleStatusClass,
    applyDataTableStripedClass,
    applyReducedMotionAndBlurClass,
    applyTableDensityClass,
    normalizeStringList,
    setDocumentLanguage
} from './preferencesCore';

function resolveProxyEnabled(
    rawEnabled: unknown,
    proxyServer: unknown
): boolean {
    const enabledText = String(rawEnabled ?? '').trim();
    if (enabledText) {
        return ['true', '1', 'yes', 'on'].includes(enabledText.toLowerCase());
    }
    return String(proxyServer ?? '').trim() !== '';
}

export async function loadPreferenceSnapshot() {
    const [
        navIsCollapsed,
        navPanelWidth,
        rightSidebarOpen,
        notificationLayout,
        dataTableStriped,
        tableDensity,
        compactTableMode,
        reducedMotionAndBlur,
        accessibleStatusIndicators,
        showNewDashboardButton,
        recentActionCooldownEnabled,
        autoDeclineFriendRequests,
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
        showUserDialogProfileBackground,
        showUserDialogAvatarFrame,
        showUserDialogProfileEffect,
        showUserDialogNameplateEffect,
        showSidebarAvatarFrame,
        showSidebarNameplate,
        showHoverCardAvatarFrame,
        showHoverCardProfileEffect,
        showHoverCardNameplate,
        showFriendsLocationsPeopleAvatarFrame,
        showFriendsLocationsPeopleNameplate,
        showFriendsLocationsWorldsAvatarFrame,
        showFriendsLocationsWorldsNameplate,
        showActivityJourneyAvatarFrame,
        showActivityJourneyNameplate,
        weekStartsOn,
        hideUserNotes,
        hideUserMemos,
        friendLogNotificationDot,
        hideUnfriends,
        profileBioScanEnabled,
        randomUserColours,
        randomUserColourStyle,
        notificationIconDot,
        taskbarIconDot,
        showPostUpdateChangelogToast,
        autoInstallUpdatesOnStartup,
        desktopToast,
        afkDesktopToast,
        overlayToast,
        desktopNotificationSound,
        desktopNotificationAvatars,
        notificationDoNotDisturbEndOnGameStart,
        busyStatusDoNotDisturb,
        hideVideoErrorNotifications,
        notificationTTS,
        notificationTTSNickName,
        notificationTTSNameMode,
        notificationTTSVoiceNative,
        notificationTTSVolume,
        xsNotifications,
        ovrtHudNotifications,
        ovrtWristNotifications,
        imageNotifications,
        notificationTimeout,
        notificationOpacity,
        hmdNotificationsEnabled,
        hmdNotificationStartMode,
        hmdNotificationTimeout,
        hmdNotificationOpacity,
        hmdNotificationPosition,
        hmdNotificationStyle,
        hmdNotificationAvatars,
        hmdNotificationTrackerDisconnect,
        desktopWidgetOpacity,
        desktopWidgetNewestOnTop,
        webhookEnabled,
        webhookAuthEventsEnabled,
        webhookUrl,
        webhookFormat,
        webhookFields,
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
        focusVrchatOnJoin,
        autoSweepVRChatCache,
        gameLogDisabled,
        feedPersistenceDisabled,
        avatarAutoCleanup,
        anonymousUsageTelemetry,
        udonExceptionLogging,
        logResourceLoad,
        autoLoginDelayEnabled,
        autoLoginDelaySeconds,
        backgroundModeEnabled,
        backgroundModeDelayEnabled,
        backgroundModeDelayMinutes,
        isStartAtWindowsStartup,
        isStartAsMinimizedState,
        isCloseToTray,
        systemWindowFrame,
        dtIsoFormat,
        dtHour12,
        trustColor,
        currentCulture,
        proxyEnabledRaw,
        proxyServer,
        tablePageSize,
        tablePageSizes,
        maxTableSize,
        searchLimit,
        localFavoriteFriendsGroups,
        feedHiddenUsers,
        feedHiddenUsersHideNotifications,
        feedHiddenUsersHideAll,
        hidePrivateFromFeed,
        activityFilterProfiles,
        feedTimeDisplayMode,
        youtubeAPI,
        translationAPI,
        bioLanguage,
        translationAPIType,
        translationEndpointId,
        translationAPIEndpoint,
        translationAPIModel,
        translationAPIPrompt,
        translationAPIReasoningEffort,
        appFontFamily,
        appCjkFontPack,
        customFontFamily,
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
        configRepository.getRawValue('tableDensity'),
        configRepository.getBool('compactTableMode', false),
        configRepository.getBool('reducedMotionAndBlur', false),
        configRepository.getBool('VRCX_accessibleStatusIndicators', false),
        configRepository.getBool('showNewDashboardButton', true),
        configRepository.getBool('recentActionCooldownEnabled', false),
        configRepository.getBool('autoDeclineFriendRequests', false),
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
        configRepository.getBool('showUserDialogProfileBackground', true),
        configRepository.getBool('showUserDialogAvatarFrame', true),
        configRepository.getBool('showUserDialogProfileEffect', true),
        configRepository.getBool('showUserDialogNameplateEffect', true),
        configRepository.getBool('showSidebarAvatarFrame', true),
        configRepository.getBool('showSidebarNameplate', true),
        configRepository.getBool('showHoverCardAvatarFrame', true),
        configRepository.getBool('showHoverCardProfileEffect', false),
        configRepository.getBool('showHoverCardNameplate', false),
        configRepository.getBool('showFriendsLocationsPeopleAvatarFrame', true),
        configRepository.getBool('showFriendsLocationsPeopleNameplate', false),
        configRepository.getBool('showFriendsLocationsWorldsAvatarFrame', true),
        configRepository.getBool('showFriendsLocationsWorldsNameplate', true),
        configRepository.getBool('showActivityJourneyAvatarFrame', true),
        configRepository.getBool('showActivityJourneyNameplate', true),
        configRepository.getInt('weekStartsOn', 1),
        configRepository.getBool('hideUserNotes', false),
        configRepository.getBool('hideUserMemos', false),
        configRepository.getBool('friendLogNotificationDot', true),
        configRepository.getBool('hideUnfriends', false),
        configRepository.getBool('profileBioScanEnabled', false),
        configRepository.getBool('randomUserColours', false),
        configRepository.getString('randomUserColourStyle', 'classic'),
        configRepository.getBool('notificationIconDot', true),
        configRepository.getBool('taskbarIconDot', true),
        configRepository.getBool(POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY, true),
        configRepository.getBool('autoInstallUpdatesOnStartup', true),
        configRepository.getString('desktopToast', 'Never'),
        configRepository.getBool('afkDesktopToast', false),
        configRepository.getString('overlayToast', 'Game Running'),
        configRepository.getBool('desktopNotificationSound', false),
        configRepository.getBool('desktopNotificationAvatars', true),
        configRepository.getBool(
            'notificationDoNotDisturbEndOnGameStart',
            true
        ),
        configRepository.getBool('busyStatusDoNotDisturb', true),
        configRepository.getBool('hideVideoErrorNotifications', false),
        configRepository.getString('notificationTTS', 'Never'),
        configRepository.getBool('notificationTTSNickName', false),
        configRepository.getString('notificationTTSNameMode', ''),
        configRepository.getString('notificationTTSVoiceNative', ''),
        configRepository.getInt('notificationTTSVolume', 100),
        configRepository.getBool('xsNotifications', false),
        configRepository.getBool('ovrtHudNotifications', false),
        configRepository.getBool('ovrtWristNotifications', false),
        configRepository.getBool('imageNotifications', true),
        configRepository.getInt('notificationTimeout', 3000),
        configRepository.getInt('notificationOpacity', 100),
        configRepository.getBool('hmdNotificationsEnabled', false),
        configRepository.getString('hmdNotificationStartMode', 'vrchatVrMode'),
        configRepository.getInt('hmdNotificationTimeout', 5000),
        configRepository.getInt('hmdNotificationOpacity', 90),
        configRepository.getString('hmdNotificationPosition', 'bottom'),
        configRepository.getString('hmdNotificationStyle', 'standard'),
        configRepository.getBool('hmdNotificationAvatars', true),
        configRepository.getBool('hmdNotificationTrackerDisconnect', true),
        configRepository.getInt('desktopWidgetOpacity', 55),
        configRepository.getBool('desktopWidgetNewestOnTop', true),
        configRepository.getBool('webhookEnabled', false),
        configRepository.getBool('webhookAuthEventsEnabled', true),
        configRepository.getString('webhookUrl', ''),
        configRepository.getString('webhookFormat', 'generic'),
        configRepository.getString(
            'webhookFields',
            DEFAULT_GENERIC_WEBHOOK_FIELDS
        ),
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
        configRepository.getBool('focusVrchatOnJoin', false),
        configRepository.getBool('autoSweepVRChatCache', false),
        configRepository.getBool('gameLogDisabled', false),
        configRepository.getBool('feedPersistenceDisabled', false),
        configRepository.getString('avatarAutoCleanup', 'Off'),
        configRepository.getBool('anonymousUsageTelemetry', true),
        configRepository.getBool('udonExceptionLogging', false),
        configRepository.getBool('logResourceLoad', false),
        configRepository.getBool('autoLoginDelayEnabled', false),
        configRepository.getInt('autoLoginDelaySeconds', 0),
        configRepository.getBool('backgroundModeEnabled', false),
        configRepository.getBool('backgroundModeDelayEnabled', false),
        configRepository.getInt('backgroundModeDelayMinutes', 60),
        configRepository.getBool('StartAtWindowsStartup', false),
        storageRepository.getString('VRCX_StartAsMinimizedState', 'false'),
        storageRepository.getString('VRCX_CloseToTray', 'false'),
        storageRepository.getString('VRCX_SystemWindowFrame', 'false'),
        configRepository.getBool('dtIsoFormat', false),
        configRepository.getBool('dtHour12', false),
        configRepository.getObject('VRCX_trustColor', null),
        getPrefetchedSystemCulture() ??
            commands
                .appSystemCulture()
                .catch(() => navigator.language || 'en-gb'),
        storageRepository.getString('VRCX_ProxyEnabled', ''),
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
        configRepository.getBool('feedHiddenUsersHideNotifications', true),
        configRepository.getBool('feedHiddenUsersHideAll', false),
        configRepository.getBool('hidePrivateFromFeed', false),
        commands.appNotificationActivityFiltersGet(),
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
        configRepository.getString('translationAPIReasoningEffort', ''),
        configRepository.getString('VRCX_fontFamily', APP_FONT_DEFAULT_KEY),
        configRepository.getString(
            'VRCX_cjkFontPack',
            APP_CJK_FONT_PACK_DEFAULT_KEY
        ),
        configRepository.getString('customFontFamily', ''),
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
            notificationLayout === 'table'
                ? 'table'
                : DEFAULT_NOTIFICATION_LAYOUT
        );
    useShellStore.getState().setNotificationIconDot(notificationIconDot);
    useShellStore.getState().setTaskbarIconDot(taskbarIconDot);
    useShellStore.getState().setAppearancePreferences({ hideNicknames });
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
        ? Math.min(MINUTES_PER_DAY, Math.max(1, recentActionCooldownMinutes))
        : 60;
    applyTableDensityClass(resolvedTableDensity);
    applyDataTableStripedClass(dataTableStriped);
    applyReducedMotionAndBlurClass(reducedMotionAndBlur);
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

    const snapshot: PreferencesSnapshot = {
        notificationLayout: notificationLayout || DEFAULT_NOTIFICATION_LAYOUT,
        dataTableStriped: Boolean(dataTableStriped),
        tableDensity: resolvedTableDensity,
        reducedMotionAndBlur: Boolean(reducedMotionAndBlur),
        accessibleStatusIndicators: Boolean(accessibleStatusIndicators),
        showNewDashboardButton: Boolean(showNewDashboardButton),
        recentActionCooldownEnabled: Boolean(recentActionCooldownEnabled),
        autoDeclineFriendRequests: Boolean(autoDeclineFriendRequests),
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
        showUserDialogProfileBackground: Boolean(
            showUserDialogProfileBackground
        ),
        showUserDialogAvatarFrame: Boolean(showUserDialogAvatarFrame),
        showUserDialogProfileEffect: Boolean(showUserDialogProfileEffect),
        showUserDialogNameplateEffect: Boolean(showUserDialogNameplateEffect),
        showSidebarAvatarFrame: Boolean(showSidebarAvatarFrame),
        showSidebarNameplate: Boolean(showSidebarNameplate),
        showHoverCardAvatarFrame: Boolean(showHoverCardAvatarFrame),
        showHoverCardProfileEffect: Boolean(showHoverCardProfileEffect),
        showHoverCardNameplate: Boolean(showHoverCardNameplate),
        showFriendsLocationsPeopleAvatarFrame: Boolean(
            showFriendsLocationsPeopleAvatarFrame
        ),
        showFriendsLocationsPeopleNameplate: Boolean(
            showFriendsLocationsPeopleNameplate
        ),
        showFriendsLocationsWorldsAvatarFrame: Boolean(
            showFriendsLocationsWorldsAvatarFrame
        ),
        showFriendsLocationsWorldsNameplate: Boolean(
            showFriendsLocationsWorldsNameplate
        ),
        showActivityJourneyAvatarFrame: Boolean(showActivityJourneyAvatarFrame),
        showActivityJourneyNameplate: Boolean(showActivityJourneyNameplate),
        weekStartsOn: normalizeWeekStartsOn(weekStartsOn),
        hideUserNotes: Boolean(hideUserNotes),
        hideUserMemos: Boolean(hideUserMemos),
        friendLogNotificationDot: Boolean(friendLogNotificationDot),
        hideUnfriends: Boolean(hideUnfriends),
        profileBioScanEnabled: Boolean(profileBioScanEnabled),
        randomUserColours: Boolean(randomUserColours),
        randomUserColourStyle: normalizeUserNameColourStyle(
            randomUserColourStyle
        ),
        notificationIconDot: Boolean(notificationIconDot),
        taskbarIconDot: Boolean(taskbarIconDot),
        showPostUpdateChangelogToast: Boolean(showPostUpdateChangelogToast),
        autoInstallUpdatesOnStartup: Boolean(autoInstallUpdatesOnStartup),
        desktopToast: desktopToast || 'Never',
        afkDesktopToast: Boolean(afkDesktopToast),
        overlayToast: overlayToast || 'Game Running',
        desktopNotificationSound: Boolean(desktopNotificationSound),
        desktopNotificationAvatars: Boolean(desktopNotificationAvatars),
        notificationDoNotDisturbEndOnGameStart: Boolean(
            notificationDoNotDisturbEndOnGameStart
        ),
        busyStatusDoNotDisturb: Boolean(busyStatusDoNotDisturb),
        hideVideoErrorNotifications: Boolean(hideVideoErrorNotifications),
        notificationTTS: notificationTTS || 'Never',
        notificationTTSNickName: Boolean(notificationTTSNickName),
        notificationTTSNameMode: normalizeNotificationTtsNameMode(
            notificationTTSNameMode,
            notificationTTSNickName
        ),
        notificationTTSVoiceNative: String(notificationTTSVoiceNative || ''),
        notificationTTSVolume: Number.isFinite(notificationTTSVolume)
            ? Math.min(100, Math.max(0, notificationTTSVolume))
            : 100,
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
        hmdNotificationsEnabled: Boolean(hmdNotificationsEnabled),
        hmdNotificationStartMode: normalizeOverlayStartMode(
            hmdNotificationStartMode
        ),
        hmdNotificationTimeout: Number.isFinite(hmdNotificationTimeout)
            ? Math.min(30000, Math.max(1000, hmdNotificationTimeout))
            : 5000,
        hmdNotificationOpacity: Number.isFinite(hmdNotificationOpacity)
            ? Math.min(100, Math.max(0, hmdNotificationOpacity))
            : 90,
        hmdNotificationPosition: normalizeHmdNotificationPosition(
            hmdNotificationPosition
        ),
        hmdNotificationStyle:
            normalizeHmdNotificationStyle(hmdNotificationStyle),
        hmdNotificationAvatars: Boolean(hmdNotificationAvatars),
        hmdNotificationTrackerDisconnect: Boolean(
            hmdNotificationTrackerDisconnect
        ),
        desktopWidgetOpacity: Number.isFinite(desktopWidgetOpacity)
            ? Math.min(100, Math.max(0, desktopWidgetOpacity))
            : 55,
        desktopWidgetNewestOnTop: Boolean(desktopWidgetNewestOnTop),
        webhookEnabled: Boolean(webhookEnabled),
        webhookAuthEventsEnabled: Boolean(webhookAuthEventsEnabled),
        webhookUrl: String(webhookUrl || ''),
        webhookFormat: webhookFormat === 'discord' ? 'discord' : 'generic',
        webhookFields: String(webhookFields || DEFAULT_GENERIC_WEBHOOK_FIELDS),
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
        focusVrchatOnJoin: Boolean(focusVrchatOnJoin),
        autoSweepVRChatCache: Boolean(autoSweepVRChatCache),
        gameLogDisabled: Boolean(gameLogDisabled),
        feedPersistenceDisabled: Boolean(feedPersistenceDisabled),
        avatarAutoCleanup:
            normalizeAvatarAutoCleanupPreference(avatarAutoCleanup),
        anonymousUsageTelemetry: Boolean(anonymousUsageTelemetry),
        udonExceptionLogging: Boolean(udonExceptionLogging),
        logResourceLoad: Boolean(logResourceLoad),
        autoLoginDelayEnabled: Boolean(autoLoginDelayEnabled),
        autoLoginDelaySeconds: Number.isFinite(autoLoginDelaySeconds)
            ? autoLoginDelaySeconds
            : 0,
        backgroundModeEnabled: Boolean(backgroundModeEnabled),
        backgroundModeDelayEnabled: Boolean(backgroundModeDelayEnabled),
        backgroundModeDelayMinutes: normalizeBackgroundModeDelayMinutes(
            backgroundModeDelayMinutes
        ),
        isStartAtWindowsStartup: Boolean(isStartAtWindowsStartup),
        isStartAsMinimizedState: isStartAsMinimizedState === 'true',
        isCloseToTray: isCloseToTray === 'true',
        systemWindowFrame: systemWindowFrame === 'true',
        dtIsoFormat: Boolean(dtIsoFormat),
        dtHour12: Boolean(dtHour12),
        trustColor: normalizeTrustColors(trustColor),
        navPanelWidth: normalizeNavWidth(navPanelWidth),
        navIsCollapsed: Boolean(navIsCollapsed),
        proxyEnabled: resolveProxyEnabled(proxyEnabledRaw, proxyServer),
        proxyServer: proxyServer || '',
        tablePageSize: normalizeTablePageSize(tablePageSize),
        tablePageSizes: normalizeTablePageSizes(tablePageSizes),
        tableLimits: normalizeTableLimits({ maxTableSize, searchLimit }),
        localFavoriteFriendsGroups: normalizeStringList(
            localFavoriteFriendsGroups
        ),
        feedHiddenUsers: normalizeFeedHiddenUsers(feedHiddenUsers),
        feedHiddenUsersHideNotifications: Boolean(
            feedHiddenUsersHideNotifications
        ),
        feedHiddenUsersHideAll: Boolean(feedHiddenUsersHideAll),
        hidePrivateFromFeed: Boolean(hidePrivateFromFeed),
        overlayActivityFilters: activityFilterProfiles.wrist,
        vrNotificationActivityFilters: activityFilterProfiles.vr,
        hmdNotificationActivityFilters: activityFilterProfiles.hmd,
        desktopNotificationActivityFilters: activityFilterProfiles.desktop,
        desktopWidgetActivityFilters: activityFilterProfiles.widget,
        webhookActivityFilters: activityFilterProfiles.webhook,
        ttsNotificationActivityFilters: activityFilterProfiles.tts,
        feedTimeDisplayMode: normalizeFeedTimeDisplayMode(feedTimeDisplayMode),
        youtubeAPI: Boolean(youtubeAPI),
        translationAPI: Boolean(translationAPI),
        bioLanguage: normalizeLanguageCode(bioLanguage),
        translationAPIType: normalizeTranslationApiType(translationAPIType),
        translationEndpointId: String(translationEndpointId || ''),
        translationAPIEndpoint:
            translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: translationAPIModel || DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: translationAPIPrompt || '',
        translationAPIReasoningEffort: translationAPIReasoningEffort || '',
        appFontFamily: normalizeAppFontFamily(appFontFamily),
        appCjkFontPack: normalizeAppCjkFontPack(appCjkFontPack),
        customFontFamily: customFontFamily || '',
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
