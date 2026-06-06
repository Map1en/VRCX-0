import { create } from 'zustand';

import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters';
import {
    DEFAULT_OVERLAY_ACTIVITY_FILTERS,
    DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
    migrateLegacySharedFeedWristFilters,
    normalizeOverlayActivityFilters,
    parseOverlayActivityFilterProfile,
    parseOverlayActivityFilters
} from '@/shared/constants/overlayActivityFilters';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT,
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_MIN,
    TABLE_MAX_SIZE_MAX,
    TABLE_MAX_SIZE_MIN
} from '@/shared/constants/settings';
import {
    TRUST_COLOR_DEFAULTS,
    normalizeTrustColors
} from '@/shared/utils/trustColors';

import { normalizeNavWidth, normalizeTableDensity } from './shellStore';

export const DEFAULT_TABLE_PAGE_SIZE = 20;
export const DEFAULT_TABLE_PAGE_SIZES = Object.freeze([
    10, 15, 20, 25, 50, 100
]);
const DEFAULT_TRANSLATION_ENDPOINT =
    'https://api.openai.com/v1/chat/completions';
const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';

export type NotificationLayoutPreference = 'notification-center' | 'table';
export type TableDensityPreference = 'standard' | 'compact';
export type FeedTimeDisplayModePreference = 'exact' | 'relative';
export type TranslationApiType = 'google' | 'openai';
export type DefaultLaunchModePreference = 'vr' | 'desktop';
export type WristOverlayHandPreference = 'left' | 'right' | 'both';
export type WristOverlaySizePreference = 'compact' | 'normal' | 'large';
export type WristOverlayStartModePreference = 'steamvr' | 'vrchatVrMode';
export type WristOverlayButtonPreference = 'grip' | 'menu';
export type TrustColorKey = keyof typeof TRUST_COLOR_DEFAULTS;
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

export interface TableLimitsPreference {
    maxTableSize: number;
    searchLimit: number;
}

export interface SharedFeedFiltersPreference {
    noty: Record<string, unknown>;
}

export { normalizeOverlayActivityFilters, parseOverlayActivityFilters };

function hasPersistedOverlayActivityFilters(value: unknown): boolean {
    if (!value) {
        return false;
    }
    if (typeof value === 'string') {
        try {
            return hasPersistedOverlayActivityFilters(JSON.parse(value));
        } catch {
            return false;
        }
    }
    const source = asRecord(value);
    const wrist = asRecord(source.wrist);
    return Boolean(wrist.types || wrist.categories);
}

export function parseOverlayActivityFiltersPreference(
    value?: unknown,
    legacySharedFeedFilters?: unknown
) {
    if (!hasPersistedOverlayActivityFilters(value)) {
        return migrateLegacySharedFeedWristFilters(legacySharedFeedFilters);
    }
    return parseOverlayActivityFilters(value);
}

type BoundedIntOptions = {
    min?: number;
    max?: number;
    fallback?: number;
};
type TableLimits = {
    maxTableSize?: unknown;
    searchLimit?: unknown;
};
type SharedFeedFilterSnapshot = {
    noty?: unknown;
};
type PreferenceInputSnapshot = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}

function normalizeBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.trim().toLowerCase() === 'true';
    }
    return Boolean(value);
}

function normalizeBoundedInt(
    value: unknown,
    {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
        fallback = 0
    }: BoundedIntOptions = {}
): number {
    const parsed = Number.parseInt(value as string, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeDefaultLaunchMode(
    value: unknown
): DefaultLaunchModePreference {
    return value === 'desktop' ? 'desktop' : 'vr';
}

export function normalizeFeedTimeDisplayMode(
    value: unknown
): FeedTimeDisplayModePreference {
    return value === 'exact' ? 'exact' : 'relative';
}

export function normalizeWristOverlayHand(
    value: unknown
): WristOverlayHandPreference {
    return value === 'right' || value === 'both' ? value : 'left';
}

export function normalizeWristOverlaySize(
    value: unknown
): WristOverlaySizePreference {
    return value === 'compact' || value === 'large' ? value : 'normal';
}

export function normalizeWristOverlayStartMode(
    value: unknown
): WristOverlayStartModePreference {
    return value === 'steamvr' ? 'steamvr' : 'vrchatVrMode';
}

export function normalizeWristOverlayButton(
    value: unknown
): WristOverlayButtonPreference {
    return value === 'menu' ? 'menu' : 'grip';
}

export function normalizeTablePageSizes(value: unknown): number[] {
    const source = Array.isArray(value) ? value : DEFAULT_TABLE_PAGE_SIZES;
    const nextSizes = source
        .map((entry: any) => Number.parseInt(entry as string, 10))
        .filter(
            (entry: any) => Number.isFinite(entry) && entry > 0 && entry <= 1000
        );
    const normalized = Array.from(new Set(nextSizes)).sort(
        (left: any, right: any) => left - right
    );
    return normalized.length ? normalized : [...DEFAULT_TABLE_PAGE_SIZES];
}

export function normalizeTablePageSize(
    value: unknown,
    fallback: any = DEFAULT_TABLE_PAGE_SIZE
): number {
    return normalizeBoundedInt(value, {
        min: 1,
        max: 1000,
        fallback
    });
}

export function normalizeTableLimits(value: unknown = {}): {
    maxTableSize: number;
    searchLimit: number;
} {
    const limits = asRecord(value) as TableLimits;
    return {
        maxTableSize: normalizeBoundedInt(limits.maxTableSize, {
            min: TABLE_MAX_SIZE_MIN,
            max: TABLE_MAX_SIZE_MAX,
            fallback: DEFAULT_MAX_TABLE_SIZE
        }),
        searchLimit: normalizeBoundedInt(limits.searchLimit, {
            min: SEARCH_LIMIT_MIN,
            max: SEARCH_LIMIT_MAX,
            fallback: DEFAULT_SEARCH_LIMIT
        })
    };
}

export function normalizeSharedFeedFilters(
    value: unknown = {}
): SharedFeedFiltersPreference {
    const filters = asRecord(value) as SharedFeedFilterSnapshot;
    const noty = asRecord(filters.noty);
    return {
        noty: {
            ...sharedFeedFiltersDefaults.noty,
            ...noty
        }
    };
}

export function parseSharedFeedFilters(value?: unknown) {
    if (!value) {
        return normalizeSharedFeedFilters();
    }
    if (typeof value === 'object') {
        return normalizeSharedFeedFilters(value);
    }
    try {
        return normalizeSharedFeedFilters(JSON.parse(String(value)));
    } catch {
        return normalizeSharedFeedFilters();
    }
}

export const DEFAULT_PREFERENCES: PreferenceInputSnapshot = Object.freeze({
    notificationLayout: 'notification-center',
    dataTableStriped: false,
    tableDensity: 'standard',
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
    weekStartsOn: 1,
    dtIsoFormat: false,
    dtHour12: false,
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
    navPanelWidth: 240,
    navIsCollapsed: false,
    proxyServer: '',
    tablePageSize: DEFAULT_TABLE_PAGE_SIZE,
    tablePageSizes: DEFAULT_TABLE_PAGE_SIZES,
    tableLimits: {
        maxTableSize: DEFAULT_MAX_TABLE_SIZE,
        searchLimit: DEFAULT_SEARCH_LIMIT
    },
    localFavoriteFriendsGroups: [],
    sharedFeedFilters: {
        noty: { ...sharedFeedFiltersDefaults.noty }
    },
    overlayActivityFilters: DEFAULT_OVERLAY_ACTIVITY_FILTERS,
    vrNotificationActivityFilters: DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
    feedTimeDisplayMode: 'relative',
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

export function normalizePreferenceSnapshot(
    snapshot: PreferenceInputSnapshot = {}
) {
    const hasOverlayActivityFiltersInput = Object.prototype.hasOwnProperty.call(
        snapshot,
        'overlayActivityFilters'
    );
    const next: any = {
        ...DEFAULT_PREFERENCES,
        ...snapshot
    };

    return {
        notificationLayout:
            next.notificationLayout === 'table'
                ? 'table'
                : 'notification-center',
        dataTableStriped: normalizeBool(next.dataTableStriped),
        tableDensity: normalizeTableDensity(next.tableDensity),
        accessibleStatusIndicators: normalizeBool(
            next.accessibleStatusIndicators
        ),
        showNewDashboardButton: normalizeBool(next.showNewDashboardButton),
        recentActionCooldownEnabled: normalizeBool(
            next.recentActionCooldownEnabled
        ),
        recentActionCooldownMinutes: normalizeBoundedInt(
            next.recentActionCooldownMinutes,
            { min: 1, max: 1440, fallback: 60 }
        ),
        screenshotHelper: normalizeBool(next.screenshotHelper),
        screenshotHelperModifyFilename: normalizeBool(
            next.screenshotHelperModifyFilename
        ),
        screenshotHelperCopyToClipboard: normalizeBool(
            next.screenshotHelperCopyToClipboard
        ),
        saveInstancePrints: normalizeBool(next.saveInstancePrints),
        cropInstancePrints: normalizeBool(next.cropInstancePrints),
        saveInstanceStickers: normalizeBool(next.saveInstanceStickers),
        saveInstanceEmoji: normalizeBool(next.saveInstanceEmoji),
        userGeneratedContentPath: String(next.userGeneratedContentPath || ''),
        showInstanceIdInLocation: normalizeBool(next.showInstanceIdInLocation),
        isAgeGatedInstancesVisible: normalizeBool(
            next.isAgeGatedInstancesVisible
        ),
        hideNicknames: normalizeBool(next.hideNicknames),
        displayVRCPlusIconsAsAvatar: normalizeBool(
            next.displayVRCPlusIconsAsAvatar
        ),
        weekStartsOn: [0, 1, 6].includes(Number(next.weekStartsOn))
            ? Number(next.weekStartsOn)
            : 1,
        dtIsoFormat: normalizeBool(next.dtIsoFormat),
        dtHour12: normalizeBool(next.dtHour12),
        hideUserNotes: normalizeBool(next.hideUserNotes),
        hideUserMemos: normalizeBool(next.hideUserMemos),
        hideUnfriends: normalizeBool(next.hideUnfriends),
        randomUserColours: normalizeBool(next.randomUserColours),
        notificationIconDot: normalizeBool(next.notificationIconDot),
        showPostUpdateChangelogToast: normalizeBool(
            next.showPostUpdateChangelogToast
        ),
        desktopToast: next.desktopToast || 'Never',
        afkDesktopToast: normalizeBool(next.afkDesktopToast),
        desktopNotificationSound: normalizeBool(next.desktopNotificationSound),
        notificationTTS: next.notificationTTS || 'Never',
        notificationTTSNickName: normalizeBool(next.notificationTTSNickName),
        notificationTTSVoice: String(next.notificationTTSVoice ?? '0'),
        xsNotifications: normalizeBool(next.xsNotifications),
        ovrtHudNotifications: normalizeBool(next.ovrtHudNotifications),
        ovrtWristNotifications: normalizeBool(next.ovrtWristNotifications),
        imageNotifications: normalizeBool(next.imageNotifications),
        notificationTimeout: normalizeBoundedInt(next.notificationTimeout, {
            min: 0,
            max: 600000,
            fallback: 3000
        }),
        notificationOpacity: normalizeBoundedInt(next.notificationOpacity, {
            min: 0,
            max: 100,
            fallback: 100
        }),
        wristOverlayEnabled: normalizeBool(next.wristOverlayEnabled),
        wristOverlayStartMode: normalizeWristOverlayStartMode(
            next.wristOverlayStartMode
        ),
        wristOverlayButton: normalizeWristOverlayButton(
            next.wristOverlayButton
        ),
        wristOverlayHand: normalizeWristOverlayHand(next.wristOverlayHand),
        wristOverlaySize: normalizeWristOverlaySize(next.wristOverlaySize),
        wristOverlayHidePrivateWorlds: normalizeBool(
            next.wristOverlayHidePrivateWorlds
        ),
        wristOverlayDarkBackground: normalizeBool(
            next.wristOverlayDarkBackground
        ),
        wristOverlayShowDevices: normalizeBool(next.wristOverlayShowDevices),
        wristOverlayShowBatteryPercent: normalizeBool(
            next.wristOverlayShowBatteryPercent
        ),
        relaunchVRChatAfterCrash: normalizeBool(next.relaunchVRChatAfterCrash),
        vrcQuitFix: normalizeBool(next.vrcQuitFix),
        autoSweepVRChatCache: normalizeBool(next.autoSweepVRChatCache),
        showConfirmationOnSwitchAvatar: normalizeBool(
            next.showConfirmationOnSwitchAvatar
        ),
        gameLogDisabled: normalizeBool(next.gameLogDisabled),
        avatarAutoCleanup: next.avatarAutoCleanup || 'Off',
        defaultLaunchMode: normalizeDefaultLaunchMode(next.defaultLaunchMode),
        udonExceptionLogging: normalizeBool(next.udonExceptionLogging),
        logResourceLoad: normalizeBool(next.logResourceLoad),
        autoLoginDelayEnabled: normalizeBool(next.autoLoginDelayEnabled),
        autoLoginDelaySeconds: normalizeBoundedInt(next.autoLoginDelaySeconds, {
            min: 0,
            max: 10,
            fallback: 0
        }),
        backgroundModeEnabled: normalizeBool(next.backgroundModeEnabled),
        isStartAtWindowsStartup: normalizeBool(next.isStartAtWindowsStartup),
        isStartAsMinimizedState: normalizeBool(next.isStartAsMinimizedState),
        isCloseToTray: normalizeBool(next.isCloseToTray),
        navPanelWidth: normalizeNavWidth(next.navPanelWidth),
        navIsCollapsed: normalizeBool(next.navIsCollapsed),
        proxyServer: String(next.proxyServer || ''),
        tablePageSize: normalizeTablePageSize(next.tablePageSize),
        tablePageSizes: normalizeTablePageSizes(next.tablePageSizes),
        tableLimits: normalizeTableLimits(next.tableLimits),
        localFavoriteFriendsGroups: Array.isArray(
            next.localFavoriteFriendsGroups
        )
            ? next.localFavoriteFriendsGroups.filter(Boolean)
            : [],
        sharedFeedFilters: parseSharedFeedFilters(next.sharedFeedFilters),
        overlayActivityFilters: parseOverlayActivityFiltersPreference(
            hasOverlayActivityFiltersInput
                ? next.overlayActivityFilters
                : undefined,
            next.sharedFeedFilters
        ),
        vrNotificationActivityFilters: parseOverlayActivityFilterProfile(
            next.vrNotificationActivityFilters
        ),
        feedTimeDisplayMode: normalizeFeedTimeDisplayMode(
            next.feedTimeDisplayMode
        ),
        trustColor: normalizeTrustColors(next.trustColor),
        youtubeAPI: normalizeBool(next.youtubeAPI),
        translationAPI: normalizeBool(next.translationAPI),
        bioLanguage: next.bioLanguage || 'en',
        translationAPIType:
            next.translationAPIType === 'openai' ? 'openai' : 'google',
        translationAPIEndpoint:
            next.translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel:
            next.translationAPIModel || DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: String(next.translationAPIPrompt || ''),
        discordActive: normalizeBool(next.discordActive),
        discordInstance: normalizeBool(next.discordInstance),
        discordHideInvite: normalizeBool(next.discordHideInvite),
        discordJoinButton: normalizeBool(next.discordJoinButton),
        discordHideImage: normalizeBool(next.discordHideImage),
        discordShowPlatform: normalizeBool(next.discordShowPlatform),
        discordWorldIntegration: normalizeBool(next.discordWorldIntegration),
        discordWorldNameAsDiscordStatus: normalizeBool(
            next.discordWorldNameAsDiscordStatus
        )
    };
}

export type PreferencesSnapshot = ReturnType<
    typeof normalizePreferenceSnapshot
>;

export type PreferencesStoreState = PreferencesSnapshot & {
    preferencesHydrated: boolean;
    hydratePreferences(snapshot: unknown): void;
    patchPreferences(patch: Record<string, unknown>): void;
    setPreferenceValue(key: string, value: unknown): void;
};

export const usePreferencesStore = create<PreferencesStoreState>(
    (set: any) => ({
        ...normalizePreferenceSnapshot(DEFAULT_PREFERENCES),
        preferencesHydrated: false,
        hydratePreferences(snapshot: unknown) {
            set({
                ...normalizePreferenceSnapshot(
                    snapshot as PreferenceInputSnapshot
                ),
                preferencesHydrated: true
            });
        },
        patchPreferences(patch: Record<string, unknown>) {
            set((state: any) =>
                normalizePreferenceSnapshot({
                    ...state,
                    ...patch
                } as PreferenceInputSnapshot)
            );
        },
        setPreferenceValue(key: string, value: unknown) {
            set((state: any) =>
                normalizePreferenceSnapshot({
                    ...state,
                    [key]: value
                } as PreferenceInputSnapshot)
            );
        }
    })
);
