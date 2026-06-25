import {
    DEFAULT_PREFERENCES,
    type DiscordPreferenceKey,
    type TableLimitsPreference
} from '@/state/preferencesStore';

export const DEFAULT_NOTIFICATION_LAYOUT = 'notification-center';
export const DEFAULT_TRANSLATION_ENDPOINT =
    'https://api.openai.com/v1/chat/completions';
export const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';
export const DEFAULT_TABLE_PAGE_SIZE =
    Number(DEFAULT_PREFERENCES.tablePageSize) || 20;
export const DEFAULT_TABLE_PAGE_SIZES = Array.isArray(
    DEFAULT_PREFERENCES.tablePageSizes
)
    ? DEFAULT_PREFERENCES.tablePageSizes
    : [10, 15, 20, 25, 50, 100];
export const DEFAULT_TABLE_LIMITS =
    DEFAULT_PREFERENCES.tableLimits as TableLimitsPreference;
export const DISCORD_BOOL_PREFERENCE_KEYS = new Set<DiscordPreferenceKey>([
    'discordActive',
    'discordInstance',
    'discordHideInvite',
    'discordJoinButton',
    'discordHideImage',
    'discordShowPlatform',
    'discordWorldIntegration',
    'discordWorldNameAsDiscordStatus'
]);
export const VRCHAT_RICH_PRESENCE_CONFIG_KEY = 'disableRichPresence';
export const WRIST_OVERLAY_RUNTIME_CONFIG_KEYS = new Set([
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
export const LEGACY_OVERLAY_NOTIFICATION_KEYS = Object.freeze({
    xsNotifications: 'VRCX-0_xsNotifications',
    ovrtHudNotifications: 'VRCX-0_ovrtHudNotifications',
    ovrtWristNotifications: 'VRCX-0_ovrtWristNotifications',
    imageNotifications: 'VRCX-0_imageNotifications',
    notificationTimeout: 'VRCX-0_notificationTimeout',
    notificationOpacity: 'VRCX-0_notificationOpacity'
});
