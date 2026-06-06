import { normalizeLanguageCode } from '@/localization/locales';
import { tauriClient } from '@/platform/tauri/client';
import configRepository from '@/repositories/configRepository';
import storageRepository from '@/repositories/storageRepository';
import {
    normalizeOverlayActivityFilterProfile,
    normalizeOverlayActivityFiltersWithDefinitions,
    parseOverlayActivityFilterProfile,
    type OverlayActivityTypeDefinition
} from '@/shared/constants/overlayActivityFilters';
import {
    normalizePreferenceKey,
    publishPreferenceChanged
} from '@/shared/events/preferenceEvents';
import {
    isValidTrustColor,
    normalizeTrustColors,
    TRUST_COLOR_DEFAULTS
} from '@/shared/utils/trustColors';
import {
    DEFAULT_PREFERENCES,
    normalizeDefaultLaunchMode,
    normalizeFeedTimeDisplayMode,
    parseOverlayActivityFiltersPreference,
    parseSharedFeedFilters,
    normalizeSharedFeedFilters,
    normalizeOverlayActivityFilters,
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    usePreferencesStore
} from '@/state/preferencesStore';
import {
    normalizeNavWidth,
    normalizeTableDensity,
    useShellStore
} from '@/state/shellStore';

import { POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY } from './changelogService';
import { refreshDiscordPresence } from './discordPresenceService';
import {
    configureRecentActionCooldown,
    readRecentActionCooldown
} from './recentActionService';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    applyThemeColor,
    applyThemeMode,
    applyZoomLevel,
    getCommunityThemeAppearanceThemeMode,
    isCommunityThemeAppearanceControlled,
    normalizeZoomLevel,
    resolveThemeColor,
    resolveThemeMode
} from './themeService';
import { applyTrustColorClasses } from './trustColorService';

const DEFAULT_NOTIFICATION_LAYOUT = 'notification-center';
const DEFAULT_TRANSLATION_ENDPOINT =
    'https://api.openai.com/v1/chat/completions';
const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';
const DEFAULT_TABLE_PAGE_SIZE = Number(DEFAULT_PREFERENCES.tablePageSize) || 20;
const DEFAULT_TABLE_PAGE_SIZES = Array.isArray(
    DEFAULT_PREFERENCES.tablePageSizes
)
    ? DEFAULT_PREFERENCES.tablePageSizes
    : [10, 15, 20, 25, 50, 100];
const DEFAULT_TABLE_LIMITS = DEFAULT_PREFERENCES.tableLimits as Record<
    string,
    any
>;
const DISCORD_BOOL_PREFERENCE_KEYS = new Set([
    'discordActive',
    'discordInstance',
    'discordHideInvite',
    'discordJoinButton',
    'discordHideImage',
    'discordShowPlatform',
    'discordWorldIntegration',
    'discordWorldNameAsDiscordStatus'
]);
const VRCHAT_RICH_PRESENCE_CONFIG_KEY = 'disableRichPresence';
const WRIST_OVERLAY_RUNTIME_CONFIG_KEYS = new Set([
    'appLanguage',
    'dtHour12',
    'wristOverlayStartMode',
    'wristOverlayButton',
    'wristOverlayHand',
    'wristOverlaySize',
    'wristOverlayHidePrivateWorlds',
    'wristOverlayDarkBackground',
    'wristOverlayShowDevices',
    'wristOverlayShowBatteryPercent'
]);
const LEGACY_OVERLAY_NOTIFICATION_KEYS = Object.freeze({
    xsNotifications: 'VRCX-0_xsNotifications',
    ovrtHudNotifications: 'VRCX-0_ovrtHudNotifications',
    ovrtWristNotifications: 'VRCX-0_ovrtWristNotifications',
    imageNotifications: 'VRCX-0_imageNotifications',
    notificationTimeout: 'VRCX-0_notificationTimeout',
    notificationOpacity: 'VRCX-0_notificationOpacity'
});

function setDocumentLanguage(language: any) {
    document.documentElement.setAttribute('lang', language);
}

function applyAccessibleStatusClass(enabled: any) {
    document.documentElement.classList.toggle(
        'accessible-status-indicators',
        Boolean(enabled)
    );
}

function applyTableDensityClass(density: any) {
    const normalized = normalizeTableDensity(density);
    document.documentElement.classList.remove('is-compact-table');
    if (normalized === 'compact') {
        document.documentElement.classList.add('is-compact-table');
    }
}

function applyDataTableStripedClass(enabled: any) {
    document.documentElement.classList.toggle(
        'is-striped-table',
        Boolean(enabled)
    );
}

function patchPreferences(patch: any) {
    usePreferencesStore.getState().patchPreferences(patch);
}

function patchPreferenceValue(key: any, value: any) {
    usePreferencesStore
        .getState()
        .setPreferenceValue(normalizePreferenceKey(key), value);
}

async function reloadWristOverlayRuntimeConfigIfNeeded(key: any) {
    const normalizedKey = normalizePreferenceKey(key);
    if (!WRIST_OVERLAY_RUNTIME_CONFIG_KEYS.has(normalizedKey)) {
        return;
    }
    await tauriClient.app.VrOverlayConfigReload().catch((error: any) => {
        console.warn('Failed to reload wrist overlay runtime config:', error);
    });
}

function normalizeBioLanguage(language: any) {
    return normalizeLanguageCode(language);
}

function normalizeStringList(value: any) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

async function getBoolConfigWithLegacy(key: string, defaultValue: boolean) {
    if ((await configRepository.getRawValue(key)) !== null) {
        return configRepository.getBool(key, defaultValue);
    }
    const legacyKey = getLegacyOverlayNotificationKey(key);
    if (legacyKey && (await configRepository.getRawValue(legacyKey)) !== null) {
        return configRepository.getBool(legacyKey, defaultValue);
    }
    return defaultValue;
}

async function getIntConfigWithLegacy(key: string, defaultValue: number) {
    if ((await configRepository.getRawValue(key)) !== null) {
        return configRepository.getInt(key, defaultValue);
    }
    const legacyKey = getLegacyOverlayNotificationKey(key);
    if (legacyKey && (await configRepository.getRawValue(legacyKey)) !== null) {
        return configRepository.getInt(legacyKey, defaultValue);
    }
    return defaultValue;
}

function getLegacyOverlayNotificationKey(key: string) {
    return LEGACY_OVERLAY_NOTIFICATION_KEYS[
        key as keyof typeof LEGACY_OVERLAY_NOTIFICATION_KEYS
    ];
}

function resolveTablePageSize(candidate: any, pageSizes: any) {
    const allowed = normalizeTablePageSizes(pageSizes);
    const fallbackPageSize = allowed[0] ?? DEFAULT_TABLE_PAGE_SIZE;
    const nearestPageSize = (value: any) =>
        allowed.reduce((previous: any, size: any) =>
            Math.abs(size - value) < Math.abs(previous - value)
                ? size
                : previous
        );
    const parsed = normalizeTablePageSize(candidate, fallbackPageSize);
    return allowed.includes(parsed) ? parsed : nearestPageSize(parsed);
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
        accessibleStatusIndicators,
        showNewDashboardButton,
        recentActionCooldownEnabled,
        recentActionCooldownMinutes,
        screenshotHelper,
        screenshotHelperModifyFilename,
        screenshotHelperCopyToClipboard,
        saveInstancePrints,
        cropInstancePrints,
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
        sharedFeedFilters,
        overlayActivityFilters,
        vrNotificationActivityFilters,
        feedTimeDisplayMode,
        youtubeAPI,
        translationAPI,
        bioLanguage,
        translationAPIType,
        translationAPIEndpoint,
        translationAPIModel,
        translationAPIPrompt,
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
        tauriClient.app
            .CurrentCulture()
            .catch(() => navigator.language || 'en-gb'),
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
        configRepository.getString(
            'sharedFeedFilters',
            JSON.stringify(DEFAULT_PREFERENCES.sharedFeedFilters)
        ),
        configRepository.getString('overlayActivityFilters', ''),
        configRepository.getString('vrNotificationActivityFilters', ''),
        configRepository.getString('feedTimeDisplayMode', 'relative'),
        configRepository.getBool('youtubeAPI', false),
        configRepository.getBool('translationAPI', false),
        configRepository.getString('bioLanguage', 'en'),
        configRepository.getString('translationAPIType', 'google'),
        configRepository.getString(
            'translationAPIEndpoint',
            DEFAULT_TRANSLATION_ENDPOINT
        ),
        configRepository.getString(
            'translationAPIModel',
            DEFAULT_TRANSLATION_MODEL
        ),
        configRepository.getString('translationAPIPrompt', ''),
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

    const snapshot: any = {
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
        saveInstanceStickers: Boolean(saveInstanceStickers),
        saveInstanceEmoji: Boolean(saveInstanceEmoji),
        userGeneratedContentPath: userGeneratedContentPath || '',
        showInstanceIdInLocation: Boolean(showInstanceIdInLocation),
        isAgeGatedInstancesVisible: Boolean(isAgeGatedInstancesVisible),
        hideNicknames: Boolean(hideNicknames),
        displayVRCPlusIconsAsAvatar: Boolean(displayVRCPlusIconsAsAvatar),
        weekStartsOn: [0, 1, 6].includes(Number(weekStartsOn))
            ? Number(weekStartsOn)
            : 1,
        hideUserNotes: Boolean(hideUserNotes),
        hideUserMemos: Boolean(hideUserMemos),
        hideUnfriends: Boolean(hideUnfriends),
        randomUserColours: Boolean(randomUserColours),
        notificationIconDot: Boolean(notificationIconDot),
        showPostUpdateChangelogToast: Boolean(showPostUpdateChangelogToast),
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
        wristOverlayEnabled: Boolean(wristOverlayEnabled),
        wristOverlayStartMode: wristOverlayStartMode || 'vrchatVrMode',
        wristOverlayButton: wristOverlayButton || 'grip',
        wristOverlayHand: wristOverlayHand || 'left',
        wristOverlaySize: wristOverlaySize || 'normal',
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
        sharedFeedFilters: parseSharedFeedFilters(sharedFeedFilters),
        overlayActivityFilters: parseOverlayActivityFiltersPreference(
            overlayActivityFilters,
            sharedFeedFilters
        ),
        vrNotificationActivityFilters: parseOverlayActivityFilterProfile(
            vrNotificationActivityFilters
        ),
        feedTimeDisplayMode: normalizeFeedTimeDisplayMode(feedTimeDisplayMode),
        youtubeAPI: Boolean(youtubeAPI),
        translationAPI: Boolean(translationAPI),
        bioLanguage: normalizeBioLanguage(bioLanguage),
        translationAPIType:
            translationAPIType === 'openai' ? 'openai' : 'google',
        translationAPIEndpoint:
            translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: translationAPIModel || DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: translationAPIPrompt || '',
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

export async function setAppLanguagePreference(language: any) {
    const nextLanguage = normalizeLanguageCode(language);
    useShellStore.getState().setLocale(nextLanguage);
    setDocumentLanguage(nextLanguage);
    await configRepository.setString('appLanguage', nextLanguage);
    const [fontFamily, cjkFontPack, customFontFamily] = await Promise.all([
        configRepository.getString('VRCX_fontFamily', APP_FONT_DEFAULT_KEY),
        configRepository.getString(
            'VRCX_cjkFontPack',
            APP_CJK_FONT_PACK_DEFAULT_KEY
        ),
        configRepository.getString('customFontFamily', '')
    ]);
    applyAppFontPreferences({
        fontFamily,
        customFontFamily,
        cjkFontPack,
        locale: nextLanguage
    });
    await reloadWristOverlayRuntimeConfigIfNeeded('appLanguage');
}

export async function setThemeModePreference(themeMode: any) {
    if (isCommunityThemeAppearanceControlled()) {
        return getCommunityThemeAppearanceThemeMode();
    }

    const nextThemeMode = resolveThemeMode(themeMode);
    await configRepository.setString('ThemeMode', nextThemeMode);
    if (nextThemeMode !== 'system' && nextThemeMode !== 'light') {
        await configRepository.setString('lastDarkTheme', nextThemeMode);
    }
    await applyThemeMode(nextThemeMode);
}

export async function setThemeColorPreference(themeColor: any) {
    const nextThemeColor = resolveThemeColor(themeColor);
    await configRepository.setString('VRCX_themeColor', nextThemeColor);
    applyThemeColor(nextThemeColor);
    return nextThemeColor;
}

export async function setZoomLevelPreference(value: any) {
    const zoomLevel = normalizeZoomLevel(value);
    await configRepository.setString('VRCX_ZoomLevel', String(zoomLevel));
    await applyZoomLevel(zoomLevel);
    return zoomLevel;
}

export async function setSidebarCollapsedPreference(collapsed: any) {
    const isCollapsed = Boolean(collapsed);
    useShellStore.getState().setSidebarOpen(!isCollapsed);
    await configRepository.setBool('navIsCollapsed', isCollapsed);
    patchPreferences({ navIsCollapsed: isCollapsed });
}

export async function setRightSidebarOpenPreference(open: any) {
    const isOpen = Boolean(open);
    useShellStore.getState().setRightSidebarOpen(isOpen);
    await configRepository.setBool('rightSidebarOpen', isOpen);
}

export async function setNavWidthPreference(value: any) {
    const width = normalizeNavWidth(value);
    useShellStore.getState().setNavWidth(width);
    await configRepository.setInt('VRCX_navPanelWidth', width);
    patchPreferences({ navPanelWidth: width });
    return width;
}

export async function setNotificationLayoutPreference(layout: any) {
    const nextLayout =
        layout === 'table' ? 'table' : DEFAULT_NOTIFICATION_LAYOUT;
    await configRepository.setString('notificationLayout', nextLayout);
    useShellStore.getState().setNotificationLayout(nextLayout);
    patchPreferences({ notificationLayout: nextLayout });
    publishPreferenceChanged('notificationLayout', nextLayout);
    return nextLayout;
}

export async function setDataTableStripedPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('dataTableStriped', enabled);
    applyDataTableStripedClass(enabled);
    patchPreferences({ dataTableStriped: enabled });
    publishPreferenceChanged('dataTableStriped', enabled);
}

export async function setTableDensityPreference(value: any) {
    const density = normalizeTableDensity(value);
    useShellStore.getState().setTableDensity(density);
    applyTableDensityClass(density);
    await configRepository.setString('VRCX_tableDensity', density);
    patchPreferences({ tableDensity: density });
}

export async function setAccessibleStatusIndicatorsPreference(value: any) {
    const nextValue = Boolean(value);
    applyAccessibleStatusClass(nextValue);
    await configRepository.setBool(
        'VRCX_accessibleStatusIndicators',
        nextValue
    );
    patchPreferences({ accessibleStatusIndicators: nextValue });
}

export async function setShowNewDashboardButtonPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_showNewDashboardButton', enabled);
    patchPreferences({ showNewDashboardButton: enabled });
    publishPreferenceChanged('VRCX_showNewDashboardButton', enabled);
}

export async function setRecentActionCooldownEnabledPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('recentActionCooldownEnabled', enabled);
    configureRecentActionCooldown({ enabled });
    patchPreferences({ recentActionCooldownEnabled: enabled });
    publishPreferenceChanged('recentActionCooldownEnabled', enabled);
}

export async function setRecentActionCooldownMinutesPreference(value: any) {
    const parsed = Number.parseInt(value, 10);
    const minutes = Number.isNaN(parsed)
        ? 60
        : Math.min(1440, Math.max(1, parsed));
    await configRepository.setInt('recentActionCooldownMinutes', minutes);
    configureRecentActionCooldown({
        ...readRecentActionCooldown(),
        minutes
    });
    patchPreferences({ recentActionCooldownMinutes: minutes });
    publishPreferenceChanged('recentActionCooldownMinutes', minutes);
    return minutes;
}

export async function setScreenshotHelperPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_screenshotHelper', enabled);
    patchPreferences({ screenshotHelper: enabled });
}

export async function setScreenshotHelperModifyFilenamePreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool(
        'VRCX_screenshotHelperModifyFilename',
        enabled
    );
    patchPreferences({ screenshotHelperModifyFilename: enabled });
}

export async function setScreenshotHelperCopyToClipboardPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool(
        'VRCX_screenshotHelperCopyToClipboard',
        enabled
    );
    patchPreferences({ screenshotHelperCopyToClipboard: enabled });
}

export async function setSaveInstancePrintsPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_saveInstancePrints', enabled);
    patchPreferences({ saveInstancePrints: enabled });
}

export async function setCropInstancePrintsPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_cropInstancePrints', enabled);
    patchPreferences({ cropInstancePrints: enabled });
}

export async function setSaveInstanceStickersPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_saveInstanceStickers', enabled);
    patchPreferences({ saveInstanceStickers: enabled });
}

export async function setSaveInstanceEmojiPreference(value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_saveInstanceEmoji', enabled);
    patchPreferences({ saveInstanceEmoji: enabled });
}

export async function setUserGeneratedContentPathPreference(value: any) {
    const nextPath = typeof value === 'string' ? value : '';
    await configRepository.setString('userGeneratedContentPath', nextPath);
    patchPreferences({ userGeneratedContentPath: nextPath });
    return nextPath;
}

export async function setStartAtWindowsStartupPreference(value: any) {
    const enabled = Boolean(value);
    const previousEnabled = Boolean(
        await configRepository.getBool('StartAtWindowsStartup', false)
    );
    await tauriClient.app.SetStartup(enabled);
    try {
        await configRepository.setBool('StartAtWindowsStartup', enabled);
    } catch (error) {
        await tauriClient.app
            .SetStartup(previousEnabled)
            .catch((rollbackError: any) => {
                console.warn(
                    'Failed to roll back Windows startup setting:',
                    rollbackError
                );
            });
        throw error;
    }
    patchPreferences({ isStartAtWindowsStartup: enabled });
    publishPreferenceChanged('StartAtWindowsStartup', enabled);
}

export async function setStartAsMinimizedPreference(value: any) {
    const enabled = Boolean(value);
    await storageRepository.setString(
        'VRCX_StartAsMinimizedState',
        String(enabled)
    );
    patchPreferences({ isStartAsMinimizedState: enabled });
    publishPreferenceChanged('VRCX_StartAsMinimizedState', enabled);
}

export async function setCloseToTrayPreference(value: any) {
    const enabled = Boolean(value);
    await storageRepository.setString('VRCX_CloseToTray', String(enabled));
    patchPreferences({ isCloseToTray: enabled });
    publishPreferenceChanged('VRCX_CloseToTray', enabled);
}

export async function setBoolConfigPreference(key: any, value: any) {
    const enabled = Boolean(value);
    await configRepository.setBool(key, enabled);
    const normalizedKey = normalizePreferenceKey(key);
    if (normalizedKey === 'notificationIconDot') {
        useShellStore.getState().setNotificationIconDot(enabled);
    } else if (normalizedKey === 'displayVRCPlusIconsAsAvatar') {
        useShellStore.getState().setAppearancePreferences({
            displayVRCPlusIconsAsAvatar: enabled
        });
    } else if (normalizedKey === 'hideNicknames') {
        useShellStore.getState().setAppearancePreferences({
            hideNicknames: enabled
        });
    } else if (normalizedKey === 'dtHour12') {
        const state = useShellStore.getState();
        state.setDatePreferences({
            dateCulture: state.dateCulture,
            dateIsoFormat: state.dateIsoFormat,
            dateHour12: enabled
        });
    } else if (normalizedKey === 'dtIsoFormat') {
        const state = useShellStore.getState();
        state.setDatePreferences({
            dateCulture: state.dateCulture,
            dateIsoFormat: enabled,
            dateHour12: state.dateHour12
        });
    }
    patchPreferenceValue(key, enabled);
    publishPreferenceChanged(key, enabled);
    await reloadWristOverlayRuntimeConfigIfNeeded(key);
}

export async function setStringConfigPreference(key: any, value: any) {
    const nextValue = String(value ?? '');
    await configRepository.setString(key, nextValue);
    patchPreferenceValue(key, nextValue);
    publishPreferenceChanged(key, nextValue);
    await reloadWristOverlayRuntimeConfigIfNeeded(key);
}

export async function setIntConfigPreference(
    key: any,
    value: any,
    {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
        fallback = 0
    }: any = {}
) {
    const parsed = Number.parseInt(value, 10);
    const nextValue = Number.isNaN(parsed)
        ? fallback
        : Math.min(max, Math.max(min, parsed));
    await configRepository.setInt(key, nextValue);
    patchPreferenceValue(key, nextValue);
    publishPreferenceChanged(key, nextValue);
    return nextValue;
}

export async function setProxyServerPreference(
    value: any,
    { restart = true }: any = {}
) {
    const nextProxyServer = String(value ?? '').trim();
    await storageRepository.setString('VRCX_ProxyServer', nextProxyServer);
    patchPreferences({ proxyServer: nextProxyServer });
    publishPreferenceChanged('VRCX_ProxyServer', nextProxyServer);
    if (restart) {
        await tauriClient.app.RestartApplication();
    }
    return nextProxyServer;
}

export async function setTablePageSizesPreference(value: any) {
    const tablePageSizes = normalizeTablePageSizes(value);
    const currentTablePageSize = normalizeTablePageSize(
        usePreferencesStore.getState().preferencesHydrated
            ? usePreferencesStore.getState().tablePageSize
            : await configRepository.getInt(
                  'VRCX_tablePageSize',
                  DEFAULT_TABLE_PAGE_SIZE
              )
    );
    const nextTablePageSize = resolveTablePageSize(
        currentTablePageSize,
        tablePageSizes
    );
    await Promise.all([
        configRepository.setArray('VRCX_tablePageSizes', tablePageSizes),
        nextTablePageSize === currentTablePageSize
            ? Promise.resolve()
            : configRepository.setInt('VRCX_tablePageSize', nextTablePageSize)
    ]);
    patchPreferences({
        tablePageSize: nextTablePageSize,
        tablePageSizes
    });
    publishPreferenceChanged('VRCX_tablePageSizes', tablePageSizes);
    if (nextTablePageSize !== currentTablePageSize) {
        publishPreferenceChanged('VRCX_tablePageSize', nextTablePageSize);
    }
    return tablePageSizes;
}

export async function setTablePageSizePreference(value: any) {
    const tablePageSize = normalizeTablePageSize(value);
    await configRepository.setInt('VRCX_tablePageSize', tablePageSize);
    patchPreferences({ tablePageSize });
    publishPreferenceChanged('VRCX_tablePageSize', tablePageSize);
    return tablePageSize;
}

export async function getTablePageSizePreference(
    fallback: any = DEFAULT_TABLE_PAGE_SIZE
) {
    const preferenceState = usePreferencesStore.getState();
    if (preferenceState.preferencesHydrated) {
        return preferenceState.tablePageSize;
    }
    return configRepository.getInt('VRCX_tablePageSize', fallback);
}

export async function getTablePageSizesPreference(
    fallback: any = DEFAULT_TABLE_PAGE_SIZES
) {
    const preferenceState = usePreferencesStore.getState();
    if (preferenceState.preferencesHydrated) {
        return preferenceState.tablePageSizes;
    }
    return configRepository.getArray('VRCX_tablePageSizes', fallback);
}

export async function setTableLimitsPreference(value: any) {
    const tableLimits = normalizeTableLimits(value);
    await Promise.all([
        configRepository.setInt('maxTableSize_v2', tableLimits.maxTableSize),
        configRepository.setInt('searchLimit', tableLimits.searchLimit)
    ]);
    patchPreferences({ tableLimits });
    publishPreferenceChanged('maxTableSize_v2', tableLimits.maxTableSize);
    publishPreferenceChanged('searchLimit', tableLimits.searchLimit);
    return tableLimits;
}

export async function loadTrustColorPreference() {
    const trustColor = normalizeTrustColors(
        await configRepository
            .getObject('VRCX_trustColor', TRUST_COLOR_DEFAULTS)
            .catch(() => TRUST_COLOR_DEFAULTS)
    );
    applyTrustColorClasses(trustColor);
    patchPreferences({ trustColor });
    publishPreferenceChanged('VRCX_trustColor', trustColor);
    return trustColor;
}

export async function setTrustColorPreference(key: string, value: any) {
    if (
        !Object.prototype.hasOwnProperty.call(TRUST_COLOR_DEFAULTS, key) ||
        !isValidTrustColor(value)
    ) {
        throw new Error('Invalid color. Use #RRGGBB.');
    }
    const trustColor = normalizeTrustColors({
        ...usePreferencesStore.getState().trustColor,
        [key]: value
    });
    await configRepository.setObject('VRCX_trustColor', trustColor);
    applyTrustColorClasses(trustColor);
    patchPreferences({ trustColor });
    publishPreferenceChanged('VRCX_trustColor', trustColor);
    return trustColor;
}

export async function resetTrustColorsPreference() {
    const trustColor = normalizeTrustColors(TRUST_COLOR_DEFAULTS);
    await configRepository.setObject('VRCX_trustColor', trustColor);
    applyTrustColorClasses(trustColor);
    patchPreferences({ trustColor });
    publishPreferenceChanged('VRCX_trustColor', trustColor);
    return trustColor;
}

export async function setSharedFeedFiltersPreference(value: any) {
    const sharedFeedFilters = normalizeSharedFeedFilters(value);
    await configRepository.setString(
        'sharedFeedFilters',
        JSON.stringify(sharedFeedFilters)
    );
    patchPreferences({ sharedFeedFilters });
    publishPreferenceChanged('sharedFeedFilters', sharedFeedFilters);
    return sharedFeedFilters;
}

async function loadOverlayActivityTypeDefinitionsForSave() {
    return tauriClient.app
        .OverlayActivityDefinitionsGet()
        .catch((error: any) => {
            console.warn(
                'Failed to load overlay activity definitions for save:',
                error
            );
            return [] as OverlayActivityTypeDefinition[];
        });
}

export async function setOverlayActivityFiltersPreference(
    value: any,
    definitions?: OverlayActivityTypeDefinition[]
) {
    const activityDefinitions =
        definitions ?? (await loadOverlayActivityTypeDefinitionsForSave());
    const overlayActivityFilters = activityDefinitions.length
        ? normalizeOverlayActivityFiltersWithDefinitions(
              value,
              activityDefinitions
          )
        : normalizeOverlayActivityFilters(value);
    await configRepository.setString(
        'overlayActivityFilters',
        JSON.stringify(overlayActivityFilters)
    );
    await tauriClient.app.OverlayActivityFiltersReload();
    patchPreferences({ overlayActivityFilters });
    publishPreferenceChanged('overlayActivityFilters', overlayActivityFilters);
    return overlayActivityFilters;
}

export async function setVrNotificationActivityFiltersPreference(value: any) {
    const vrNotificationActivityFilters =
        normalizeOverlayActivityFilterProfile(value);
    await configRepository.setString(
        'vrNotificationActivityFilters',
        JSON.stringify(vrNotificationActivityFilters)
    );
    patchPreferences({ vrNotificationActivityFilters });
    publishPreferenceChanged(
        'vrNotificationActivityFilters',
        vrNotificationActivityFilters
    );
    return vrNotificationActivityFilters;
}

export async function setWristOverlayEnabledPreference(value: any) {
    const snapshot = await tauriClient.app.VrOverlayEnabledSet(Boolean(value));
    const wristOverlayEnabled = Boolean(snapshot.enabled);
    patchPreferences({ wristOverlayEnabled });
    publishPreferenceChanged('wristOverlayEnabled', wristOverlayEnabled);
    return wristOverlayEnabled;
}

export async function setLocalFavoriteFriendsGroupsPreference(value: any) {
    const localFavoriteFriendsGroups = normalizeStringList(value);
    await configRepository.setArray(
        'localFavoriteFriendsGroups',
        localFavoriteFriendsGroups
    );
    patchPreferences({ localFavoriteFriendsGroups });
    publishPreferenceChanged(
        'localFavoriteFriendsGroups',
        localFavoriteFriendsGroups
    );
    return localFavoriteFriendsGroups;
}

export async function setYoutubeApiEnabledPreference(value: any) {
    const youtubeAPI = Boolean(value);
    await configRepository.setBool('youtubeAPI', youtubeAPI);
    patchPreferences({ youtubeAPI });
    publishPreferenceChanged('youtubeAPI', youtubeAPI);
    return youtubeAPI;
}

export async function setYoutubeApiKeyPreference(value: any) {
    const youtubeAPIKey = String(value ?? '').trim();
    await configRepository.setString('youtubeAPIKey', youtubeAPIKey);
    publishPreferenceChanged('youtubeAPIKey', youtubeAPIKey);
    return youtubeAPIKey;
}

export async function setTranslationApiEnabledPreference(value: any) {
    const translationAPI = Boolean(value);
    await configRepository.setBool('translationAPI', translationAPI);
    patchPreferences({ translationAPI });
    publishPreferenceChanged('translationAPI', translationAPI);
    return translationAPI;
}

export async function setTranslationApiConfigPreference({
    bioLanguage,
    translationAPIType,
    translationAPIKey,
    translationAPIEndpoint,
    translationAPIModel,
    translationAPIPrompt
}: any) {
    const nextBioLanguage = normalizeBioLanguage(bioLanguage);
    const nextType = translationAPIType === 'openai' ? 'openai' : 'google';
    const nextKey = String(translationAPIKey ?? '').trim();
    const nextEndpoint =
        String(translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT).trim() ||
        DEFAULT_TRANSLATION_ENDPOINT;
    const nextModel =
        String(translationAPIModel || DEFAULT_TRANSLATION_MODEL).trim() ||
        DEFAULT_TRANSLATION_MODEL;
    const nextPrompt = String(translationAPIPrompt ?? '');
    await configRepository.setMany([
        ['bioLanguage', nextBioLanguage],
        ['translationAPIType', nextType],
        ['translationAPIKey', nextKey],
        ['translationAPIEndpoint', nextEndpoint],
        ['translationAPIModel', nextModel],
        ['translationAPIPrompt', nextPrompt]
    ]);
    patchPreferences({
        bioLanguage: nextBioLanguage,
        translationAPIType: nextType,
        translationAPIEndpoint: nextEndpoint,
        translationAPIModel: nextModel,
        translationAPIPrompt: nextPrompt
    });
    publishPreferenceChanged('bioLanguage', nextBioLanguage);
    publishPreferenceChanged('translationAPIType', nextType);
    publishPreferenceChanged('translationAPIKey', nextKey);
    publishPreferenceChanged('translationAPIEndpoint', nextEndpoint);
    publishPreferenceChanged('translationAPIModel', nextModel);
    publishPreferenceChanged('translationAPIPrompt', nextPrompt);
    return {
        bioLanguage: nextBioLanguage,
        translationAPIType: nextType,
        translationAPIKey: nextKey,
        translationAPIEndpoint: nextEndpoint,
        translationAPIModel: nextModel,
        translationAPIPrompt: nextPrompt
    };
}

export async function setDiscordBoolPreference(key: string, value: any) {
    if (!DISCORD_BOOL_PREFERENCE_KEYS.has(key)) {
        throw new Error(`Unsupported Discord preference: ${key}`);
    }
    const enabled = Boolean(value);
    await configRepository.setBool(key, enabled);
    if (key === 'discordActive' && enabled) {
        await disableVrchatRichPresence().catch((error: any) => {
            console.warn('Failed to disable VRChat Rich Presence:', error);
        });
    }
    patchPreferences({ [key]: enabled });
    publishPreferenceChanged(key, enabled);
    refreshDiscordPresence({ force: true }).catch((error: any) => {
        console.warn(
            'Failed to refresh Discord Rich Presence after setting change:',
            error
        );
    });
    return enabled;
}

async function disableVrchatRichPresence() {
    const rawConfig = await tauriClient.app.ReadConfigFile();
    const config = rawConfig ? JSON.parse(String(rawConfig)) : {};
    if (config?.[VRCHAT_RICH_PRESENCE_CONFIG_KEY] === true) {
        return;
    }

    await tauriClient.app.WriteConfigFile(
        JSON.stringify(
            {
                ...config,
                [VRCHAT_RICH_PRESENCE_CONFIG_KEY]: true
            },
            null,
            2
        )
    );
}
