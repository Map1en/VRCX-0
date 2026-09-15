import type { Dispatch, SetStateAction } from 'react';

import type { AppDataDirState, TtsVoice } from '@/platform/tauri/bindings';
import type { NotificationLayout, TableDensity } from '@/state/shellStore';

import type { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import type { FavoriteFriendGroupOption } from './settingsFavoriteGroupOptions';
import type { CustomFontDraft } from './settingsValues';
import type {
    AvatarProviderConfig,
    useAvatarProviderConfig
} from './useAvatarProviderConfig';
import type { useSettingsActions } from './useSettingsActions';
import type {
    SettingsDiscordPrefs,
    SettingsIntegrationPrefs,
    useSettingsIntegrations
} from './useSettingsIntegrations';

type SettingsPagePrefs = ReturnType<typeof createDefaultSettingsPrefs> &
    Record<string, unknown>;
type SettingsPrefs = SettingsPagePrefs;
type SettingsAction = () => void;
type SettingsVoidAction = () => void | Promise<void>;
type SettingsRollback = () => void;
type SettingsOptimisticUpdate = () => void | SettingsRollback;
type SettingsCallback<Args extends unknown[] = unknown[], Result = void> = {
    bivarianceHack(...args: Args): Result;
}['bivarianceHack'];
type SetSettingsPrefs = SettingsCallback<
    [
        | SettingsPrefs
        | ((current: SettingsPrefs) => SettingsPrefs | Record<string, unknown>)
    ]
>;

type SettingsIntegrationsState = ReturnType<typeof useSettingsIntegrations>;
type SettingsActionsState = ReturnType<typeof useSettingsActions>;
type AvatarProviderState = ReturnType<typeof useAvatarProviderConfig>;
type DialogSectionInput = Pick<
    SettingsIntegrationsState,
    | 'fetchTranslationModels'
    | 'integrationStatus'
    | 'llmEndpoints'
    | 'saveTranslationApiConfig'
    | 'saveYoutubeApiKey'
    | 'setTranslationApiDialogOpen'
    | 'setTranslationDraftValue'
    | 'setYoutubeApiDialogOpen'
    | 'setYoutubeApiKeyDraft'
    | 'testTranslationApiConfig'
    | 'translationApiDialogOpen'
    | 'translationDraft'
    | 'youtubeApiDialogOpen'
    | 'youtubeApiKeyDraft'
> &
    Pick<
        SettingsActionsState,
        | 'purgeAvatarFeedData'
        | 'saveCustomFontFamily'
        | 'saveDesktopNotificationActivityFilters'
        | 'saveHmdNotificationActivityFilters'
        | 'saveOverlayActivityFilters'
        | 'saveTableLimitsDialog'
        | 'saveTtsNotificationActivityFilters'
        | 'saveVrNotificationActivityFilters'
        | 'saveWebhookActivityFilters'
        | 'searchLimitError'
        | 'tableLimitsSaveDisabled'
        | 'tableMaxSizeError'
    > &
    Pick<
        AvatarProviderState,
        | 'addAvatarProvider'
        | 'removeAvatarProvider'
        | 'saveAvatarProviderField'
        | 'updateAvatarProvider'
    > & {
        avatarProviderDialogOpen: boolean;
        customFontDialogOpen: boolean;
        customFontDraft: CustomFontDraft;
        customFontOptions: string[];
        customFontOptionsLoading: boolean;
        purgeDialogOpen: boolean;
        purgeInProgress: boolean;
        purgePeriod: string;
        setCustomFontDialogOpen: Dispatch<SetStateAction<boolean>>;
        setCustomFontDraft: Dispatch<SetStateAction<CustomFontDraft>>;
        setPurgePeriod: Dispatch<SetStateAction<string>>;
        setTableLimitsDialogOpen: Dispatch<SetStateAction<boolean>>;
        setTableLimitsDraft: Dispatch<
            SetStateAction<{ maxTableSize: string; searchLimit: string }>
        >;
        setTablePageSizesDialogOpen: Dispatch<SetStateAction<boolean>>;
        tableLimitsDialogOpen: boolean;
        tableLimitsDraft: { maxTableSize: string; searchLimit: string };
        tablePageSizesDialogOpen: boolean;
    };

type IntegrationSectionInput = Pick<
    SettingsIntegrationsState,
    'setIntegrationValue'
> &
    Pick<
        AvatarProviderState,
        | 'applyAvatarProviderConfig'
        | 'avatarProviderConfigRef'
        | 'saveAvatarProviderConfig'
    >;

export type BuildSettingsPageStateSectionsInput = DialogSectionInput &
    IntegrationSectionInput & {
        activeSettingsTab: string;
        appDataDirState?: AppDataDirState | null;
        avatarProviderConfig: AvatarProviderConfig;
        configTreeData: Record<string, unknown>;
        commit: (
            action: SettingsAction,
            optimistic?: SettingsOptimisticUpdate
        ) => Promise<boolean>;
        cleanupAppDataDir: SettingsVoidAction;
        deleteAllScreenshotMetadata: SettingsCallback;
        desktopNotificationsDialogOpen: boolean;
        dismissAppDataDirCleanup: SettingsVoidAction;
        discordPrefs: SettingsDiscordPrefs;
        handleCropInstancePrintsChange: SettingsCallback<[boolean]>;
        handleGameLogDisabledChange: SettingsCallback<[boolean]>;
        handleFeedPersistenceDisabledChange: SettingsCallback<[boolean]>;
        handleAvatarFeedPersistenceDisabledChange: SettingsCallback<[boolean]>;
        hmdNotificationsDialogOpen: boolean;
        integrationPrefs: SettingsIntegrationPrefs;
        locale: string;
        migrateLegacyVrcxData: SettingsVoidAction;
        normalizeRecentActionCooldownMinutes: (value: string) => number;
        notificationTtsTest: string;
        notificationTtsTestVisible: boolean;
        onlineVisitCount: number | null;
        openAppDataDirSelector: SettingsVoidAction;
        openCustomFontDialog: SettingsCallback;
        openTableLimitsDialog: SettingsCallback;
        openTablePageSizesDialog: SettingsCallback;
        openTranslationApiDialog: SettingsCallback;
        openUgcFolderSelector: SettingsCallback;
        openYoutubeApiDialog: SettingsCallback;
        promptAutoLoginDelaySeconds: SettingsCallback;
        promptBackgroundModeDelayMinutes: SettingsCallback;
        prefs: SettingsPrefs;
        refreshConfigTreeData: SettingsVoidAction;
        refreshOnlineVisits: SettingsVoidAction;
        refreshSqliteTableSizes: SettingsVoidAction;
        resetAppDataDir: SettingsVoidAction;
        resetTrustColors: SettingsCallback;
        resetUgcFolder: SettingsCallback;
        saveAvatarProviderEnabled: SettingsCallback<[boolean]>;
        saveBoolPreference: SettingsCallback<[string, string, boolean]>;
        saveDiscordBoolPreference: SettingsCallback<[string, boolean]>;
        saveFontFamilyPreference: SettingsCallback<[string]>;
        saveIntegrationBoolPreference: SettingsCallback<
            [string, boolean, SettingsAction]
        >;
        saveInterfaceZoomLevel: SettingsCallback<[string | number]>;
        savePreferenceValue: SettingsCallback<
            [string, unknown, SettingsAction],
            Promise<boolean>
        >;
        saveStringPreference: SettingsCallback<[string, string, string]>;
        saveTrustColor: SettingsCallback<[string, string]>;
        saveNotificationTtsMode: SettingsCallback<[string]>;
        saveNotificationTtsVoice: SettingsCallback<[string]>;
        saveWristOverlayEnabled: SettingsCallback<[boolean]>;
        selectCjkFontPack: SettingsCallback<[string]>;
        setAccessibleStatusIndicatorsPreference: SettingsCallback<[boolean]>;
        setActiveSettingsTab: SettingsCallback<[string]>;
        setAppLanguagePreference: SettingsCallback<[string | null]>;
        setAvatarProviderDialogOpen: SettingsCallback<[boolean]>;
        setCloseToTrayPreference: SettingsCallback<[boolean]>;
        setConfigTreeData: SettingsCallback<[Record<string, unknown>]>;
        setDataTableStripedPreference: SettingsCallback<[boolean]>;
        setDesktopNotificationsDialogOpen: SettingsCallback<[boolean]>;
        setIntConfigPreference: SettingsCallback<
            [string, number, { min?: number; max?: number; fallback?: number }]
        >;
        setNotificationLayoutPreference: SettingsCallback<[NotificationLayout]>;
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
        setScreenshotHelperCopyToClipboardPreference: SettingsCallback<
            [boolean]
        >;
        setScreenshotHelperModifyFilenamePreference: SettingsCallback<
            [boolean]
        >;
        setScreenshotHelperPreference: SettingsCallback<[boolean]>;
        setShowNewDashboardButtonPreference: SettingsCallback<[boolean]>;
        setStartAsMinimizedPreference: SettingsCallback<[boolean]>;
        setStartAtWindowsStartupPreference: SettingsCallback<[boolean]>;
        setSystemWindowFramePreference: SettingsCallback<[boolean]>;
        setTableDensityPreference: SettingsCallback<[TableDensity]>;
        setHmdNotificationsDialogOpen: SettingsCallback<[boolean]>;
        setTranslationApiEnabledPreference: SettingsCallback<[boolean]>;
        setTtsNotificationsDialogOpen: SettingsCallback<[boolean]>;
        setVrNotificationsDialogOpen: SettingsCallback<[boolean]>;
        setWebhookNotificationsDialogOpen: SettingsCallback<[boolean]>;
        setWristFeedNotificationsDialogOpen: SettingsCallback<[boolean]>;
        setYoutubeApiEnabledPreference: SettingsCallback<[boolean]>;
        setZoomInput: SettingsCallback<[string]>;
        setZoomLevelPreference: SettingsCallback<[string | number]>;
        speakNotificationTts: SettingsCallback<[string, string?]>;
        sqliteTableSizes: Record<string, unknown>;
        toggleLocalFavoriteFriendsGroup: SettingsCallback<[string, boolean]>;
        ttsNotificationsDialogOpen: boolean;
        ttsVoices: TtsVoice[];
        vrNotificationsDialogOpen: boolean;
        webhookNotificationsDialogOpen: boolean;
        wristFeedNotificationsDialogOpen: boolean;
        zoomInput: string;
        zoomLevel: number | null;
        addFeedHiddenUser: SettingsCallback<[string]>;
        favoriteFriendGroupOptions: FavoriteFriendGroupOption[];
        localFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
        localFavoriteFriendsGroups: string[];
        remoteFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
        removeFeedHiddenUser: SettingsCallback<[string]>;
        selectedFavoriteFriendGroupLabel: string;
    };

export type SettingsSectionInput<
    Keys extends keyof BuildSettingsPageStateSectionsInput
> = Pick<BuildSettingsPageStateSectionsInput, Keys>;
