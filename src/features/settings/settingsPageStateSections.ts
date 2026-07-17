import type { AppDataDirState, TtsVoice } from '@/platform/tauri/bindings';

import { buildDialogsSection } from './settings-page-state-sections/dialogsSection';
import { buildIntegrationsSection } from './settings-page-state-sections/integrationsSection';
import { buildInterfaceSection } from './settings-page-state-sections/interfaceSection';
import { buildMediaSection } from './settings-page-state-sections/mediaSection';
import {
    buildAdvancedSection,
    buildNotificationsSection,
    buildVrSection
} from './settings-page-state-sections/notificationsVrAdvancedSections';
import {
    buildShellSection,
    buildSystemSection
} from './settings-page-state-sections/shellSystemSections';
import { buildSocialSection } from './settings-page-state-sections/socialSection';
import type { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import type { FavoriteFriendGroupOption } from './settingsFavoriteGroupOptions';
import type { AvatarProviderConfig } from './useAvatarProviderConfig';
import type {
    SettingsDiscordPrefs,
    SettingsIntegrationPrefs
} from './useSettingsIntegrations';

export type SettingsPagePrefs = ReturnType<typeof createDefaultSettingsPrefs> &
    Record<string, unknown>;
type SettingsPrefs = SettingsPagePrefs;
type SettingsAction = () => unknown | Promise<unknown>;
type SettingsCallback<Args extends unknown[] = unknown[]> = {
    bivarianceHack(...args: Args): unknown;
}['bivarianceHack'];
type SetSettingsPrefs = SettingsCallback<
    [
        | SettingsPrefs
        | ((current: SettingsPrefs) => SettingsPrefs | Record<string, unknown>)
    ]
>;

export type BuildSettingsPageStateSectionsInput = Record<string, unknown> & {
    activeSettingsTab: string;
    appDataDirState?: AppDataDirState | null;
    avatarProviderConfig: AvatarProviderConfig;
    configTreeData: Record<string, unknown>;
    commit: SettingsCallback<
        [action: SettingsAction, optimistic?: () => unknown]
    >;
    deleteAllScreenshotMetadata: SettingsCallback;
    desktopNotificationsDialogOpen: boolean;
    discordPrefs: SettingsDiscordPrefs;
    handleCropInstancePrintsChange: SettingsCallback<[boolean]>;
    handleGameLogDisabledChange: SettingsCallback<[boolean]>;
    hmdNotificationsDialogOpen: boolean;
    integrationPrefs: SettingsIntegrationPrefs;
    loading: boolean;
    migrateLegacyVrcxData: SettingsCallback;
    normalizeRecentActionCooldownMinutes: (value: unknown) => number;
    notificationTtsTest: string;
    notificationTtsTestVisible: boolean;
    onlineVisitCount: number | null;
    openAppDataDirSelector: SettingsCallback;
    openCustomFontDialog: SettingsCallback;
    openTableLimitsDialog: SettingsCallback;
    openTablePageSizesDialog: SettingsCallback;
    openTranslationApiDialog: SettingsCallback;
    openUgcFolderSelector: SettingsCallback;
    openYoutubeApiDialog: SettingsCallback;
    promptAutoLoginDelaySeconds: SettingsCallback;
    promptBackgroundModeDelayMinutes: SettingsCallback;
    prefs: SettingsPrefs;
    refreshConfigTreeData: SettingsCallback;
    refreshOnlineVisits: SettingsCallback;
    refreshSqliteTableSizes: SettingsCallback;
    resetAppDataDir: SettingsCallback;
    resetTrustColors: SettingsCallback;
    resetUgcFolder: SettingsCallback;
    saveAvatarProviderEnabled: SettingsCallback<[boolean]>;
    saveBoolPreference: SettingsCallback<[string, string, boolean]>;
    saveDiscordBoolPreference: SettingsCallback<[string, boolean]>;
    saveFontFamilyPreference: SettingsCallback<[unknown]>;
    saveIntegrationBoolPreference: SettingsCallback<
        [string, boolean, SettingsAction]
    >;
    saveInterfaceZoomLevel: SettingsCallback<[unknown]>;
    savePreferenceValue: SettingsCallback<[string, unknown, SettingsAction]>;
    saveStringPreference: SettingsCallback<[string, string, string]>;
    saveTrustColor: SettingsCallback<[string, string]>;
    saveNotificationTtsMode: SettingsCallback<[string]>;
    saveNotificationTtsVoice: SettingsCallback<[string]>;
    saveOverlayActivityFilters: SettingsCallback<[unknown, unknown?]>;
    saveVrNotificationActivityFilters: SettingsCallback<[unknown, unknown?]>;
    saveHmdNotificationActivityFilters: SettingsCallback<[unknown, unknown?]>;
    saveDesktopNotificationActivityFilters: SettingsCallback<
        [unknown, unknown?]
    >;
    saveWebhookActivityFilters: SettingsCallback<[unknown, unknown?]>;
    saveTtsNotificationActivityFilters: SettingsCallback<[unknown, unknown?]>;
    saveWristOverlayEnabled: SettingsCallback<[boolean]>;
    selectCjkFontPack: SettingsCallback<[unknown]>;
    setAccessibleStatusIndicatorsPreference: SettingsCallback<[boolean]>;
    setActiveSettingsTab: SettingsCallback<[string]>;
    setAppLanguagePreference: SettingsCallback<[unknown]>;
    setAvatarProviderDialogOpen: SettingsCallback<[boolean]>;
    setCloseToTrayPreference: SettingsCallback<[boolean]>;
    setConfigTreeData: SettingsCallback<[Record<string, unknown>]>;
    setDataTableStripedPreference: SettingsCallback<[boolean]>;
    setDesktopNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setIntConfigPreference: SettingsCallback<
        [string, number, { min?: number; max?: number; fallback?: number }]
    >;
    setNotificationLayoutPreference: SettingsCallback<[string]>;
    setNotificationTtsTest: SettingsCallback<[string]>;
    setNotificationTtsTestVisible: SettingsCallback<[boolean]>;
    setPrefs: SetSettingsPrefs;
    setPurgeDialogOpen: SettingsCallback<[boolean]>;
    setProxyEnabledPreference: SettingsCallback<[boolean]>;
    setRecentActionCooldownEnabledPreference: SettingsCallback<[boolean]>;
    setRecentActionCooldownMinutesPreference: SettingsCallback<[number]>;
    setSaveInstanceEmojiPreference: SettingsCallback<[boolean]>;
    setSaveInstancePrintsPreference: SettingsCallback<[boolean]>;
    setSaveInstanceStickersPreference: SettingsCallback<[boolean]>;
    setScreenshotHelperCopyToClipboardPreference: SettingsCallback<[boolean]>;
    setScreenshotHelperModifyFilenamePreference: SettingsCallback<[boolean]>;
    setScreenshotHelperPreference: SettingsCallback<[boolean]>;
    setShowNewDashboardButtonPreference: SettingsCallback<[boolean]>;
    setStartAsMinimizedPreference: SettingsCallback<[boolean]>;
    setStartAtWindowsStartupPreference: SettingsCallback<[boolean]>;
    setTableDensityPreference: SettingsCallback<[unknown]>;
    setHmdNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setTranslationApiEnabledPreference: SettingsCallback<[boolean]>;
    setTtsNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setVrNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setWebhookNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setWristFeedNotificationsDialogOpen: SettingsCallback<[boolean]>;
    setYoutubeApiEnabledPreference: SettingsCallback<[boolean]>;
    setZoomInput: SettingsCallback<[unknown]>;
    speakNotificationTts: SettingsCallback<[string, string?]>;
    sqliteTableSizes: Record<string, unknown>;
    toggleLocalFavoriteFriendsGroup: SettingsCallback<[unknown, boolean]>;
    ttsNotificationsDialogOpen: boolean;
    ttsVoices: TtsVoice[];
    vrNotificationsDialogOpen: boolean;
    webhookNotificationsDialogOpen: boolean;
    wristFeedNotificationsDialogOpen: boolean;
    addFeedHiddenUser: SettingsCallback<[string]>;
    favoriteFriendGroupOptions: FavoriteFriendGroupOption[];
    localFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
    localFavoriteFriendsGroups: string[];
    remoteFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
    removeFeedHiddenUser: SettingsCallback<[string]>;
    selectedFavoriteFriendGroupLabel: string;
};

export function buildSettingsPageStateSections(
    input: BuildSettingsPageStateSectionsInput
) {
    return {
        shell: buildShellSection(input),
        system: buildSystemSection(input),
        interface: buildInterfaceSection(input),
        media: buildMediaSection(input),
        integrations: buildIntegrationsSection(input),
        social: buildSocialSection(input),
        notifications: buildNotificationsSection(input),
        vr: buildVrSection(input),
        advanced: buildAdvancedSection(input),
        dialogs: buildDialogsSection(input)
    };
}

export type SettingsPageStateSections = ReturnType<
    typeof buildSettingsPageStateSections
>;
