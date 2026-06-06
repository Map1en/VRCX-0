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
    setWristOverlayEnabledPreference,
    t,
    tableLimitsDraft,
    tableLimitsSaveDisabled,
    toast,
    usePreferencesStore,
    vrchatAuthRepository
}: any) {
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
    async function savePreferenceValue(key: any, value: any, action: any) {
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
    async function saveBoolPreference(key: any, configKey: any, value: any) {
        await savePreferenceValue(key, value, () =>
            setBoolConfigPreference(configKey, value)
        );
    }
    async function saveStringPreference(key: any, configKey: any, value: any) {
        await savePreferenceValue(key, value, () =>
            setStringConfigPreference(configKey, value)
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
        setCustomFontDraft(
            prefs.customFontFamily || "'My Font', Arial, sans-serif"
        );
        setCustomFontDialogOpen(true);
    }
    async function saveCustomFontFamily(value: any = customFontDraft) {
        const nextValue = String(value ?? '').trim();
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
        const saved = await commit(
            () =>
                configRepository.setMany([
                    ['customFontFamily', nextValue],
                    ['VRCX_fontFamily', 'custom']
                ]),
            () => {
                setPrefs((current: any) => ({
                    ...current,
                    appFontFamily: 'custom',
                    customFontFamily: nextValue
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
                        customFontFamily: previousCustomFontFamily
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
        let savedLimits;
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
        let savedFilters;
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
    async function saveVrNotificationActivityFilters(value: any) {
        let savedFilters;
        const previousFilters = prefs.vrNotificationActivityFilters;
        const saved = await commit(
            async () => {
                savedFilters =
                    await setVrNotificationActivityFiltersPreference(value);
            },
            () => {
                setPrefs((current: any) => ({
                    ...current,
                    vrNotificationActivityFilters: value
                }));
                return () =>
                    setPrefs((current: any) => ({
                        ...current,
                        vrNotificationActivityFilters: previousFilters
                    }));
            }
        );
        if (!saved) {
            return null;
        }
        setPrefs((current: any) => ({
            ...current,
            vrNotificationActivityFilters: savedFilters
        }));
        toast.success(t('common.settings_saved'));
        return savedFilters;
    }
    async function saveWristOverlayEnabled(value: any) {
        let savedValue = Boolean(value);
        const previousValue = prefs.wristOverlayEnabled;
        const saved = await commit(
            async () => {
                savedValue = await setWristOverlayEnabledPreference(value);
            },
            () => {
                setPrefs((current: any) => ({
                    ...current,
                    wristOverlayEnabled: Boolean(value)
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
        saveWristOverlayEnabled,
        speakNotificationTts
    };
}
