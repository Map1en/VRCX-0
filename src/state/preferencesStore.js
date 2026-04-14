import { create } from 'zustand';

import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters.js';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT,
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_MIN,
    TABLE_MAX_SIZE_MAX,
    TABLE_MAX_SIZE_MIN
} from '@/shared/constants/settings.js';
import { TRUST_COLOR_DEFAULTS, normalizeTrustColors } from '@/lib/trustColors.js';
import { normalizeNavWidth, normalizeTableDensity } from './shellStore.js';

const DEFAULT_TABLE_PAGE_SIZES = Object.freeze([10, 15, 20, 25, 50, 100]);
const DEFAULT_TRANSLATION_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';

function normalizeBool(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.trim().toLowerCase() === 'true';
    }
    return Boolean(value);
}

function normalizeBoundedInt(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeTablePageSizes(value) {
    const source = Array.isArray(value) ? value : DEFAULT_TABLE_PAGE_SIZES;
    const nextSizes = source
        .map((entry) => Number.parseInt(entry, 10))
        .filter((entry) => Number.isFinite(entry) && entry > 0 && entry <= 1000);
    const normalized = Array.from(new Set(nextSizes)).sort((left, right) => left - right);
    return normalized.length ? normalized : [...DEFAULT_TABLE_PAGE_SIZES];
}

export function normalizeTableLimits(value = {}) {
    return {
        maxTableSize: normalizeBoundedInt(value.maxTableSize, {
            min: TABLE_MAX_SIZE_MIN,
            max: TABLE_MAX_SIZE_MAX,
            fallback: DEFAULT_MAX_TABLE_SIZE
        }),
        searchLimit: normalizeBoundedInt(value.searchLimit, {
            min: SEARCH_LIMIT_MIN,
            max: SEARCH_LIMIT_MAX,
            fallback: DEFAULT_SEARCH_LIMIT
        })
    };
}

export function normalizeSharedFeedFilters(value) {
    return {
        noty: {
            ...sharedFeedFiltersDefaults.noty,
            ...(value?.noty && typeof value.noty === 'object' ? value.noty : {})
        },
        wrist: {
            ...sharedFeedFiltersDefaults.wrist,
            ...(value?.wrist && typeof value.wrist === 'object' ? value.wrist : {})
        }
    };
}

export function parseSharedFeedFilters(value) {
    if (!value) {
        return normalizeSharedFeedFilters();
    }
    if (typeof value === 'object') {
        return normalizeSharedFeedFilters(value);
    }
    try {
        return normalizeSharedFeedFilters(JSON.parse(value));
    } catch {
        return normalizeSharedFeedFilters();
    }
}

export const DEFAULT_PREFERENCES = Object.freeze({
    notificationLayout: 'notification-center',
    dataTableStriped: false,
    tableDensity: 'standard',
    showPointerOnHover: false,
    accessibleStatusIndicators: false,
    showNewDashboardButton: true,
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
    hideNicknames: false,
    displayVRCPlusIconsAsAvatar: true,
    sortFavorites: true,
    weekStartsOn: 1,
    dtIsoFormat: false,
    dtHour12: false,
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
    disableGpuAcceleration: false,
    navPanelWidth: 240,
    navIsCollapsed: false,
    proxyServer: '',
    tablePageSizes: DEFAULT_TABLE_PAGE_SIZES,
    tableLimits: {
        maxTableSize: DEFAULT_MAX_TABLE_SIZE,
        searchLimit: DEFAULT_SEARCH_LIMIT
    },
    localFavoriteFriendsGroups: [],
    sharedFeedFilters: {
        noty: { ...sharedFeedFiltersDefaults.noty },
        wrist: { ...sharedFeedFiltersDefaults.wrist }
    },
    trustColor: { ...TRUST_COLOR_DEFAULTS },
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
    discordWorldNameAsDiscordStatus: false
});

export function normalizePreferenceSnapshot(snapshot = {}) {
    const next = {
        ...DEFAULT_PREFERENCES,
        ...snapshot
    };

    return {
        notificationLayout: next.notificationLayout === 'table' ? 'table' : 'notification-center',
        dataTableStriped: normalizeBool(next.dataTableStriped),
        tableDensity: normalizeTableDensity(next.tableDensity),
        showPointerOnHover: normalizeBool(next.showPointerOnHover),
        accessibleStatusIndicators: normalizeBool(next.accessibleStatusIndicators),
        showNewDashboardButton: normalizeBool(next.showNewDashboardButton),
        recentActionCooldownEnabled: normalizeBool(next.recentActionCooldownEnabled),
        recentActionCooldownMinutes: normalizeBoundedInt(next.recentActionCooldownMinutes, { min: 1, max: 1440, fallback: 60 }),
        screenshotHelper: normalizeBool(next.screenshotHelper),
        screenshotHelperModifyFilename: normalizeBool(next.screenshotHelperModifyFilename),
        screenshotHelperCopyToClipboard: normalizeBool(next.screenshotHelperCopyToClipboard),
        saveInstancePrints: normalizeBool(next.saveInstancePrints),
        cropInstancePrints: normalizeBool(next.cropInstancePrints),
        saveInstanceStickers: normalizeBool(next.saveInstanceStickers),
        saveInstanceEmoji: normalizeBool(next.saveInstanceEmoji),
        userGeneratedContentPath: String(next.userGeneratedContentPath || ''),
        showInstanceIdInLocation: normalizeBool(next.showInstanceIdInLocation),
        isAgeGatedInstancesVisible: normalizeBool(next.isAgeGatedInstancesVisible),
        hideNicknames: normalizeBool(next.hideNicknames),
        displayVRCPlusIconsAsAvatar: normalizeBool(next.displayVRCPlusIconsAsAvatar),
        sortFavorites: normalizeBool(next.sortFavorites),
        weekStartsOn: [0, 1, 6].includes(Number(next.weekStartsOn)) ? Number(next.weekStartsOn) : 1,
        dtIsoFormat: normalizeBool(next.dtIsoFormat),
        dtHour12: normalizeBool(next.dtHour12),
        hideUserNotes: normalizeBool(next.hideUserNotes),
        hideUserMemos: normalizeBool(next.hideUserMemos),
        hideUnfriends: normalizeBool(next.hideUnfriends),
        randomUserColours: normalizeBool(next.randomUserColours),
        notificationIconDot: normalizeBool(next.notificationIconDot),
        desktopToast: next.desktopToast || 'Never',
        afkDesktopToast: normalizeBool(next.afkDesktopToast),
        notificationTTS: next.notificationTTS || 'Never',
        notificationTTSNickName: normalizeBool(next.notificationTTSNickName),
        notificationTTSVoice: String(next.notificationTTSVoice ?? '0'),
        relaunchVRChatAfterCrash: normalizeBool(next.relaunchVRChatAfterCrash),
        vrcQuitFix: normalizeBool(next.vrcQuitFix),
        autoSweepVRChatCache: normalizeBool(next.autoSweepVRChatCache),
        showConfirmationOnSwitchAvatar: normalizeBool(next.showConfirmationOnSwitchAvatar),
        gameLogDisabled: normalizeBool(next.gameLogDisabled),
        avatarAutoCleanup: next.avatarAutoCleanup || 'Off',
        enableAppLauncher: normalizeBool(next.enableAppLauncher),
        enableAppLauncherAutoClose: normalizeBool(next.enableAppLauncherAutoClose),
        enableAppLauncherRunProcessOnce: normalizeBool(next.enableAppLauncherRunProcessOnce),
        udonExceptionLogging: normalizeBool(next.udonExceptionLogging),
        logResourceLoad: normalizeBool(next.logResourceLoad),
        logEmptyAvatars: normalizeBool(next.logEmptyAvatars),
        autoLoginDelayEnabled: normalizeBool(next.autoLoginDelayEnabled),
        autoLoginDelaySeconds: normalizeBoundedInt(next.autoLoginDelaySeconds, { min: 0, max: 10, fallback: 0 }),
        isStartAtWindowsStartup: normalizeBool(next.isStartAtWindowsStartup),
        isStartAsMinimizedState: normalizeBool(next.isStartAsMinimizedState),
        isCloseToTray: normalizeBool(next.isCloseToTray),
        disableGpuAcceleration: normalizeBool(next.disableGpuAcceleration),
        navPanelWidth: normalizeNavWidth(next.navPanelWidth),
        navIsCollapsed: normalizeBool(next.navIsCollapsed),
        proxyServer: String(next.proxyServer || ''),
        tablePageSizes: normalizeTablePageSizes(next.tablePageSizes),
        tableLimits: normalizeTableLimits(next.tableLimits),
        localFavoriteFriendsGroups: Array.isArray(next.localFavoriteFriendsGroups)
            ? next.localFavoriteFriendsGroups.filter(Boolean)
            : [],
        sharedFeedFilters: parseSharedFeedFilters(next.sharedFeedFilters),
        trustColor: normalizeTrustColors(next.trustColor),
        youtubeAPI: normalizeBool(next.youtubeAPI),
        translationAPI: normalizeBool(next.translationAPI),
        bioLanguage: next.bioLanguage || 'en',
        translationAPIType: next.translationAPIType === 'openai' ? 'openai' : 'google',
        translationAPIEndpoint: next.translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: next.translationAPIModel || DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: String(next.translationAPIPrompt || ''),
        discordActive: normalizeBool(next.discordActive),
        discordInstance: normalizeBool(next.discordInstance),
        discordHideInvite: normalizeBool(next.discordHideInvite),
        discordJoinButton: normalizeBool(next.discordJoinButton),
        discordHideImage: normalizeBool(next.discordHideImage),
        discordShowPlatform: normalizeBool(next.discordShowPlatform),
        discordWorldIntegration: normalizeBool(next.discordWorldIntegration),
        discordWorldNameAsDiscordStatus: normalizeBool(next.discordWorldNameAsDiscordStatus)
    };
}

export const usePreferencesStore = create((set) => ({
    ...normalizePreferenceSnapshot(DEFAULT_PREFERENCES),
    preferencesHydrated: false,
    hydratePreferences(snapshot) {
        set({
            ...normalizePreferenceSnapshot(snapshot),
            preferencesHydrated: true
        });
    },
    patchPreferences(patch) {
        set((state) => normalizePreferenceSnapshot({
            ...state,
            ...patch
        }));
    },
    setPreferenceValue(key, value) {
        set((state) => normalizePreferenceSnapshot({
            ...state,
            [key]: value
        }));
    }
}));
