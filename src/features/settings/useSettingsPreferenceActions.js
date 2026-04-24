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
    setAppLauncherPreference,
    setBoolConfigPreference,
    setConfigTreeData,
    setCustomFontDialogOpen,
    setCustomFontDraft,
    setDiscordPrefs,
    setIntegrationPrefs,
    setLocalFavoriteFriendsGroups,
    setLocalFavoriteFriendsGroupsPreference,
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
    t,
    tableLimitsDraft,
    tableLimitsSaveDisabled,
    toast,
    usePreferencesStore,
    vrchatAuthRepository
}) {
    function applyPreferenceSnapshotToLocalState(snapshot) {
        const normalizedSnapshot = normalizePreferenceSnapshot(snapshot);
        setPrefs((current) => ({
            ...current,
            ...normalizedSnapshot
        }));
        setIntegrationPrefs((current) => ({
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
    async function savePreferenceValue(key, value, action) {
        await commit(action, () => {
            const previous = prefs[key];
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
    async function saveBoolPreference(key, configKey, value) {
        await savePreferenceValue(key, value, () =>
            setBoolConfigPreference(configKey, value)
        );
    }
    async function saveStringPreference(key, configKey, value) {
        await savePreferenceValue(key, value, () =>
            setStringConfigPreference(configKey, value)
        );
    }
    async function saveFontPreferences({
        fontFamily = prefs.appFontFamily,
        cjkFontPack = prefs.appCjkFontPack,
        customFontFamily = prefs.customFontFamily
    } = {}) {
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
        fontFamily,
        customFontFamily = prefs.customFontFamily
    ) {
        await saveFontPreferences({
            fontFamily,
            customFontFamily
        });
    }
    async function selectCjkFontPack(cjkFontPack) {
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
    async function saveCustomFontFamily(value = customFontDraft) {
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
                setPrefs((current) => ({
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
                    setPrefs((current) => ({
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
        setPrefs((current) => ({
            ...current,
            trustColor: persisted
        }));
    }
    async function saveTrustColor(key, value) {
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
                    : t(
                          'view.settings.generated_toast.failed_to_save_trust_color'
                      )
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
                    : t(
                          'view.settings.generated_toast.failed_to_save_trust_color'
                      )
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
                          'view.settings.generated_toast.failed_to_refresh_sqlite_table_sizes'
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
                    : t(
                          'view.settings.generated_toast.failed_to_refresh_config_json'
                      )
            );
        }
    }
    async function refreshOnlineVisits() {
        try {
            const response = await vrchatAuthRepository.executeGet('visits', {
                endpoint: auth.currentUserEndpoint || ''
            });
            setOnlineVisitCount(Number(response.json) || 0);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.generated_toast.failed_to_refresh_online_user_count'
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
                    : t(
                          'view.settings.generated_toast.failed_to_load_proxy_settings'
                      )
            );
            return;
        }
        const nextProxyServer = String(result.value ?? '').trim();
        try {
            const proxyServer = await setProxyServerPreference(nextProxyServer);
            setPrefs((current) => ({
                ...current,
                proxyServer
            }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.generated_toast.failed_to_save_proxy_settings'
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
        setPrefs((current) => ({
            ...current,
            tableLimits: savedLimits
        }));
        setTableLimitsDialogOpen(false);
        toast.success(t('common.settings_saved'));
    }
    async function toggleLocalFavoriteFriendsGroup(groupKey, checked) {
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
    async function saveAppLauncherField(key, value) {
        const nextPrefs = {
            ...prefs,
            [key]: value
        };
        await savePreferenceValue(key, value, () =>
            setAppLauncherPreference({
                enabled: nextPrefs.enableAppLauncher,
                autoClose: nextPrefs.enableAppLauncherAutoClose,
                runProcessOnce: nextPrefs.enableAppLauncherRunProcessOnce
            })
        );
    }
    function speakNotificationTts(
        text,
        voiceIndex = Number.parseInt(prefs.notificationTTSVoice, 10) || 0
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
                t(
                    'view.settings.generated.no_text_to_speech_voices_are_available'
                )
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
        saveAppLauncherField,
        speakNotificationTts
    };
}
