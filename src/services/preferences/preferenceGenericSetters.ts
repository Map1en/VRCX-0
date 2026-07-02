import { normalizeLanguageCode } from '@/localization/locales';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import storageRepository from '@/repositories/storageRepository';
import { MINUTES_PER_DAY } from '@/shared/constants/time';
import {
    isValidTrustColor,
    normalizeTrustColors,
    TRUST_COLOR_DEFAULTS
} from '@/shared/utils/trustColors';
import {
    normalizeFeedHiddenUsers,
    normalizeSharedFeedFilters
} from '@/state/preferencesStore';
import type { TrustColorKey } from '@/state/preferencesStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import {
    normalizeNavWidth,
    normalizeTableDensity,
    useShellStore
} from '@/state/shellStore';

import {
    configureRecentActionCooldown,
    readRecentActionCooldown
} from '../recentActionService';
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
} from '../themeService';
import { applyTrustColorClasses } from '../trustColorService';
import {
    DEFAULT_NOTIFICATION_LAYOUT,
    DEFAULT_TABLE_PAGE_SIZE,
    DEFAULT_TABLE_PAGE_SIZES
} from './preferencesConstants';
import {
    appLanguageChanged,
    applyAccessibleStatusClass,
    applyDataTableStripedClass,
    applyTableDensityClass,
    normalizePreferenceKey,
    normalizeStringList,
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    patchPreferences,
    patchPreferenceValue,
    publishPreferenceChanged,
    reloadWristOverlayRuntimeConfigIfNeeded,
    resolveTablePageSize,
    setDocumentLanguage
} from './preferencesCore';
import type {
    BoolConfigPreferenceKey,
    IntConfigPreferenceKey,
    IntConfigPreferenceOptions,
    ProxyServerPreferenceOptions,
    StringConfigPreferenceKey
} from './preferencesTypes';

export async function setAppLanguagePreference(language: unknown) {
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
    await appLanguageChanged(nextLanguage);
}

export async function setThemeModePreference(themeMode: unknown) {
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

export async function setThemeColorPreference(themeColor: unknown) {
    const nextThemeColor = resolveThemeColor(themeColor);
    await configRepository.setString('VRCX_themeColor', nextThemeColor);
    applyThemeColor(nextThemeColor);
    return nextThemeColor;
}

export async function setZoomLevelPreference(value: string | number) {
    const zoomLevel = normalizeZoomLevel(value);
    await configRepository.setString('VRCX_ZoomLevel', String(zoomLevel));
    await applyZoomLevel(zoomLevel);
    return zoomLevel;
}

export async function setNavbarCollapsedPreference(collapsed: boolean) {
    const isCollapsed = collapsed;
    useShellStore.getState().setSidebarOpen(!isCollapsed);
    await configRepository.setBool('navIsCollapsed', isCollapsed);
    patchPreferences({ navIsCollapsed: isCollapsed });
}

export async function setRightSidebarOpenPreference(open: boolean) {
    const isOpen = open;
    useShellStore.getState().setRightSidebarOpen(isOpen);
    await configRepository.setBool('rightSidebarOpen', isOpen);
}

export async function setNavWidthPreference(value: string | number) {
    const width = normalizeNavWidth(value);
    useShellStore.getState().setNavWidth(width);
    await configRepository.setInt('VRCX_navPanelWidth', width);
    patchPreferences({ navPanelWidth: width });
    return width;
}

export async function setNotificationLayoutPreference(layout: unknown) {
    const nextLayout =
        layout === 'table' ? 'table' : DEFAULT_NOTIFICATION_LAYOUT;
    await configRepository.setString('notificationLayout', nextLayout);
    useShellStore.getState().setNotificationLayout(nextLayout);
    patchPreferences({ notificationLayout: nextLayout });
    publishPreferenceChanged('notificationLayout', nextLayout);
    return nextLayout;
}

export async function setDataTableStripedPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('dataTableStriped', enabled);
    applyDataTableStripedClass(enabled);
    patchPreferences({ dataTableStriped: enabled });
    publishPreferenceChanged('dataTableStriped', enabled);
}

export async function setTableDensityPreference(value: unknown) {
    const density = normalizeTableDensity(value);
    useShellStore.getState().setTableDensity(density);
    applyTableDensityClass(density);
    await configRepository.setString('VRCX_tableDensity', density);
    patchPreferences({ tableDensity: density });
}

export async function setAccessibleStatusIndicatorsPreference(value: boolean) {
    applyAccessibleStatusClass(value);
    await configRepository.setBool('VRCX_accessibleStatusIndicators', value);
    patchPreferences({ accessibleStatusIndicators: value });
}

export async function setShowNewDashboardButtonPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('VRCX_showNewDashboardButton', enabled);
    patchPreferences({ showNewDashboardButton: enabled });
    publishPreferenceChanged('VRCX_showNewDashboardButton', enabled);
}

export async function setRecentActionCooldownEnabledPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('recentActionCooldownEnabled', enabled);
    configureRecentActionCooldown({ enabled });
    patchPreferences({ recentActionCooldownEnabled: enabled });
    publishPreferenceChanged('recentActionCooldownEnabled', enabled);
}

export async function setRecentActionCooldownMinutesPreference(
    value: string | number
) {
    const parsed = Number.parseInt(String(value), 10);
    const minutes = Number.isNaN(parsed)
        ? 60
        : Math.min(MINUTES_PER_DAY, Math.max(1, parsed));
    await configRepository.setInt('recentActionCooldownMinutes', minutes);
    configureRecentActionCooldown({
        ...readRecentActionCooldown(),
        minutes
    });
    patchPreferences({ recentActionCooldownMinutes: minutes });
    publishPreferenceChanged('recentActionCooldownMinutes', minutes);
    return minutes;
}

export async function setScreenshotHelperPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('VRCX_screenshotHelper', enabled);
    patchPreferences({ screenshotHelper: enabled });
}

export async function setScreenshotHelperModifyFilenamePreference(
    value: boolean
) {
    const enabled = value;
    await configRepository.setBool(
        'VRCX_screenshotHelperModifyFilename',
        enabled
    );
    patchPreferences({ screenshotHelperModifyFilename: enabled });
}

export async function setScreenshotHelperCopyToClipboardPreference(
    value: boolean
) {
    const enabled = value;
    await configRepository.setBool(
        'VRCX_screenshotHelperCopyToClipboard',
        enabled
    );
    patchPreferences({ screenshotHelperCopyToClipboard: enabled });
}

export async function setSaveInstancePrintsPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('VRCX_saveInstancePrints', enabled);
    patchPreferences({ saveInstancePrints: enabled });
}

export async function setCropInstancePrintsPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('VRCX_cropInstancePrints', enabled);
    patchPreferences({ cropInstancePrints: enabled });
}

export async function setSaveInstanceStickersPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('VRCX_saveInstanceStickers', enabled);
    patchPreferences({ saveInstanceStickers: enabled });
}

export async function setSaveInstanceEmojiPreference(value: boolean) {
    const enabled = value;
    await configRepository.setBool('VRCX_saveInstanceEmoji', enabled);
    patchPreferences({ saveInstanceEmoji: enabled });
}

export async function setUserGeneratedContentPathPreference(value: string) {
    const nextPath = value;
    await configRepository.setString('userGeneratedContentPath', nextPath);
    patchPreferences({ userGeneratedContentPath: nextPath });
    return nextPath;
}

export async function setStartAtWindowsStartupPreference(value: boolean) {
    const enabled = value;
    const previousEnabled = Boolean(
        await configRepository.getBool('StartAtWindowsStartup', false)
    );
    await commands.appSetStartup(enabled);
    try {
        await configRepository.setBool('StartAtWindowsStartup', enabled);
    } catch (error) {
        await commands
            .appSetStartup(previousEnabled)
            .catch((rollbackError: unknown) => {
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

export async function setStartAsMinimizedPreference(value: boolean) {
    const enabled = value;
    await storageRepository.setString(
        'VRCX_StartAsMinimizedState',
        String(enabled)
    );
    patchPreferences({ isStartAsMinimizedState: enabled });
    publishPreferenceChanged('VRCX_StartAsMinimizedState', enabled);
}

export async function setCloseToTrayPreference(value: boolean) {
    const enabled = value;
    await storageRepository.setString('VRCX_CloseToTray', String(enabled));
    patchPreferences({ isCloseToTray: enabled });
    publishPreferenceChanged('VRCX_CloseToTray', enabled);
}

export async function setBoolConfigPreference(
    key: BoolConfigPreferenceKey,
    value: boolean
) {
    const enabled = value;
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

export async function setStringConfigPreference(
    key: StringConfigPreferenceKey,
    value: string
) {
    await configRepository.setString(key, value);
    patchPreferenceValue(key, value);
    publishPreferenceChanged(key, value);
    await reloadWristOverlayRuntimeConfigIfNeeded(key);
}

export async function setIntConfigPreference(
    key: IntConfigPreferenceKey,
    value: string | number,
    {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
        fallback = 0
    }: IntConfigPreferenceOptions = {}
) {
    const parsed = Number.parseInt(String(value), 10);
    const nextValue = Number.isNaN(parsed)
        ? fallback
        : Math.min(max, Math.max(min, parsed));
    await configRepository.setInt(key, nextValue);
    patchPreferenceValue(key, nextValue);
    publishPreferenceChanged(key, nextValue);
    return nextValue;
}

export async function setProxyServerPreference(
    value: string,
    { restart = true }: ProxyServerPreferenceOptions = {}
) {
    const nextProxyServer = String(value ?? '').trim();
    await storageRepository.setString('VRCX_ProxyServer', nextProxyServer);
    patchPreferences({ proxyServer: nextProxyServer });
    publishPreferenceChanged('VRCX_ProxyServer', nextProxyServer);
    if (restart) {
        await commands.appRestartApplication();
    }
    return nextProxyServer;
}

export async function setTablePageSizesPreference(value: unknown) {
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

export async function setTablePageSizePreference(value: string | number) {
    const tablePageSize = normalizeTablePageSize(value);
    await configRepository.setInt('VRCX_tablePageSize', tablePageSize);
    patchPreferences({ tablePageSize });
    publishPreferenceChanged('VRCX_tablePageSize', tablePageSize);
    return tablePageSize;
}

export async function getTablePageSizePreference(
    fallback: number = DEFAULT_TABLE_PAGE_SIZE
) {
    const preferenceState = usePreferencesStore.getState();
    if (preferenceState.preferencesHydrated) {
        return preferenceState.tablePageSize;
    }
    return configRepository.getInt('VRCX_tablePageSize', fallback);
}

export async function getTablePageSizesPreference(
    fallback: number[] = DEFAULT_TABLE_PAGE_SIZES
) {
    const preferenceState = usePreferencesStore.getState();
    if (preferenceState.preferencesHydrated) {
        return preferenceState.tablePageSizes;
    }
    return configRepository.getArray('VRCX_tablePageSizes', fallback);
}

export async function setTableLimitsPreference(value: unknown) {
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

export async function setTrustColorPreference(
    key: TrustColorKey,
    value: unknown
) {
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

export async function setSharedFeedFiltersPreference(value: unknown) {
    const sharedFeedFilters = normalizeSharedFeedFilters(value);
    await configRepository.setString(
        'sharedFeedFilters',
        JSON.stringify(sharedFeedFilters)
    );
    patchPreferences({ sharedFeedFilters });
    publishPreferenceChanged('sharedFeedFilters', sharedFeedFilters);
    return sharedFeedFilters;
}

export async function setLocalFavoriteFriendsGroupsPreference(value: unknown) {
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

export async function setFeedHiddenUsersPreference(value: unknown) {
    const feedHiddenUsers = normalizeFeedHiddenUsers(value);
    await configRepository.setString(
        'feedHiddenUsers',
        JSON.stringify(feedHiddenUsers)
    );
    patchPreferences({ feedHiddenUsers });
    publishPreferenceChanged('feedHiddenUsers', feedHiddenUsers);
    return feedHiddenUsers;
}

export async function addFeedHiddenUserPreference(userId: unknown) {
    const current = normalizeFeedHiddenUsers(
        usePreferencesStore.getState().feedHiddenUsers
    );
    const [normalizedUserId] = normalizeFeedHiddenUsers([userId]);
    if (!normalizedUserId || current.includes(normalizedUserId)) {
        return current;
    }
    return setFeedHiddenUsersPreference([...current, normalizedUserId]);
}

export async function removeFeedHiddenUserPreference(userId: unknown) {
    const [normalizedUserId] = normalizeFeedHiddenUsers([userId]);
    const current = normalizeFeedHiddenUsers(
        usePreferencesStore.getState().feedHiddenUsers
    );
    const next = normalizedUserId
        ? current.filter((id) => id !== normalizedUserId)
        : current;
    if (next.length === current.length) {
        return current;
    }
    return setFeedHiddenUsersPreference(next);
}
