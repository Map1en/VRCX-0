import type {
    BoolConfigPreferenceKey,
    StringConfigPreferenceKey
} from '@/services/preferencesService';
import {
    consumeSystemFontsUnavailableWarning,
    loadSystemFonts
} from '@/services/systemFontsService';
import type { PreferencesSnapshot } from '@/state/preferencesStore';

import {
    composeCustomFontFamily,
    createCustomFontDraftFromPrefs,
    type CustomFontDraft
} from './settingsValues';

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
type SettingsPrefs = PreferencesSnapshot & Record<string, unknown>;
type SetSettingsPrefs = (
    updater: (current: SettingsPrefs) => SettingsPrefs | Record<string, unknown>
) => void;
type SettingsPreferenceActionsDeps = Record<string, any> & {
    commit: (
        action: PreferenceAction,
        optimistic?: () => PreferenceRollback
    ) => Promise<boolean>;
    prefs: SettingsPrefs;
    setBoolConfigPreference: (
        key: BoolConfigPreferenceKey,
        value: boolean
    ) => Promise<unknown>;
    setPrefs: SetSettingsPrefs;
    setStringConfigPreference: (
        key: StringConfigPreferenceKey,
        value: string
    ) => Promise<unknown>;
};

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
    prompt,
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
    setOverlayActivityFiltersPreference,
    setOnlineVisitCount,
    setPrefs,
    setProxyServerPreference,
    setSharedFeedFilters,
    setSqliteTableSizes,
    setStringConfigPreference,
    setTableLimitsDialogOpen,
    setTableLimitsDraft,
    setTableLimitsPreference,
    setTablePageSizesDialogOpen,
    setTrustColorPreference,
    setVrNotificationActivityFiltersPreference,
    setDesktopNotificationActivityFiltersPreference,
    setWebhookActivityFiltersPreference,
    setWristOverlayEnabledPreference,
    t,
    tableLimitsDraft,
    tableLimitsSaveDisabled,
    toast,
    usePreferencesStore,
    vrchatAuthRepository
}: SettingsPreferenceActionsDeps) {
    function applyPreferenceSnapshotToLocalState(snapshot: any) {
        const normalizedSnapshot = normalizePreferenceSnapshot(snapshot);
        setPrefs((current: any) => ({
            ...current,
            ...normalizedSnapshot
        }));
        setIntegrationPrefs((current: any) => ({
            ...current,
            youtubeAPI: normalizedSnapshot.youtubeAPI,
            translationAPI: normalizedSnapshot.translationAPI,
            bioLanguage: normalizedSnapshot.bioLanguage,
            translationAPIType: normalizedSnapshot.translationAPIType,
            translationAPIEndpoint: normalizedSnapshot.translationAPIEndpoint,
            translationAPIModel: normalizedSnapshot.translationAPIModel,
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
        setSharedFeedFilters(normalizedSnapshot.sharedFeedFilters);
        setLocalFavoriteFriendsGroups(
            normalizedSnapshot.localFavoriteFriendsGroups
        );
    }
    async function savePreferenceValue<K extends PreferenceKey>(
        key: K,
        value: PreferencesSnapshot[K],
        action: PreferenceAction
    ) {
        await commit(action, () => {
            const previous = prefs[key];
            setPrefs((current: any) => ({
                ...current,
                [key]: value
            }));
            return () =>
                setPrefs((current: any) => ({
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
    }: any = {}) {
        const nextFontFamily = normalizeAppFontFamily(fontFamily);
        const nextCjkFontPack = normalizeAppCjkFontPack(cjkFontPack);
        await configRepository.setMany([
            ['VRCX_fontFamily', nextFontFamily],
            ['VRCX_cjkFontPack', nextCjkFontPack]
        ]);
        setPrefs((current: any) => ({
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
        fontFamily: any,
        customFontFamily: any = prefs.customFontFamily
    ) {
        await saveFontPreferences({
            fontFamily,
            customFontFamily
        });
    }
    async function selectCjkFontPack(cjkFontPack: any) {
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
    async function saveCustomFontFamily(value: any = customFontDraft) {
        const nextDraft: CustomFontDraft = {
            primary: String(value?.primary ?? '').trim(),
            secondary: String(value?.secondary ?? '').trim(),
            override: String(value?.override ?? '').trim()
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
                setPrefs((current: any) => ({
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
                    setPrefs((current: any) => ({
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
        setPrefs((current: any) => ({
            ...current,
            trustColor: persisted
        }));
    }
    async function saveTrustColor(key: any, value: any) {
        try {
            const nextTrustColor = await setTrustColorPreference(key, value);
            setPrefs((current: any) => ({
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
            setPrefs((current: any) => ({
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
                    ? response.json
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
    async function promptProxySettings() {
        let result;
        try {
            result = await prompt({
                title: t('view.settings.general.application.proxy'),
                description: t(
                    'view.settings.general.application.proxy_description'
                ),
                inputValue: usePreferencesStore.getState().proxyServer || '',
                confirmText: t('prompt.proxy_settings.restart'),
                cancelText: t('dialog.alertdialog.cancel')
            });
            if (!result.ok) {
                return;
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_load_proxy_settings')
            );
            return;
        }
        const nextProxyServer = String(result.value ?? '').trim();
        try {
            const proxyServer = await setProxyServerPreference(nextProxyServer);
            setPrefs((current: any) => ({
                ...current,
                proxyServer
            }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_save_proxy_settings')
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
        setPrefs((current: any) => ({
            ...current,
            tableLimits: savedLimits
        }));
        setTableLimitsDialogOpen(false);
        toast.success(t('common.settings_saved'));
    }
    async function toggleLocalFavoriteFriendsGroup(
        groupKey: any,
        checked: any
    ) {
        const previousGroups = localFavoriteFriendsGroups;
        const nextGroups = checked
            ? Array.from(new Set([...localFavoriteFriendsGroups, groupKey]))
            : localFavoriteFriendsGroups.filter(
                  (value: any) => value !== groupKey
              );
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
    async function saveOverlayActivityFilters(value: any, definitions?: any) {
        let savedFilters:
            | Awaited<ReturnType<typeof setOverlayActivityFiltersPreference>>
            | undefined;
        const previousFilters = prefs.overlayActivityFilters;
        const saved = await commit(
            async () => {
                savedFilters = await setOverlayActivityFiltersPreference(
                    value,
                    definitions
                );
            },
            () => {
                setPrefs((current: any) => ({
                    ...current,
                    overlayActivityFilters: value
                }));
                return () =>
                    setPrefs((current: any) => ({
                        ...current,
                        overlayActivityFilters: previousFilters
                    }));
            }
        );
        if (!saved) {
            return null;
        }
        setPrefs((current: any) => ({
            ...current,
            overlayActivityFilters: savedFilters
        }));
        toast.success(t('common.settings_saved'));
        return savedFilters;
    }
    function makeSaveActivityFilterSurface(
        field:
            | 'vrNotificationActivityFilters'
            | 'desktopNotificationActivityFilters'
            | 'webhookActivityFilters',
        setPreference: (value: any) => Promise<any>
    ) {
        return async function saveActivityFilterSurface(value: any) {
            let savedFilters: Awaited<ReturnType<typeof setPreference>>;
            const previousFilters = prefs[field];
            const saved = await commit(
                async () => {
                    savedFilters = await setPreference(value);
                },
                () => {
                    setPrefs((current: any) => ({
                        ...current,
                        [field]: value
                    }));
                    return () =>
                        setPrefs((current: any) => ({
                            ...current,
                            [field]: previousFilters
                        }));
                }
            );
            if (!saved) {
                return null;
            }
            setPrefs((current: any) => ({ ...current, [field]: savedFilters }));
            toast.success(t('common.settings_saved'));
            return savedFilters;
        };
    }
    const saveVrNotificationActivityFilters = makeSaveActivityFilterSurface(
        'vrNotificationActivityFilters',
        setVrNotificationActivityFiltersPreference
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
    async function saveWristOverlayEnabled(value: boolean) {
        let savedValue = value === true;
        const previousValue = prefs.wristOverlayEnabled;
        const saved = await commit(
            async () => {
                savedValue = await setWristOverlayEnabledPreference(savedValue);
            },
            () => {
                setPrefs((current: any) => ({
                    ...current,
                    wristOverlayEnabled: savedValue
                }));
                return () =>
                    setPrefs((current: any) => ({
                        ...current,
                        wristOverlayEnabled: previousValue
                    }));
            }
        );
        if (!saved) {
            return null;
        }
        setPrefs((current: any) => ({
            ...current,
            wristOverlayEnabled: savedValue
        }));
        return savedValue;
    }
    function speakNotificationTts(
        text: any,
        voiceIndex: any = Number.parseInt(prefs.notificationTTSVoice, 10) || 0
    ) {
        if (
            typeof window === 'undefined' ||
            !window.speechSynthesis ||
            !window.SpeechSynthesisUtterance
        ) {
            return;
        }
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) {
            toast.warning(
                t('view.settings.empty.no_text_to_speech_voices_are_available')
            );
            return;
        }
        const utterance = new window.SpeechSynthesisUtterance();
        utterance.voice =
            voices[Math.min(Math.max(voiceIndex, 0), voices.length - 1)];
        utterance.text = text || 'Notification text-to-speech test';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
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
        promptProxySettings,
        openTablePageSizesDialog,
        openTableLimitsDialog,
        saveTableLimitsDialog,
        toggleLocalFavoriteFriendsGroup,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveDesktopNotificationActivityFilters,
        saveWebhookActivityFilters,
        saveWristOverlayEnabled,
        speakNotificationTts
    };
}
