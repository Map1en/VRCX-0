import { commands } from '@/platform/tauri/bindings';
import type {
    BoolConfigPreferenceKey,
    StringConfigPreferenceKey
} from '@/services/preferencesService';
import {
    consumeSystemFontsUnavailableWarning,
    loadSystemFonts
} from '@/services/systemFontsService';
import type { OverlayActivityTypeDefinition } from '@/shared/constants/overlayActivityFilters';
import type {
    PreferencesSnapshot,
    PreferencesStoreState,
    TrustColorKey
} from '@/state/preferencesStore';

import {
    composeCustomFontFamily,
    createCustomFontDraftFromPrefs,
    type CustomFontDraft
} from './settingsValues';
import type {
    SettingsDiscordPrefs,
    SettingsIntegrationPrefs
} from './useSettingsIntegrations';

type PreferenceKey = Extract<keyof PreferencesSnapshot, string>;
type NormalizedConfigKey<Key extends string> = Key extends `VRCX_${infer Name}`
    ? Name
    : Key;
type BoolPreferenceKey = NormalizedConfigKey<BoolConfigPreferenceKey> &
    PreferenceKey;
type StringPreferenceKey = NormalizedConfigKey<StringConfigPreferenceKey> &
    PreferenceKey;
type PreferenceAction = () => unknown | Promise<unknown>;
type PreferenceRollback = void | (() => void);
export type SettingsActionPrefs = Record<string, unknown> & {
    appCjkFontPack: unknown;
    appFontFamily: unknown;
    autoLoginDelaySeconds: unknown;
    customFontFamily: unknown;
    customFontOverride: unknown;
    customFontPrimary: unknown;
    customFontSecondary: unknown;
    desktopNotificationActivityFilters: PreferencesSnapshot['desktopNotificationActivityFilters'];
    hmdNotificationActivityFilters: PreferencesSnapshot['hmdNotificationActivityFilters'];
    notificationTTS: unknown;
    notificationTTSNameMode: string;
    notificationTTSVoiceNative: string;
    overlayActivityFilters: PreferencesSnapshot['overlayActivityFilters'];
    proxyServer: string;
    ttsNotificationActivityFilters: PreferencesSnapshot['ttsNotificationActivityFilters'];
    userGeneratedContentPath: string;
    vrNotificationActivityFilters: PreferencesSnapshot['vrNotificationActivityFilters'];
    webhookActivityFilters: PreferencesSnapshot['webhookActivityFilters'];
    wristOverlayEnabled: boolean;
};
type SettingsPrefs = SettingsActionPrefs;
type StateSetter<Value> = {
    bivarianceHack(
        value: Value | ((current: Value) => Value | Record<string, unknown>)
    ): void;
}['bivarianceHack'];
type SettingsPreferenceActionsDeps = {
    APP_FONT_DEFAULT_KEY: string;
    DEFAULT_MAX_TABLE_SIZE: number;
    DEFAULT_SEARCH_LIMIT: number;
    applyAppFontPreferences: (preferences: {
        fontFamily: unknown;
        customFontFamily: unknown;
        cjkFontPack: unknown;
    }) => unknown;
    auth: {
        currentUserEndpoint?: string | null;
        currentUserId?: unknown;
    };
    commit: (
        action: PreferenceAction,
        optimistic?: () => PreferenceRollback
    ) => Promise<boolean>;
    configRepository: {
        setMany(entries: Array<[string, unknown]>): Promise<void>;
    };
    customFontDraft: CustomFontDraft;
    databaseMaintenanceRepository: {
        getTableSizes(userId: unknown): Promise<Record<string, unknown>>;
    };
    isValidFontFamilyList: (value: unknown) => boolean;
    loadTrustColorPreference: () => Promise<PreferencesSnapshot['trustColor']>;
    localFavoriteFriendsGroups: string[];
    normalizeAppCjkFontPack: (value: unknown) => string;
    normalizeAppFontFamily: (value: unknown) => string;
    normalizePreferenceSnapshot: (snapshot?: unknown) => PreferencesSnapshot;
    parseIntegerInput: (value: unknown, fallback: number) => number;
    prefs: SettingsPrefs;
    resetTrustColorsPreference: () => Promise<
        PreferencesSnapshot['trustColor']
    >;
    setBoolConfigPreference: (
        key: BoolConfigPreferenceKey,
        value: boolean
    ) => Promise<unknown>;
    setConfigTreeData: (value: Record<string, unknown>) => void;
    setCustomFontDialogOpen: (value: boolean) => void;
    setCustomFontDraft: (value: CustomFontDraft) => void;
    setCustomFontOptions: (value: string[]) => void;
    setCustomFontOptionsLoading: (value: boolean) => void;
    setDiscordPrefs: StateSetter<SettingsDiscordPrefs>;
    setIntegrationPrefs: StateSetter<SettingsIntegrationPrefs>;
    setLocalFavoriteFriendsGroups: (value: string[]) => void;
    setLocalFavoriteFriendsGroupsPreference: (
        value: unknown
    ) => Promise<string[]>;
    setOnlineVisitCount: (value: number) => void;
    setPrefs: StateSetter<SettingsPrefs>;
    setProxyEnabledPreference: (value: boolean) => Promise<boolean>;
    setSqliteTableSizes: (value: Record<string, unknown>) => void;
    setStringConfigPreference: (
        key: StringConfigPreferenceKey,
        value: string
    ) => Promise<unknown>;
    setTableLimitsDialogOpen: (value: boolean) => void;
    setTableLimitsDraft: (value: {
        maxTableSize: string;
        searchLimit: string;
    }) => void;
    setTableLimitsPreference: (value: {
        maxTableSize: number;
        searchLimit: number;
    }) => Promise<PreferencesSnapshot['tableLimits']>;
    setTablePageSizesDialogOpen: (value: boolean) => void;
    setTrustColorPreference: (
        key: TrustColorKey,
        value: unknown
    ) => Promise<PreferencesSnapshot['trustColor']>;
    setOverlayActivityFiltersPreference: (
        value: unknown,
        definitions?: OverlayActivityTypeDefinition[]
    ) => Promise<PreferencesSnapshot['overlayActivityFilters']>;
    setVrNotificationActivityFiltersPreference: (
        value: unknown
    ) => Promise<PreferencesSnapshot['vrNotificationActivityFilters']>;
    setHmdNotificationActivityFiltersPreference: (
        value: unknown
    ) => Promise<PreferencesSnapshot['hmdNotificationActivityFilters']>;
    setDesktopNotificationActivityFiltersPreference: (
        value: unknown
    ) => Promise<PreferencesSnapshot['desktopNotificationActivityFilters']>;
    setWebhookActivityFiltersPreference: (
        value: unknown
    ) => Promise<PreferencesSnapshot['webhookActivityFilters']>;
    setTtsNotificationActivityFiltersPreference: (
        value: unknown
    ) => Promise<PreferencesSnapshot['ttsNotificationActivityFilters']>;
    setWristOverlayEnabledPreference: (value: boolean) => Promise<boolean>;
    t: (key: string) => string;
    tableLimitsDraft: {
        maxTableSize: string;
        searchLimit: string;
    };
    tableLimitsSaveDisabled: boolean;
    toast: {
        error(message: string): unknown;
        success(message: string): unknown;
        warning(message: string): unknown;
    };
    usePreferencesStore: {
        getState(): Pick<PreferencesStoreState, 'proxyServer' | 'tableLimits'>;
    };
    vrchatAuthRepository: {
        getConfig(options: { endpoint: string }): Promise<{ json: unknown }>;
        getOnlineVisits(options: {
            endpoint: string;
        }): Promise<{ json: unknown }>;
    };
};

type FontPreferencesInput = Partial<{
    cjkFontPack: unknown;
    customFontFamily: unknown;
    fontFamily: unknown;
}>;

type ActivityFilterSurfaceField =
    | 'overlayActivityFilters'
    | 'vrNotificationActivityFilters'
    | 'hmdNotificationActivityFilters'
    | 'desktopNotificationActivityFilters'
    | 'webhookActivityFilters'
    | 'ttsNotificationActivityFilters';

type ActivityFilterSurfaceSetter<Field extends ActivityFilterSurfaceField> = (
    value: unknown,
    definitions?: OverlayActivityTypeDefinition[]
) => Promise<PreferencesSnapshot[Field]>;

function readCustomFontDraft(value: unknown): Partial<CustomFontDraft> {
    return value && typeof value === 'object'
        ? (value as Partial<CustomFontDraft>)
        : {};
}

export function useSettingsPreferenceActions({
    APP_FONT_DEFAULT_KEY,
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT,
    applyAppFontPreferences,
    auth,
    commit,
    configRepository,
    customFontDraft,
    databaseMaintenanceRepository,
    isValidFontFamilyList,
    loadTrustColorPreference,
    localFavoriteFriendsGroups,
    normalizeAppCjkFontPack,
    normalizeAppFontFamily,
    normalizePreferenceSnapshot,
    parseIntegerInput,
    prefs,
    resetTrustColorsPreference,
    setBoolConfigPreference,
    setConfigTreeData,
    setCustomFontDialogOpen,
    setCustomFontDraft,
    setCustomFontOptions,
    setCustomFontOptionsLoading,
    setDiscordPrefs,
    setIntegrationPrefs,
    setLocalFavoriteFriendsGroups,
    setLocalFavoriteFriendsGroupsPreference,
    setOnlineVisitCount,
    setPrefs,
    setProxyEnabledPreference,
    setSqliteTableSizes,
    setStringConfigPreference,
    setTableLimitsDialogOpen,
    setTableLimitsDraft,
    setTableLimitsPreference,
    setTablePageSizesDialogOpen,
    setTrustColorPreference,
    setOverlayActivityFiltersPreference,
    setVrNotificationActivityFiltersPreference,
    setHmdNotificationActivityFiltersPreference,
    setDesktopNotificationActivityFiltersPreference,
    setWebhookActivityFiltersPreference,
    setTtsNotificationActivityFiltersPreference,
    setWristOverlayEnabledPreference,
    t,
    tableLimitsDraft,
    tableLimitsSaveDisabled,
    toast,
    usePreferencesStore,
    vrchatAuthRepository
}: SettingsPreferenceActionsDeps) {
    function applyPreferenceSnapshotToLocalState(snapshot: unknown) {
        const normalizedSnapshot = normalizePreferenceSnapshot(snapshot);
        setPrefs((current) => ({
            ...current,
            ...normalizedSnapshot
        }));
        setIntegrationPrefs((current) => ({
            ...current,
            youtubeAPI: normalizedSnapshot.youtubeAPI,
            translationAPI: normalizedSnapshot.translationAPI,
            bioLanguage:
                normalizedSnapshot.bioLanguage as SettingsIntegrationPrefs['bioLanguage'],
            translationAPIType: normalizedSnapshot.translationAPIType,
            translationEndpointId:
                normalizedSnapshot.translationEndpointId as SettingsIntegrationPrefs['translationEndpointId'],
            translationAPIEndpoint:
                normalizedSnapshot.translationAPIEndpoint as SettingsIntegrationPrefs['translationAPIEndpoint'],
            translationAPIModel:
                normalizedSnapshot.translationAPIModel as SettingsIntegrationPrefs['translationAPIModel'],
            translationAPIPrompt: normalizedSnapshot.translationAPIPrompt
        }));
        setDiscordPrefs({
            discordActive: normalizedSnapshot.discordActive,
            discordInstance: normalizedSnapshot.discordInstance,
            discordHideInvite: normalizedSnapshot.discordHideInvite,
            discordJoinButton: normalizedSnapshot.discordJoinButton,
            discordHideImage: normalizedSnapshot.discordHideImage,
            discordShowPlatform: normalizedSnapshot.discordShowPlatform,
            discordWorldIntegration: normalizedSnapshot.discordWorldIntegration,
            discordWorldNameAsDiscordStatus:
                normalizedSnapshot.discordWorldNameAsDiscordStatus
        });
        setLocalFavoriteFriendsGroups(
            normalizedSnapshot.localFavoriteFriendsGroups
        );
    }
    async function savePreferenceValue<K extends PreferenceKey>(
        key: K,
        value: PreferencesSnapshot[K],
        action: PreferenceAction
    ) {
        return commit(action, () => {
            const previous = prefs[key] as unknown as PreferencesSnapshot[K];
            setPrefs((current) => ({
                ...current,
                [key]: value
            }));
            return () =>
                setPrefs((current) => ({
                    ...current,
                    [key]: previous
                }));
        });
    }
    async function saveBoolPreference(
        key: BoolPreferenceKey,
        configKey: BoolConfigPreferenceKey,
        value: boolean
    ) {
        const enabled = value === true;
        await savePreferenceValue(
            key,
            enabled as PreferencesSnapshot[typeof key],
            () => setBoolConfigPreference(configKey, enabled)
        );
    }
    async function saveStringPreference(
        key: StringPreferenceKey,
        configKey: StringConfigPreferenceKey,
        value: string
    ) {
        await savePreferenceValue(
            key,
            value as PreferencesSnapshot[typeof key],
            () => setStringConfigPreference(configKey, value)
        );
    }
    async function saveFontPreferences({
        fontFamily = prefs.appFontFamily,
        cjkFontPack = prefs.appCjkFontPack,
        customFontFamily = prefs.customFontFamily
    }: FontPreferencesInput = {}) {
        const nextFontFamily = normalizeAppFontFamily(fontFamily);
        const nextCjkFontPack = normalizeAppCjkFontPack(cjkFontPack);
        await configRepository.setMany([
            ['VRCX_fontFamily', nextFontFamily],
            ['VRCX_cjkFontPack', nextCjkFontPack]
        ]);
        setPrefs((current) => ({
            ...current,
            appFontFamily: nextFontFamily,
            appCjkFontPack: nextCjkFontPack
        }));
        applyAppFontPreferences({
            fontFamily: nextFontFamily,
            customFontFamily,
            cjkFontPack: nextCjkFontPack
        });
    }
    async function saveFontFamilyPreference(
        fontFamily: unknown,
        customFontFamily: unknown = prefs.customFontFamily
    ) {
        await saveFontPreferences({
            fontFamily,
            customFontFamily
        });
    }
    async function selectCjkFontPack(cjkFontPack: unknown) {
        await saveFontPreferences({
            fontFamily:
                prefs.appFontFamily === 'custom'
                    ? APP_FONT_DEFAULT_KEY
                    : prefs.appFontFamily,
            cjkFontPack
        });
    }
    function openCustomFontDialog() {
        setCustomFontDraft(createCustomFontDraftFromPrefs(prefs));
        setCustomFontDialogOpen(true);
        setCustomFontOptionsLoading(true);
        loadSystemFonts()
            .then((fonts) => {
                setCustomFontOptions(fonts);
                if (consumeSystemFontsUnavailableWarning(fonts)) {
                    toast.warning(
                        t(
                            'view.settings.appearance.appearance.font_family_custom_detection_unavailable_toast'
                        )
                    );
                }
            })
            .finally(() => {
                setCustomFontOptionsLoading(false);
            });
    }
    async function saveCustomFontFamily(value: unknown = customFontDraft) {
        const draft = readCustomFontDraft(value);
        const nextDraft: CustomFontDraft = {
            primary: String(draft.primary ?? '').trim(),
            secondary: String(draft.secondary ?? '').trim(),
            override: String(draft.override ?? '').trim()
        };
        const nextValue = composeCustomFontFamily(nextDraft);
        if (!isValidFontFamilyList(nextValue)) {
            toast.error(
                t(
                    'view.settings.appearance.appearance.font_family_custom_invalid'
                )
            );
            return;
        }
        const previousFontFamily = prefs.appFontFamily;
        const previousCustomFontFamily = prefs.customFontFamily;
        const previousCustomFontPrimary = prefs.customFontPrimary;
        const previousCustomFontSecondary = prefs.customFontSecondary;
        const previousCustomFontOverride = prefs.customFontOverride;
        const saved = await commit(
            () =>
                configRepository.setMany([
                    ['customFontPrimary', nextDraft.primary],
                    ['customFontSecondary', nextDraft.secondary],
                    ['customFontOverride', nextDraft.override],
                    ['customFontFamily', nextValue],
                    ['VRCX_fontFamily', 'custom']
                ]),
            () => {
                setPrefs((current) => ({
                    ...current,
                    appFontFamily: 'custom',
                    customFontFamily: nextValue,
                    customFontPrimary: nextDraft.primary,
                    customFontSecondary: nextDraft.secondary,
                    customFontOverride: nextDraft.override
                }));
                applyAppFontPreferences({
                    fontFamily: 'custom',
                    customFontFamily: nextValue,
                    cjkFontPack: prefs.appCjkFontPack
                });
                return () => {
                    setPrefs((current) => ({
                        ...current,
                        appFontFamily: previousFontFamily,
                        customFontFamily: previousCustomFontFamily,
                        customFontPrimary: previousCustomFontPrimary,
                        customFontSecondary: previousCustomFontSecondary,
                        customFontOverride: previousCustomFontOverride
                    }));
                    applyAppFontPreferences({
                        fontFamily: previousFontFamily,
                        customFontFamily: previousCustomFontFamily,
                        cjkFontPack: prefs.appCjkFontPack
                    });
                };
            }
        );
        if (!saved) {
            return;
        }
        setCustomFontDialogOpen(false);
        toast.success(t('common.settings_saved'));
    }
    async function restorePersistedTrustColors() {
        const persisted = await loadTrustColorPreference();
        setPrefs((current) => ({
            ...current,
            trustColor: persisted
        }));
    }
    async function saveTrustColor(key: TrustColorKey, value: unknown) {
        try {
            const nextTrustColor = await setTrustColorPreference(key, value);
            setPrefs((current) => ({
                ...current,
                trustColor: nextTrustColor
            }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_save_trust_color')
            );
            await restorePersistedTrustColors();
        }
    }
    async function resetTrustColors() {
        try {
            const nextTrustColor = await resetTrustColorsPreference();
            setPrefs((current) => ({
                ...current,
                trustColor: nextTrustColor
            }));
            toast.success(t('common.settings_saved'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_save_trust_color')
            );
        }
    }
    async function refreshSqliteTableSizes() {
        try {
            const sizes = await databaseMaintenanceRepository.getTableSizes(
                auth.currentUserId
            );
            setSqliteTableSizes({
                gps: sizes.gps,
                status: sizes.status,
                bio: sizes.bio,
                avatar: sizes.avatar,
                onlineOffline: sizes.onlineOffline,
                friendLogHistory: sizes.friendLogHistory,
                notification: sizes.notification,
                location: sizes.location,
                joinLeave: sizes.joinLeave,
                portalSpawn: sizes.portalSpawn,
                videoPlay: sizes.videoPlay,
                event: sizes.event,
                external: sizes.external
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.toast.failed_to_refresh_sqlite_table_sizes'
                      )
            );
        }
    }
    async function refreshConfigTreeData() {
        try {
            const response = await vrchatAuthRepository.getConfig({
                endpoint: auth.currentUserEndpoint || ''
            });
            setConfigTreeData(
                response.json && typeof response.json === 'object'
                    ? (response.json as Record<string, unknown>)
                    : {}
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_refresh_config_json')
            );
        }
    }
    async function refreshOnlineVisits() {
        try {
            const response = await vrchatAuthRepository.getOnlineVisits({
                endpoint: auth.currentUserEndpoint || ''
            });
            setOnlineVisitCount(Number(response.json) || 0);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.toast.failed_to_refresh_online_user_count'
                      )
            );
        }
    }
    async function openTablePageSizesDialog() {
        setTablePageSizesDialogOpen(true);
    }
    async function openTableLimitsDialog() {
        const { maxTableSize, searchLimit } =
            usePreferencesStore.getState().tableLimits;
        setTableLimitsDraft({
            maxTableSize: String(
                parseIntegerInput(maxTableSize, DEFAULT_MAX_TABLE_SIZE)
            ),
            searchLimit: String(
                parseIntegerInput(searchLimit, DEFAULT_SEARCH_LIMIT)
            )
        });
        setTableLimitsDialogOpen(true);
    }
    async function saveTableLimitsDialog() {
        if (tableLimitsSaveDisabled) {
            return;
        }
        const nextMaxTableSize = Number.parseInt(
            tableLimitsDraft.maxTableSize,
            10
        );
        const nextSearchLimit = Number.parseInt(
            tableLimitsDraft.searchLimit,
            10
        );
        let savedLimits:
            | Awaited<ReturnType<typeof setTableLimitsPreference>>
            | undefined;
        const saved = await commit(async () => {
            savedLimits = await setTableLimitsPreference({
                maxTableSize: nextMaxTableSize,
                searchLimit: nextSearchLimit
            });
        });
        if (!saved) {
            return;
        }
        setPrefs((current) => ({
            ...current,
            tableLimits: savedLimits
        }));
        setTableLimitsDialogOpen(false);
        toast.success(t('common.settings_saved'));
    }
    async function toggleLocalFavoriteFriendsGroup(
        groupKey: string,
        checked: boolean
    ) {
        const previousGroups = localFavoriteFriendsGroups;
        const nextGroups = checked
            ? Array.from(new Set([...localFavoriteFriendsGroups, groupKey]))
            : localFavoriteFriendsGroups.filter((value) => value !== groupKey);
        await commit(
            () => setLocalFavoriteFriendsGroupsPreference(nextGroups),
            () => {
                setLocalFavoriteFriendsGroups(nextGroups);
                return () => {
                    setLocalFavoriteFriendsGroups(previousGroups);
                };
            }
        );
    }
    function makeSaveActivityFilterSurface<
        Field extends ActivityFilterSurfaceField
    >(field: Field, setPreference: ActivityFilterSurfaceSetter<Field>) {
        return async function saveActivityFilterSurface(
            value: unknown,
            definitions?: OverlayActivityTypeDefinition[]
        ) {
            let savedFilters: PreferencesSnapshot[Field] | undefined;
            const previousFilters = prefs[field];
            const saved = await commit(
                async () => {
                    savedFilters = await setPreference(value, definitions);
                },
                () => {
                    setPrefs((current) => ({
                        ...current,
                        [field]: value as PreferencesSnapshot[Field]
                    }));
                    return () =>
                        setPrefs((current) => ({
                            ...current,
                            [field]: previousFilters
                        }));
                }
            );
            if (!saved) {
                return null;
            }
            setPrefs((current) => ({
                ...current,
                [field]: savedFilters as PreferencesSnapshot[Field]
            }));
            toast.success(t('common.settings_saved'));
            return savedFilters;
        };
    }
    const saveOverlayActivityFilters = makeSaveActivityFilterSurface(
        'overlayActivityFilters',
        setOverlayActivityFiltersPreference
    );
    const saveVrNotificationActivityFilters = makeSaveActivityFilterSurface(
        'vrNotificationActivityFilters',
        setVrNotificationActivityFiltersPreference
    );
    const saveHmdNotificationActivityFilters = makeSaveActivityFilterSurface(
        'hmdNotificationActivityFilters',
        setHmdNotificationActivityFiltersPreference
    );
    const saveDesktopNotificationActivityFilters =
        makeSaveActivityFilterSurface(
            'desktopNotificationActivityFilters',
            setDesktopNotificationActivityFiltersPreference
        );
    const saveWebhookActivityFilters = makeSaveActivityFilterSurface(
        'webhookActivityFilters',
        setWebhookActivityFiltersPreference
    );
    const saveTtsNotificationActivityFilters = makeSaveActivityFilterSurface(
        'ttsNotificationActivityFilters',
        setTtsNotificationActivityFiltersPreference
    );
    async function saveWristOverlayEnabled(value: boolean) {
        let savedValue = value === true;
        const previousValue = prefs.wristOverlayEnabled;
        const saved = await commit(
            async () => {
                savedValue = await setWristOverlayEnabledPreference(savedValue);
            },
            () => {
                setPrefs((current) => ({
                    ...current,
                    wristOverlayEnabled: savedValue
                }));
                return () =>
                    setPrefs((current) => ({
                        ...current,
                        wristOverlayEnabled: previousValue
                    }));
            }
        );
        if (!saved) {
            return null;
        }
        setPrefs((current) => ({
            ...current,
            wristOverlayEnabled: savedValue
        }));
        return savedValue;
    }
    function speakNotificationTts(
        text: string,
        voiceId: string = prefs.notificationTTSVoiceNative
    ) {
        commands
            .appHostTtsSpeak(text, voiceId || null)
            .catch((error: unknown) => {
                console.warn('Failed to play notification TTS', error);
                toast.warning(
                    t(
                        'view.settings.notifications.notifications.text_to_speech.tts_test_failed'
                    )
                );
            });
    }
    return {
        applyPreferenceSnapshotToLocalState,
        commit,
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
        setProxyEnabledPreference,
        openTablePageSizesDialog,
        openTableLimitsDialog,
        saveTableLimitsDialog,
        toggleLocalFavoriteFriendsGroup,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveHmdNotificationActivityFilters,
        saveDesktopNotificationActivityFilters,
        saveWebhookActivityFilters,
        saveTtsNotificationActivityFilters,
        saveWristOverlayEnabled,
        speakNotificationTts
    };
}
