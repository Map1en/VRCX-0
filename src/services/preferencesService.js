import {
    normalizePreferenceKey,
    publishPreferenceChanged
} from '@/lib/preferenceEvents.js';
import {
    applyTrustColorClasses,
    isValidTrustColor,
    normalizeTrustColors,
    TRUST_COLOR_DEFAULTS
} from '@/lib/trustColors.js';
import { languageCodes } from '@/localization/locales.js';
import { backend } from '@/platform/index.js';
import { configRepository, storageRepository } from '@/repositories/index.js';
import {
    DEFAULT_PREFERENCES,
    parseSharedFeedFilters,
    normalizeSharedFeedFilters,
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    usePreferencesStore
} from '@/state/preferencesStore.js';
import {
    normalizeNavWidth,
    normalizeTableDensity,
    useShellStore
} from '@/state/shellStore.js';

import { refreshDiscordPresence } from './discordPresenceService.js';
import {
    configureRecentActionCooldown,
    readRecentActionCooldown
} from './recentActionService.js';
import {
    applyThemeMode,
    applyZoomLevel,
    normalizeZoomLevel,
    resolveThemeMode
} from './themeService.js';

const DEFAULT_NOTIFICATION_LAYOUT = 'notification-center';
const DEFAULT_TRANSLATION_ENDPOINT =
    'https://api.openai.com/v1/chat/completions';
const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';
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

function setDocumentLanguage(language) {
    document.documentElement.setAttribute('lang', language);
}

function applyPointerHoverClass(enabled) {
    document.documentElement.classList.toggle(
        'force-pointer-on-hover',
        Boolean(enabled)
    );
}

function applyAccessibleStatusClass(enabled) {
    document.documentElement.classList.toggle(
        'accessible-status-indicators',
        Boolean(enabled)
    );
}

function applyTableDensityClass(density) {
    const normalized = normalizeTableDensity(density);
    document.documentElement.classList.remove('is-compact-table');
    if (normalized === 'compact') {
        document.documentElement.classList.add('is-compact-table');
    }
}

function applyDataTableStripedClass(enabled) {
    document.documentElement.classList.toggle(
        'is-striped-table',
        Boolean(enabled)
    );
}

function patchPreferences(patch) {
    usePreferencesStore.getState().patchPreferences(patch);
}

function patchPreferenceValue(key, value) {
    usePreferencesStore
        .getState()
        .setPreferenceValue(normalizePreferenceKey(key), value);
}

function normalizeBioLanguage(language) {
    return languageCodes.includes(language) ? language : 'en';
}

function normalizeStringList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function resolveTablePageSize(candidate, pageSizes) {
    const allowed = normalizeTablePageSizes(pageSizes);
    const fallbackPageSize = allowed[0] ?? DEFAULT_PREFERENCES.tablePageSize;
    const nearestPageSize = (value) =>
        allowed.reduce((previous, size) =>
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
        notificationLayout,
        dataTableStriped,
        tableDensity,
        compactTableMode,
        showPointerOnHover,
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
        sortFavorites,
        weekStartsOn,
        hideUserNotes,
        hideUserMemos,
        hideUnfriends,
        randomUserColours,
        notificationIconDot,
        desktopToast,
        afkDesktopToast,
        notificationTTS,
        notificationTTSNickName,
        notificationTTSVoice,
        relaunchVRChatAfterCrash,
        vrcQuitFix,
        autoSweepVRChatCache,
        showConfirmationOnSwitchAvatar,
        gameLogDisabled,
        avatarAutoCleanup,
        enableAppLauncher,
        enableAppLauncherAutoClose,
        enableAppLauncherRunProcessOnce,
        udonExceptionLogging,
        logResourceLoad,
        logEmptyAvatars,
        autoLoginDelayEnabled,
        autoLoginDelaySeconds,
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
        configRepository.getString(
            'notificationLayout',
            DEFAULT_NOTIFICATION_LAYOUT
        ),
        configRepository.getBool('dataTableStriped', false),
        configRepository.getString('tableDensity', null),
        configRepository.getBool('compactTableMode', false),
        configRepository.getBool('showPointerOnHover', false),
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
        configRepository.getBool('sortFavorites', true),
        configRepository.getInt('weekStartsOn', 1),
        configRepository.getBool('hideUserNotes', false),
        configRepository.getBool('hideUserMemos', false),
        configRepository.getBool('hideUnfriends', false),
        configRepository.getBool('randomUserColours', false),
        configRepository.getBool('notificationIconDot', true),
        configRepository.getString('desktopToast', 'Never'),
        configRepository.getBool('afkDesktopToast', false),
        configRepository.getString('notificationTTS', 'Never'),
        configRepository.getBool('notificationTTSNickName', false),
        configRepository.getString('notificationTTSVoice', '0'),
        configRepository.getBool('relaunchVRChatAfterCrash', false),
        configRepository.getBool('vrcQuitFix', true),
        configRepository.getBool('autoSweepVRChatCache', false),
        configRepository.getBool('showConfirmationOnSwitchAvatar', true),
        configRepository.getBool('gameLogDisabled', false),
        configRepository.getString('avatarAutoCleanup', 'Off'),
        configRepository.getBool('enableAppLauncher', true),
        configRepository.getBool('enableAppLauncherAutoClose', true),
        configRepository.getBool('enableAppLauncherRunProcessOnce', true),
        configRepository.getBool('udonExceptionLogging', false),
        configRepository.getBool('logResourceLoad', false),
        configRepository.getBool('logEmptyAvatars', false),
        configRepository.getBool('autoLoginDelayEnabled', false),
        configRepository.getInt('autoLoginDelaySeconds', 0),
        configRepository.getBool('StartAtWindowsStartup', false),
        storageRepository.getString('VRCX_StartAsMinimizedState', 'false'),
        storageRepository.getString('VRCX_CloseToTray', 'false'),
        configRepository.getBool('dtIsoFormat', false),
        configRepository.getBool('dtHour12', false),
        configRepository.getObject('VRCX_trustColor', null),
        backend.app.CurrentCulture().catch(() => navigator.language || 'en-gb'),
        storageRepository.getString('VRCX_ProxyServer', ''),
        configRepository.getInt(
            'VRCX_tablePageSize',
            DEFAULT_PREFERENCES.tablePageSize
        ),
        configRepository.getArray(
            'VRCX_tablePageSizes',
            DEFAULT_PREFERENCES.tablePageSizes
        ),
        configRepository.getInt(
            'maxTableSize_v2',
            DEFAULT_PREFERENCES.tableLimits.maxTableSize
        ),
        configRepository.getInt(
            'searchLimit',
            DEFAULT_PREFERENCES.tableLimits.searchLimit
        ),
        configRepository.getArray('localFavoriteFriendsGroups', []),
        configRepository.getString(
            'sharedFeedFilters',
            JSON.stringify(DEFAULT_PREFERENCES.sharedFeedFilters)
        ),
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
        dateCulture: currentCulture,
        dateIsoFormat: dtIsoFormat,
        dateHour12: dtHour12
    });
    const normalizedRecentActionCooldownMinutes = Number.isFinite(
        recentActionCooldownMinutes
    )
        ? recentActionCooldownMinutes
        : 60;
    applyTableDensityClass(resolvedTableDensity);
    applyDataTableStripedClass(dataTableStriped);
    applyPointerHoverClass(showPointerOnHover);
    applyAccessibleStatusClass(accessibleStatusIndicators);
    applyTrustColorClasses(trustColor);
    configureRecentActionCooldown({
        enabled: recentActionCooldownEnabled,
        minutes: normalizedRecentActionCooldownMinutes
    });
    setDocumentLanguage(useShellStore.getState().locale || 'en');
    if (!tableDensity || tableDensity !== resolvedTableDensity) {
        await configRepository.setString(
            'VRCX_tableDensity',
            resolvedTableDensity
        );
    }

    const snapshot = {
        notificationLayout: notificationLayout || DEFAULT_NOTIFICATION_LAYOUT,
        dataTableStriped: Boolean(dataTableStriped),
        tableDensity: resolvedTableDensity,
        showPointerOnHover: Boolean(showPointerOnHover),
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
        sortFavorites: Boolean(sortFavorites),
        weekStartsOn: [0, 1, 6].includes(weekStartsOn) ? weekStartsOn : 1,
        hideUserNotes: Boolean(hideUserNotes),
        hideUserMemos: Boolean(hideUserMemos),
        hideUnfriends: Boolean(hideUnfriends),
        randomUserColours: Boolean(randomUserColours),
        notificationIconDot: Boolean(notificationIconDot),
        desktopToast: desktopToast || 'Never',
        afkDesktopToast: Boolean(afkDesktopToast),
        notificationTTS: notificationTTS || 'Never',
        notificationTTSNickName: Boolean(notificationTTSNickName),
        notificationTTSVoice: notificationTTSVoice || '0',
        relaunchVRChatAfterCrash: Boolean(relaunchVRChatAfterCrash),
        vrcQuitFix: Boolean(vrcQuitFix),
        autoSweepVRChatCache: Boolean(autoSweepVRChatCache),
        showConfirmationOnSwitchAvatar: Boolean(showConfirmationOnSwitchAvatar),
        gameLogDisabled: Boolean(gameLogDisabled),
        avatarAutoCleanup: avatarAutoCleanup || 'Off',
        enableAppLauncher: Boolean(enableAppLauncher),
        enableAppLauncherAutoClose: Boolean(enableAppLauncherAutoClose),
        enableAppLauncherRunProcessOnce: Boolean(
            enableAppLauncherRunProcessOnce
        ),
        udonExceptionLogging: Boolean(udonExceptionLogging),
        logResourceLoad: Boolean(logResourceLoad),
        logEmptyAvatars: Boolean(logEmptyAvatars),
        autoLoginDelayEnabled: Boolean(autoLoginDelayEnabled),
        autoLoginDelaySeconds: Number.isFinite(autoLoginDelaySeconds)
            ? autoLoginDelaySeconds
            : 0,
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

export async function setAppLanguagePreference(language) {
    const nextLanguage = language || 'en';
    useShellStore.getState().setLocale(nextLanguage);
    setDocumentLanguage(nextLanguage);
    await configRepository.setString('appLanguage', nextLanguage);
}

export async function setThemeModePreference(themeMode) {
    const nextThemeMode = resolveThemeMode(themeMode);
    await configRepository.setString('ThemeMode', nextThemeMode);
    if (nextThemeMode !== 'system' && nextThemeMode !== 'light') {
        await configRepository.setString('lastDarkTheme', nextThemeMode);
    }
    await applyThemeMode(nextThemeMode);
}

export async function setZoomLevelPreference(value) {
    const zoomLevel = normalizeZoomLevel(value);
    await configRepository.setString('VRCX_ZoomLevel', String(zoomLevel));
    await applyZoomLevel(zoomLevel);
    return zoomLevel;
}

export async function setSidebarCollapsedPreference(collapsed) {
    const isCollapsed = Boolean(collapsed);
    useShellStore.getState().setSidebarOpen(!isCollapsed);
    await configRepository.setBool('navIsCollapsed', isCollapsed);
    patchPreferences({ navIsCollapsed: isCollapsed });
}

export async function setNavWidthPreference(value) {
    const width = normalizeNavWidth(value);
    useShellStore.getState().setNavWidth(width);
    await configRepository.setInt('VRCX_navPanelWidth', width);
    patchPreferences({ navPanelWidth: width });
    return width;
}

export async function setNotificationLayoutPreference(layout) {
    const nextLayout =
        layout === 'table' ? 'table' : DEFAULT_NOTIFICATION_LAYOUT;
    await configRepository.setString('notificationLayout', nextLayout);
    useShellStore.getState().setNotificationLayout(nextLayout);
    patchPreferences({ notificationLayout: nextLayout });
    publishPreferenceChanged('notificationLayout', nextLayout);
    return nextLayout;
}

export async function setDataTableStripedPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('dataTableStriped', enabled);
    applyDataTableStripedClass(enabled);
    patchPreferences({ dataTableStriped: enabled });
    publishPreferenceChanged('dataTableStriped', enabled);
}

export async function setTableDensityPreference(value) {
    const density = normalizeTableDensity(value);
    useShellStore.getState().setTableDensity(density);
    applyTableDensityClass(density);
    await configRepository.setString('VRCX_tableDensity', density);
    patchPreferences({ tableDensity: density });
}

export async function setPointerOnHoverPreference(value) {
    const nextValue = Boolean(value);
    applyPointerHoverClass(nextValue);
    await configRepository.setBool('VRCX_showPointerOnHover', nextValue);
    patchPreferences({ showPointerOnHover: nextValue });
}

export async function setAccessibleStatusIndicatorsPreference(value) {
    const nextValue = Boolean(value);
    applyAccessibleStatusClass(nextValue);
    await configRepository.setBool(
        'VRCX_accessibleStatusIndicators',
        nextValue
    );
    patchPreferences({ accessibleStatusIndicators: nextValue });
}

export async function setShowNewDashboardButtonPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_showNewDashboardButton', enabled);
    patchPreferences({ showNewDashboardButton: enabled });
    publishPreferenceChanged('VRCX_showNewDashboardButton', enabled);
}

export async function setRecentActionCooldownEnabledPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('recentActionCooldownEnabled', enabled);
    configureRecentActionCooldown({ enabled });
    patchPreferences({ recentActionCooldownEnabled: enabled });
    publishPreferenceChanged('recentActionCooldownEnabled', enabled);
}

export async function setRecentActionCooldownMinutesPreference(value) {
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

export async function setScreenshotHelperPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_screenshotHelper', enabled);
    patchPreferences({ screenshotHelper: enabled });
}

export async function setScreenshotHelperModifyFilenamePreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool(
        'VRCX_screenshotHelperModifyFilename',
        enabled
    );
    patchPreferences({ screenshotHelperModifyFilename: enabled });
}

export async function setScreenshotHelperCopyToClipboardPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool(
        'VRCX_screenshotHelperCopyToClipboard',
        enabled
    );
    patchPreferences({ screenshotHelperCopyToClipboard: enabled });
}

export async function setSaveInstancePrintsPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_saveInstancePrints', enabled);
    patchPreferences({ saveInstancePrints: enabled });
}

export async function setCropInstancePrintsPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_cropInstancePrints', enabled);
    patchPreferences({ cropInstancePrints: enabled });
}

export async function setSaveInstanceStickersPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_saveInstanceStickers', enabled);
    patchPreferences({ saveInstanceStickers: enabled });
}

export async function setSaveInstanceEmojiPreference(value) {
    const enabled = Boolean(value);
    await configRepository.setBool('VRCX_saveInstanceEmoji', enabled);
    patchPreferences({ saveInstanceEmoji: enabled });
}

export async function setUserGeneratedContentPathPreference(value) {
    const nextPath = typeof value === 'string' ? value : '';
    await configRepository.setString('userGeneratedContentPath', nextPath);
    patchPreferences({ userGeneratedContentPath: nextPath });
    return nextPath;
}

export async function setStartAtWindowsStartupPreference(value) {
    const enabled = Boolean(value);
    const previousEnabled = Boolean(
        await configRepository.getBool('StartAtWindowsStartup', false)
    );
    await backend.app.SetStartup(enabled);
    try {
        await configRepository.setBool('StartAtWindowsStartup', enabled);
    } catch (error) {
        await backend.app.SetStartup(previousEnabled).catch((rollbackError) => {
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

export async function setStartAsMinimizedPreference(value) {
    const enabled = Boolean(value);
    await storageRepository.setString(
        'VRCX_StartAsMinimizedState',
        String(enabled)
    );
    patchPreferences({ isStartAsMinimizedState: enabled });
    publishPreferenceChanged('VRCX_StartAsMinimizedState', enabled);
}

export async function setCloseToTrayPreference(value) {
    const enabled = Boolean(value);
    await storageRepository.setString('VRCX_CloseToTray', String(enabled));
    patchPreferences({ isCloseToTray: enabled });
    publishPreferenceChanged('VRCX_CloseToTray', enabled);
}

export async function setBoolConfigPreference(key, value) {
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
}

export async function setStringConfigPreference(key, value) {
    const nextValue = String(value ?? '');
    await configRepository.setString(key, nextValue);
    patchPreferenceValue(key, nextValue);
    publishPreferenceChanged(key, nextValue);
}

export async function setIntConfigPreference(
    key,
    value,
    {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
        fallback = 0
    } = {}
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

export async function setAppLauncherPreference({
    enabled,
    autoClose,
    runProcessOnce
}) {
    const nextEnabled = Boolean(enabled);
    const nextAutoClose = Boolean(autoClose);
    const nextRunProcessOnce = Boolean(runProcessOnce);
    const [previousEnabled, previousAutoClose, previousRunProcessOnce] =
        await Promise.all([
            configRepository.getBool('enableAppLauncher', true),
            configRepository.getBool('enableAppLauncherAutoClose', true),
            configRepository.getBool('enableAppLauncherRunProcessOnce', true)
        ]);
    await backend.app.SetAppLauncherSettings(
        nextEnabled,
        nextAutoClose,
        nextRunProcessOnce
    );
    try {
        await configRepository.setMany([
            ['enableAppLauncher', nextEnabled],
            ['enableAppLauncherAutoClose', nextAutoClose],
            ['enableAppLauncherRunProcessOnce', nextRunProcessOnce]
        ]);
    } catch (error) {
        await backend.app
            .SetAppLauncherSettings(
                Boolean(previousEnabled),
                Boolean(previousAutoClose),
                Boolean(previousRunProcessOnce)
            )
            .catch((rollbackError) => {
                console.warn(
                    'Failed to roll back app launcher settings:',
                    rollbackError
                );
            });
        throw error;
    }
    patchPreferences({
        enableAppLauncher: nextEnabled,
        enableAppLauncherAutoClose: nextAutoClose,
        enableAppLauncherRunProcessOnce: nextRunProcessOnce
    });
    publishPreferenceChanged('enableAppLauncher', nextEnabled);
    publishPreferenceChanged('enableAppLauncherAutoClose', nextAutoClose);
    publishPreferenceChanged(
        'enableAppLauncherRunProcessOnce',
        nextRunProcessOnce
    );
}

export async function setProxyServerPreference(value, { restart = true } = {}) {
    const nextProxyServer = String(value ?? '').trim();
    await storageRepository.setString('VRCX_ProxyServer', nextProxyServer);
    patchPreferences({ proxyServer: nextProxyServer });
    publishPreferenceChanged('VRCX_ProxyServer', nextProxyServer);
    if (restart) {
        await backend.app.RestartApplication(false);
    }
    return nextProxyServer;
}

export async function setTablePageSizesPreference(value) {
    const tablePageSizes = normalizeTablePageSizes(value);
    const currentTablePageSize = normalizeTablePageSize(
        usePreferencesStore.getState().preferencesHydrated
            ? usePreferencesStore.getState().tablePageSize
            : await configRepository.getInt(
                  'VRCX_tablePageSize',
                  DEFAULT_PREFERENCES.tablePageSize
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

export async function setTablePageSizePreference(value) {
    const tablePageSize = normalizeTablePageSize(value);
    await configRepository.setInt('VRCX_tablePageSize', tablePageSize);
    patchPreferences({ tablePageSize });
    publishPreferenceChanged('VRCX_tablePageSize', tablePageSize);
    return tablePageSize;
}

export async function getTablePageSizePreference(
    fallback = DEFAULT_PREFERENCES.tablePageSize
) {
    const preferenceState = usePreferencesStore.getState();
    if (preferenceState.preferencesHydrated) {
        return preferenceState.tablePageSize;
    }
    return configRepository.getInt('VRCX_tablePageSize', fallback);
}

export async function getTablePageSizesPreference(
    fallback = DEFAULT_PREFERENCES.tablePageSizes
) {
    const preferenceState = usePreferencesStore.getState();
    if (preferenceState.preferencesHydrated) {
        return preferenceState.tablePageSizes;
    }
    return configRepository.getArray('VRCX_tablePageSizes', fallback);
}

export async function setTableLimitsPreference(value) {
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

export async function setTrustColorPreference(key, value) {
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

export async function setSharedFeedFiltersPreference(value) {
    const sharedFeedFilters = normalizeSharedFeedFilters(value);
    await configRepository.setString(
        'sharedFeedFilters',
        JSON.stringify(sharedFeedFilters)
    );
    patchPreferences({ sharedFeedFilters });
    publishPreferenceChanged('sharedFeedFilters', sharedFeedFilters);
    return sharedFeedFilters;
}

export async function setLocalFavoriteFriendsGroupsPreference(value) {
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

export async function setYoutubeApiEnabledPreference(value) {
    const youtubeAPI = Boolean(value);
    await configRepository.setBool('youtubeAPI', youtubeAPI);
    patchPreferences({ youtubeAPI });
    publishPreferenceChanged('youtubeAPI', youtubeAPI);
    return youtubeAPI;
}

export async function setYoutubeApiKeyPreference(value) {
    const youtubeAPIKey = String(value ?? '').trim();
    await configRepository.setString('youtubeAPIKey', youtubeAPIKey);
    publishPreferenceChanged('youtubeAPIKey', youtubeAPIKey);
    return youtubeAPIKey;
}

export async function setTranslationApiEnabledPreference(value) {
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
}) {
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

export async function setDiscordBoolPreference(key, value) {
    if (!DISCORD_BOOL_PREFERENCE_KEYS.has(key)) {
        throw new Error(`Unsupported Discord preference: ${key}`);
    }
    const enabled = Boolean(value);
    await configRepository.setBool(key, enabled);
    patchPreferences({ [key]: enabled });
    publishPreferenceChanged(key, enabled);
    void refreshDiscordPresence({ force: true }).catch((error) => {
        console.warn(
            'Failed to refresh Discord Rich Presence after setting change:',
            error
        );
    });
    return enabled;
}
