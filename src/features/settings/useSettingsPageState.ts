import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { AppDataDirState, TtsVoice } from '@/platform/tauri/bindings';
import {
    setAccessibleStatusIndicatorsPreference,
    setAppLanguagePreference,
    setDataTableStripedPreference,
    setNotificationLayoutPreference,
    setRecentActionCooldownEnabledPreference,
    setRecentActionCooldownMinutesPreference,
    setShowNewDashboardButtonPreference,
    setScreenshotHelperCopyToClipboardPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperPreference,
    setCloseToTrayPreference,
    setIntConfigPreference,
    setSaveInstanceEmojiPreference,
    setSaveInstancePrintsPreference,
    setSaveInstanceStickersPreference,
    setStartAsMinimizedPreference,
    setStartAtWindowsStartupPreference,
    setTableDensityPreference,
    setTranslationApiEnabledPreference,
    setYoutubeApiEnabledPreference,
    setZoomLevelPreference
} from '@/services/preferencesService';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { MINUTES_PER_DAY } from '@/shared/constants/time';
import { useFavoriteStore } from '@/state/favoriteStore';
import {
    DEFAULT_PREFERENCES,
    usePreferencesStore,
    type PreferencesSnapshot
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import { buildFavoriteFriendGroupOptions } from './settingsFavoriteGroupOptions';
import { buildSettingsPageStateSections } from './settingsPageStateSections';
import {
    useAvatarProviderConfig,
    type AvatarProviderConfig
} from './useAvatarProviderConfig';
import { useSettingsActions } from './useSettingsActions';
import { useSettingsCommit } from './useSettingsCommit';
import { useSettingsEffects } from './useSettingsEffects';
import {
    useSettingsIntegrations,
    type SettingsIntegrationPrefs
} from './useSettingsIntegrations';

const SETTINGS_PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as Array<
    keyof PreferencesSnapshot
>;

type SettingsSqliteTableSizes = Record<string, unknown>;
type SettingsConfigTreeData = Record<string, unknown>;
type SettingsTableLimitsDraft = {
    maxTableSize: string;
    searchLimit: string;
};
type PreferenceAction = () => unknown | Promise<unknown>;
type SettingsIntegrationBoolKey = Extract<
    keyof SettingsIntegrationPrefs,
    'translationAPI' | 'youtubeAPI'
>;

export function useSettingsPageState() {
    const locale = useShellStore((state) => state.locale);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const preferenceState = usePreferencesStore(
        useShallow((state) => {
            const snapshot: Record<string, unknown> & {
                preferencesHydrated: boolean;
            } = {
                preferencesHydrated: state.preferencesHydrated
            };
            for (const key of SETTINGS_PREFERENCE_KEYS) {
                snapshot[key] = state[key];
            }
            return snapshot;
        })
    );
    const [prefs, setPrefs] = useState(() => createDefaultSettingsPrefs());
    const [sqliteTableSizes, setSqliteTableSizes] =
        useState<SettingsSqliteTableSizes>({});
    const [appDataDirState, setAppDataDirState] =
        useState<AppDataDirState | null>(null);
    const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
    const [purgePeriod, setPurgePeriod] = useState('180');
    const [purgeInProgress, setPurgeInProgress] = useState(false);
    const [onlineVisitCount, setOnlineVisitCount] = useState<number | null>(
        null
    );
    const [configTreeData, setConfigTreeData] =
        useState<SettingsConfigTreeData>({});
    const [localFavoriteFriendsGroups, setLocalFavoriteFriendsGroups] =
        useState<string[]>([]);
    const [zoomInput, setZoomInput] = useState('100');
    const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>([]);
    const [notificationTtsTest, setNotificationTtsTest] = useState('');
    const [customFontDialogOpen, setCustomFontDialogOpen] = useState(false);
    const [customFontDraft, setCustomFontDraft] = useState({
        primary: '',
        secondary: '',
        override: ''
    });
    const [customFontOptions, setCustomFontOptions] = useState<string[]>([]);
    const [customFontOptionsLoading, setCustomFontOptionsLoading] =
        useState(false);
    const [activeSettingsTab, setActiveSettingsTab] = useState('system');
    const [
        wristFeedNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen
    ] = useState(false);
    const [vrNotificationsDialogOpen, setVrNotificationsDialogOpen] =
        useState(false);
    const [hmdNotificationsDialogOpen, setHmdNotificationsDialogOpen] =
        useState(false);
    const [desktopNotificationsDialogOpen, setDesktopNotificationsDialogOpen] =
        useState(false);
    const [webhookNotificationsDialogOpen, setWebhookNotificationsDialogOpen] =
        useState(false);
    const [ttsNotificationsDialogOpen, setTtsNotificationsDialogOpen] =
        useState(false);
    const [notificationTtsTestVisible, setNotificationTtsTestVisible] =
        useState(false);
    const [tablePageSizesDialogOpen, setTablePageSizesDialogOpen] =
        useState(false);
    const [tableLimitsDialogOpen, setTableLimitsDialogOpen] = useState(false);
    const [tableLimitsDraft, setTableLimitsDraft] =
        useState<SettingsTableLimitsDraft>({
            maxTableSize: String(DEFAULT_MAX_TABLE_SIZE),
            searchLimit: String(DEFAULT_SEARCH_LIMIT)
        });
    const [avatarProviderDialogOpen, setAvatarProviderDialogOpen] =
        useState(false);
    const commit = useSettingsCommit();

    const {
        discordPrefs,
        fetchTranslationModels,
        integrationPrefs,
        integrationStatus,
        llmEndpoints,
        openTranslationApiDialog,
        openYoutubeApiDialog,
        saveDiscordBoolPreference,
        saveTranslationApiConfig,
        saveYoutubeApiKey,
        setDiscordPrefs,
        setIntegrationPrefs,
        setIntegrationValue,
        setTranslationApiDialogOpen,
        setTranslationDraftValue,
        setYoutubeApiDialogOpen,
        setYoutubeApiKeyDraft,
        testTranslationApiConfig,
        translationApiDialogOpen,
        translationDraft,
        youtubeApiDialogOpen,
        youtubeApiKeyDraft
    } = useSettingsIntegrations({
        commit
    });
    const {
        addAvatarProvider,
        applyAvatarProviderConfig,
        avatarProviderConfig,
        avatarProviderConfigRef,
        removeAvatarProvider,
        saveAvatarProviderConfig,
        saveAvatarProviderField,
        updateAvatarProvider
    } = useAvatarProviderConfig({
        commit
    });

    const {
        applyPreferenceSnapshotToLocalState,
        addFeedHiddenUser,
        savePreferenceValue,
        saveBoolPreference,
        saveStringPreference,
        saveFontFamilyPreference,
        selectCjkFontPack,
        openCustomFontDialog,
        saveCustomFontFamily,
        saveTrustColor,
        resetTrustColors,
        refreshSqliteTableSizes,
        refreshConfigTreeData,
        refreshOnlineVisits,
        openTablePageSizesDialog,
        openTableLimitsDialog,
        saveTableLimitsDialog,
        toggleLocalFavoriteFriendsGroup,
        speakNotificationTts,
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        deleteAllScreenshotMetadata,
        promptAutoLoginDelaySeconds,
        promptBackgroundModeDelayMinutes,
        resetUgcFolder,
        purgeAvatarFeedData,
        openUgcFolderSelector,
        handleCropInstancePrintsChange,
        handleGameLogDisabledChange,
        migrateLegacyVrcxData,
        openAppDataDirSelector,
        resetAppDataDir,
        cleanupAppDataDir,
        dismissAppDataDirCleanup,
        removeFeedHiddenUser,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveHmdNotificationActivityFilters,
        saveDesktopNotificationActivityFilters,
        saveWebhookActivityFilters,
        saveTtsNotificationActivityFilters,
        saveWristOverlayEnabled,
        setProxyEnabledPreference: saveProxyEnabledPreference,
        searchLimitError,
        tableLimitsSaveDisabled,
        tableMaxSizeError
    } = useSettingsActions({
        commit,
        customFontDraft,
        localFavoriteFriendsGroups,
        prefs,
        purgePeriod,
        setAppDataDirState,
        setConfigTreeData,
        setCustomFontDialogOpen,
        setCustomFontDraft,
        setCustomFontOptions,
        setCustomFontOptionsLoading,
        setDiscordPrefs,
        setIntegrationPrefs,
        setLocalFavoriteFriendsGroups,
        setOnlineVisitCount,
        setPrefs,
        setPurgeDialogOpen,
        setPurgeInProgress,
        setSqliteTableSizes,
        setTableLimitsDialogOpen,
        setTableLimitsDraft,
        setTablePageSizesDialogOpen,
        tableLimitsDraft
    });
    useSettingsEffects({
        applyAvatarProviderConfig,
        applyPreferenceSnapshotToLocalState,
        preferenceState,
        setAppDataDirState,
        setPrefs,
        setTtsVoices,
        setZoomInput,
        sidebarOpen,
        zoomLevel
    });
    const {
        favoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        selectedFavoriteFriendGroupLabel
    } = useMemo(
        () =>
            buildFavoriteFriendGroupOptions({
                favoriteFriendGroups,
                localFriendFavoriteGroups,
                localFavoriteFriendsGroups
            }),
        [
            favoriteFriendGroups,
            localFavoriteFriendsGroups,
            localFriendFavoriteGroups
        ]
    );

    function normalizeRecentActionCooldownMinutes(value: unknown) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
            return 60;
        }
        return Math.min(MINUTES_PER_DAY, Math.max(1, parsed));
    }

    async function saveInterfaceZoomLevel(value: string | number) {
        let savedZoom = zoomLevel;
        const saved = await commit(async () => {
            savedZoom = await setZoomLevelPreference(value);
        });
        if (saved) {
            setZoomInput(String(savedZoom));
        }
    }

    function saveIntegrationBoolPreference(
        key: SettingsIntegrationBoolKey,
        value: boolean,
        action: PreferenceAction
    ) {
        commit(action, () => {
            const previous = integrationPrefs[key];
            setIntegrationValue(key, value);
            return () => setIntegrationValue(key, previous);
        });
    }

    function saveAvatarProviderEnabled(value: unknown) {
        const previousConfig = avatarProviderConfigRef.current;
        const nextConfig: AvatarProviderConfig = {
            ...previousConfig,
            enabled: Boolean(value)
        };
        commit(
            () => saveAvatarProviderConfig(nextConfig),
            () => {
                applyAvatarProviderConfig(nextConfig);
                return () => applyAvatarProviderConfig(previousConfig);
            }
        );
    }

    return buildSettingsPageStateSections({
        activeSettingsTab,
        addFeedHiddenUser,
        addAvatarProvider,
        appDataDirState,
        applyAvatarProviderConfig,
        avatarProviderConfig,
        avatarProviderConfigRef,
        avatarProviderDialogOpen,
        commit,
        configTreeData,
        customFontDialogOpen,
        customFontDraft,
        customFontOptions,
        customFontOptionsLoading,
        deleteAllScreenshotMetadata,
        desktopNotificationsDialogOpen,
        discordPrefs,
        favoriteFriendGroupOptions,
        fetchTranslationModels,
        handleCropInstancePrintsChange,
        handleGameLogDisabledChange,
        integrationPrefs,
        integrationStatus,
        hmdNotificationsDialogOpen,
        llmEndpoints,
        locale,
        localFavoriteFriendGroupOptions,
        localFavoriteFriendsGroups,
        migrateLegacyVrcxData,
        normalizeRecentActionCooldownMinutes,
        notificationTtsTest,
        notificationTtsTestVisible,
        onlineVisitCount,
        openAppDataDirSelector,
        cleanupAppDataDir,
        dismissAppDataDirCleanup,
        openCustomFontDialog,
        openTableLimitsDialog,
        openTablePageSizesDialog,
        openTranslationApiDialog,
        openUgcFolderSelector,
        openYoutubeApiDialog,
        prefs,
        promptAutoLoginDelaySeconds,
        promptBackgroundModeDelayMinutes,
        purgeAvatarFeedData,
        purgeDialogOpen,
        purgeInProgress,
        purgePeriod,
        refreshConfigTreeData,
        refreshOnlineVisits,
        refreshSqliteTableSizes,
        remoteFavoriteFriendGroupOptions,
        removeFeedHiddenUser,
        removeAvatarProvider,
        resetAppDataDir,
        resetTrustColors,
        resetUgcFolder,
        saveAvatarProviderConfig,
        saveAvatarProviderEnabled,
        saveAvatarProviderField,
        saveBoolPreference,
        saveCustomFontFamily,
        saveDiscordBoolPreference,
        saveFontFamilyPreference,
        saveIntegrationBoolPreference,
        saveInterfaceZoomLevel,
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        savePreferenceValue,
        saveStringPreference,
        saveTableLimitsDialog,
        saveTranslationApiConfig,
        saveTrustColor,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveHmdNotificationActivityFilters,
        saveDesktopNotificationActivityFilters,
        saveWebhookActivityFilters,
        saveTtsNotificationActivityFilters,
        saveWristOverlayEnabled,
        saveYoutubeApiKey,
        searchLimitError,
        selectCjkFontPack,
        selectedFavoriteFriendGroupLabel,
        setAccessibleStatusIndicatorsPreference,
        setActiveSettingsTab,
        setAppLanguagePreference,
        setAvatarProviderDialogOpen,
        setCloseToTrayPreference,
        setConfigTreeData,
        setCustomFontDialogOpen,
        setCustomFontDraft,
        setDataTableStripedPreference,
        setDesktopNotificationsDialogOpen,
        setHmdNotificationsDialogOpen,
        setIntConfigPreference,
        setIntegrationValue,
        setNotificationLayoutPreference,
        setNotificationTtsTest,
        setNotificationTtsTestVisible,
        setPrefs,
        setPurgeDialogOpen,
        setProxyEnabledPreference: saveProxyEnabledPreference,
        setPurgePeriod,
        setRecentActionCooldownEnabledPreference,
        setRecentActionCooldownMinutesPreference,
        setSaveInstanceEmojiPreference,
        setSaveInstancePrintsPreference,
        setSaveInstanceStickersPreference,
        setScreenshotHelperCopyToClipboardPreference,
        setScreenshotHelperModifyFilenamePreference,
        setScreenshotHelperPreference,
        setShowNewDashboardButtonPreference,
        setStartAsMinimizedPreference,
        setStartAtWindowsStartupPreference,
        setTableDensityPreference,
        setTableLimitsDialogOpen,
        setTableLimitsDraft,
        setTablePageSizesDialogOpen,
        setTranslationApiDialogOpen,
        setTranslationDraftValue,
        setTranslationApiEnabledPreference,
        setTtsNotificationsDialogOpen,
        setVrNotificationsDialogOpen,
        setWebhookNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        setYoutubeApiDialogOpen,
        setYoutubeApiEnabledPreference,
        setYoutubeApiKeyDraft,
        setZoomInput,
        setZoomLevelPreference,
        sqliteTableSizes,
        speakNotificationTts,
        tableLimitsDialogOpen,
        tableLimitsDraft,
        tableLimitsSaveDisabled,
        tableMaxSizeError,
        tablePageSizesDialogOpen,
        testTranslationApiConfig,
        translationApiDialogOpen,
        translationDraft,
        ttsVoices,
        ttsNotificationsDialogOpen,
        toggleLocalFavoriteFriendsGroup,
        updateAvatarProvider,
        vrNotificationsDialogOpen,
        webhookNotificationsDialogOpen,
        wristFeedNotificationsDialogOpen,
        youtubeApiDialogOpen,
        youtubeApiKeyDraft,
        zoomInput,
        zoomLevel
    });
}
