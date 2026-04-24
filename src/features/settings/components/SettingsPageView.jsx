export function SettingsPageView({
    PageHeader,
    PageTitle,
    t,
    Tabs,
    activeSettingsTab,
    setActiveSettingsTab,
    TabsList,
    settingsTabs,
    TabsTrigger,
    loading,
    Spinner,
    SettingsSystemTab,
    formatReleaseDisplayVersion,
    prefs,
    openExternalLink,
    savePreferenceValue,
    setStartAtWindowsStartupPreference,
    setStartAsMinimizedPreference,
    setCloseToTrayPreference,
    promptProxySettings,
    setOpenSourceNoticeOpen,
    SettingsInterfaceTab,
    locale,
    zoomInput,
    zoomLevel,
    commit,
    setAppLanguagePreference,
    openCustomFontDialog,
    saveFontFamilyPreference,
    selectCjkFontPack,
    setZoomInput,
    setZoomLevelPreference,
    saveBoolPreference,
    setDataTableStripedPreference,
    setPointerOnHoverPreference,
    setAccessibleStatusIndicatorsPreference,
    setShowNewDashboardButtonPreference,
    openTablePageSizesDialog,
    openTableLimitsDialog,
    setIntConfigPreference,
    resetTrustColors,
    saveTrustColor,
    setPrefs,
    SettingsMediaTab,
    setScreenshotHelperPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperCopyToClipboardPreference,
    deleteAllScreenshotMetadata,
    backend,
    openUgcFolderSelector,
    resetUgcFolder,
    setSaveInstancePrintsPreference,
    handleCropInstancePrintsChange,
    setSaveInstanceStickersPreference,
    setSaveInstanceEmojiPreference,
    SettingsIntegrationsTab,
    discordPrefs,
    integrationPrefs,
    avatarProviderConfig,
    setSystemHostOpen,
    saveDiscordBoolPreference,
    setTranslationApiEnabledPreference,
    setIntegrationValue,
    openTranslationApiDialog,
    setYoutubeApiEnabledPreference,
    openYoutubeApiDialog,
    saveAvatarProviderConfig,
    avatarProviderConfigRef,
    applyAvatarProviderConfig,
    setAvatarProviderDialogOpen,
    SettingsSocialTab,
    selectedFavoriteFriendGroupLabel,
    favoriteFriendGroupOptions,
    remoteFavoriteFriendGroupOptions,
    localFavoriteFriendGroupOptions,
    localFavoriteFriendsGroups,
    setRecentActionCooldownEnabledPreference,
    setRecentActionCooldownMinutesPreference,
    toggleLocalFavoriteFriendsGroup,
    SettingsNotificationsTab,
    notificationLayoutOptions,
    desktopToastOptions,
    notificationTtsOptions,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    setNotificationLayoutPreference,
    setFeedFilterDialogOpen,
    saveStringPreference,
    saveNotificationTtsMode,
    saveNotificationTtsVoice,
    setNotificationTtsTestVisible,
    setNotificationTtsTest,
    speakNotificationTts,
    SettingsAdvancedTab,
    cacheStats,
    avatarAutoCleanupOptions,
    sqliteTableSizes,
    sqliteTableSizeRows,
    onlineVisitCount,
    configTreeData,
    promptAutoLoginDelaySeconds,
    saveAppLauncherField,
    clearVrcxCache,
    promptAutoClearVrcxCacheFrequency,
    refreshCacheSize,
    handleGameLogDisabledChange,
    setPurgeDialogOpen,
    refreshSqliteTableSizes,
    refreshOnlineVisits,
    refreshConfigTreeData,
    setConfigTreeData,
    SettingsDialogs,
    customFontDialogOpen,
    setCustomFontDialogOpen,
    customFontDraft,
    setCustomFontDraft,
    saveCustomFontFamily,
    youtubeApiDialogOpen,
    setYoutubeApiDialogOpen,
    youtubeApiKeyDraft,
    setYoutubeApiKeyDraft,
    integrationStatus,
    saveYoutubeApiKey,
    translationApiDialogOpen,
    setTranslationApiDialogOpen,
    translationDraft,
    setTranslationDraftValue,
    translationProviderOptions,
    availableTranslationModels,
    fetchTranslationModels,
    testTranslationApiConfig,
    saveTranslationApiConfig,
    tablePageSizesDialogOpen,
    setTablePageSizesDialogOpen,
    tableLimitsDialogOpen,
    setTableLimitsDialogOpen,
    tableLimitsDraft,
    setTableLimitsDraft,
    tableMaxSizeError,
    searchLimitError,
    tableLimitsSaveDisabled,
    saveTableLimitsDialog,
    avatarProviderDialogOpen,
    updateAvatarProvider,
    saveAvatarProviderField,
    removeAvatarProvider,
    addAvatarProvider,
    purgeDialogOpen,
    purgePeriod,
    setPurgePeriod,
    purgeInProgress,
    purgeAvatarFeedData,
    feedFilterDialogOpen,
    feedFilterMode,
    setFeedFilterMode,
    currentSharedFeedFilterOptions,
    sharedFeedFilters,
    updateSharedFeedFilter,
    resetSharedFeedFilters,
    openSourceNoticeOpen
}) {
    return (
        <div className="x-container flex flex-1 flex-col overflow-hidden p-4">
            <PageHeader>
                <PageTitle>{t('view.settings.header')}</PageTitle>
            </PageHeader>
            <Tabs
                value={activeSettingsTab}
                onValueChange={setActiveSettingsTab}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div className="max-w-full shrink-0 overflow-x-auto">
                    <TabsList>
                        {settingsTabs.map(([value, labelKey]) => (
                            <TabsTrigger key={value} value={value}>
                                {t(labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                {loading ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Spinner />
                        {t('view.settings.generated.loading_settings_snapshot')}
                    </div>
                ) : null}
                <SettingsSystemTab
                    t={t}
                    versionText={
                        formatReleaseDisplayVersion(VERSION || '') || '-'
                    }
                    isStartAtWindowsStartup={prefs.isStartAtWindowsStartup}
                    isStartAsMinimizedState={prefs.isStartAsMinimizedState}
                    isCloseToTray={prefs.isCloseToTray}
                    onOpenRepository={() =>
                        void openExternalLink(
                            'https://github.com/Map1en/VRCX-0'
                        )
                    }
                    onOpenSupport={() =>
                        void openExternalLink(
                            'https://github.com/Map1en/VRCX-0/issues'
                        )
                    }
                    onStartAtWindowsStartupChange={(checked) =>
                        void savePreferenceValue(
                            'isStartAtWindowsStartup',
                            checked,
                            () => setStartAtWindowsStartupPreference(checked)
                        )
                    }
                    onStartAsMinimizedChange={(checked) =>
                        void savePreferenceValue(
                            'isStartAsMinimizedState',
                            checked,
                            () => setStartAsMinimizedPreference(checked)
                        )
                    }
                    onCloseToTrayChange={(checked) =>
                        void savePreferenceValue('isCloseToTray', checked, () =>
                            setCloseToTrayPreference(checked)
                        )
                    }
                    onProxySettings={() => void promptProxySettings()}
                    onOpenSourceNotice={() => setOpenSourceNoticeOpen(true)}
                />
                <SettingsInterfaceTab
                    t={t}
                    locale={locale}
                    prefs={prefs}
                    zoomInput={zoomInput}
                    zoomLevel={zoomLevel}
                    onLanguageChange={(value) =>
                        void commit(() => setAppLanguagePreference(value))
                    }
                    onFontFamilyChange={(value) => {
                        if (value === 'custom') {
                            openCustomFontDialog();
                            return;
                        }
                        void saveFontFamilyPreference(value);
                    }}
                    onCjkFontPackChange={(value) =>
                        void selectCjkFontPack(value)
                    }
                    onZoomInputChange={setZoomInput}
                    onZoomBlur={() =>
                        void commit(async () => {
                            const nextZoom =
                                await setZoomLevelPreference(zoomInput);
                            setZoomInput(String(nextZoom));
                        })
                    }
                    onNotificationIconDotChange={(checked) =>
                        void saveBoolPreference(
                            'notificationIconDot',
                            'notificationIconDot',
                            checked
                        )
                    }
                    onDataTableStripedChange={(checked) =>
                        void savePreferenceValue(
                            'dataTableStriped',
                            checked,
                            () => setDataTableStripedPreference(checked)
                        )
                    }
                    onPointerOnHoverChange={(checked) =>
                        void savePreferenceValue(
                            'showPointerOnHover',
                            checked,
                            () => setPointerOnHoverPreference(checked)
                        )
                    }
                    onAccessibleStatusIndicatorsChange={(checked) =>
                        void savePreferenceValue(
                            'accessibleStatusIndicators',
                            checked,
                            () =>
                                setAccessibleStatusIndicatorsPreference(checked)
                        )
                    }
                    onShowInstanceIdInLocationChange={(checked) =>
                        void saveBoolPreference(
                            'showInstanceIdInLocation',
                            'VRCX_showInstanceIdInLocation',
                            checked
                        )
                    }
                    onAgeGatedInstancesVisibleChange={(checked) =>
                        void saveBoolPreference(
                            'isAgeGatedInstancesVisible',
                            'VRCX_isAgeGatedInstancesVisible',
                            checked
                        )
                    }
                    onHideNicknamesChange={(checked) =>
                        void saveBoolPreference(
                            'hideNicknames',
                            'hideNicknames',
                            !checked
                        )
                    }
                    onDisplayVrcPlusIconsAsAvatarChange={(checked) =>
                        void saveBoolPreference(
                            'displayVRCPlusIconsAsAvatar',
                            'displayVRCPlusIconsAsAvatar',
                            checked
                        )
                    }
                    onShowNewDashboardButtonChange={(checked) =>
                        void savePreferenceValue(
                            'showNewDashboardButton',
                            checked,
                            () => setShowNewDashboardButtonPreference(checked)
                        )
                    }
                    onSortFavoritesChange={(value) =>
                        void saveBoolPreference(
                            'sortFavorites',
                            'sortFavorites',
                            value === 'date'
                        )
                    }
                    onOpenTablePageSizes={() => void openTablePageSizesDialog()}
                    onOpenTableLimits={() => void openTableLimitsDialog()}
                    onHour12Change={(value) =>
                        void saveBoolPreference(
                            'dtHour12',
                            'dtHour12',
                            value === '12'
                        )
                    }
                    onIsoFormatChange={(checked) =>
                        void saveBoolPreference(
                            'dtIsoFormat',
                            'dtIsoFormat',
                            checked
                        )
                    }
                    onWeekStartsOnChange={(value) =>
                        void savePreferenceValue(
                            'weekStartsOn',
                            Number.parseInt(value, 10),
                            () =>
                                setIntConfigPreference('weekStartsOn', value, {
                                    min: 0,
                                    max: 6,
                                    fallback: 1
                                })
                        )
                    }
                    onHideUserNotesChange={(checked) =>
                        void saveBoolPreference(
                            'hideUserNotes',
                            'hideUserNotes',
                            !checked
                        )
                    }
                    onHideUserMemosChange={(checked) =>
                        void saveBoolPreference(
                            'hideUserMemos',
                            'hideUserMemos',
                            !checked
                        )
                    }
                    onHideUnfriendsChange={(checked) =>
                        void saveBoolPreference(
                            'hideUnfriends',
                            'hideUnfriends',
                            checked
                        )
                    }
                    onRandomUserColoursChange={(checked) =>
                        void saveBoolPreference(
                            'randomUserColours',
                            'VRCX_randomUserColours',
                            checked
                        )
                    }
                    onResetTrustColors={() => void resetTrustColors()}
                    onSaveTrustColor={(key, value) =>
                        void saveTrustColor(key, value)
                    }
                    onTrustColorDraftChange={(key, value) =>
                        setPrefs((current) => ({
                            ...current,
                            trustColor: {
                                ...current.trustColor,
                                [key]: value
                            }
                        }))
                    }
                />{' '}
                <SettingsMediaTab
                    t={t}
                    prefs={prefs}
                    onScreenshotHelperChange={(checked) =>
                        void commit(
                            () => setScreenshotHelperPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    screenshotHelper: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        screenshotHelper: !checked
                                    }));
                            }
                        )
                    }
                    onScreenshotHelperModifyFilenameChange={(checked) =>
                        void commit(
                            () =>
                                setScreenshotHelperModifyFilenamePreference(
                                    checked
                                ),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    screenshotHelperModifyFilename: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        screenshotHelperModifyFilename: !checked
                                    }));
                            }
                        )
                    }
                    onScreenshotHelperCopyToClipboardChange={(checked) =>
                        void commit(
                            () =>
                                setScreenshotHelperCopyToClipboardPreference(
                                    checked
                                ),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    screenshotHelperCopyToClipboard: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        screenshotHelperCopyToClipboard:
                                            !checked
                                    }));
                            }
                        )
                    }
                    onDeleteAllScreenshotMetadata={() =>
                        void deleteAllScreenshotMetadata()
                    }
                    onOpenUgcPhotosFolder={() =>
                        void backend.app.OpenUGCPhotosFolder(
                            prefs.userGeneratedContentPath || ''
                        )
                    }
                    onOpenUgcFolderSelector={() => void openUgcFolderSelector()}
                    onResetUgcFolder={() => void resetUgcFolder()}
                    onSaveInstancePrintsChange={(checked) =>
                        void commit(
                            () => setSaveInstancePrintsPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    saveInstancePrints: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        saveInstancePrints: !checked
                                    }));
                            }
                        )
                    }
                    onCropInstancePrintsChange={(checked) =>
                        void handleCropInstancePrintsChange(checked)
                    }
                    onSaveInstanceStickersChange={(checked) =>
                        void commit(
                            () => setSaveInstanceStickersPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    saveInstanceStickers: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        saveInstanceStickers: !checked
                                    }));
                            }
                        )
                    }
                    onSaveInstanceEmojiChange={(checked) =>
                        void commit(
                            () => setSaveInstanceEmojiPreference(checked),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    saveInstanceEmoji: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        saveInstanceEmoji: !checked
                                    }));
                            }
                        )
                    }
                />
                <SettingsIntegrationsTab
                    t={t}
                    discordPrefs={discordPrefs}
                    integrationPrefs={integrationPrefs}
                    avatarProviderConfig={avatarProviderConfig}
                    onOpenVrchatConfig={() =>
                        setSystemHostOpen('vrchatConfigOpen', true)
                    }
                    onDiscordActiveChange={(checked) =>
                        void saveDiscordBoolPreference('discordActive', checked)
                    }
                    onDiscordWorldIntegrationChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordWorldIntegration',
                            checked
                        )
                    }
                    onDiscordInstanceChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordInstance',
                            checked
                        )
                    }
                    onDiscordShowPlatformChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordShowPlatform',
                            checked
                        )
                    }
                    onDiscordShowPrivateDetailsChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordHideInvite',
                            !checked
                        )
                    }
                    onDiscordJoinButtonChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordJoinButton',
                            checked
                        )
                    }
                    onDiscordShowImagesChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordHideImage',
                            !checked
                        )
                    }
                    onDiscordWorldNameAsStatusChange={(checked) =>
                        void saveDiscordBoolPreference(
                            'discordWorldNameAsDiscordStatus',
                            checked
                        )
                    }
                    onTranslationApiEnabledChange={(checked) =>
                        void commit(
                            () => setTranslationApiEnabledPreference(checked),
                            () => {
                                setIntegrationValue('translationAPI', checked);
                                return () =>
                                    setIntegrationValue(
                                        'translationAPI',
                                        !checked
                                    );
                            }
                        )
                    }
                    onOpenTranslationApiDialog={openTranslationApiDialog}
                    onYoutubeApiEnabledChange={(checked) =>
                        void commit(
                            () => setYoutubeApiEnabledPreference(checked),
                            () => {
                                setIntegrationValue('youtubeAPI', checked);
                                return () =>
                                    setIntegrationValue('youtubeAPI', !checked);
                            }
                        )
                    }
                    onOpenYoutubeApiDialog={openYoutubeApiDialog}
                    onAvatarProviderEnabledChange={(checked) =>
                        void commit(
                            () =>
                                saveAvatarProviderConfig({
                                    ...avatarProviderConfigRef.current,
                                    enabled: checked
                                }),
                            () => {
                                const previous =
                                    avatarProviderConfigRef.current;
                                applyAvatarProviderConfig({
                                    ...avatarProviderConfigRef.current,
                                    enabled: checked
                                });
                                return () =>
                                    applyAvatarProviderConfig(previous);
                            }
                        )
                    }
                    onOpenAvatarProviderDialog={() =>
                        setAvatarProviderDialogOpen(true)
                    }
                />
                <SettingsSocialTab
                    t={t}
                    prefs={prefs}
                    selectedFavoriteFriendGroupLabel={
                        selectedFavoriteFriendGroupLabel
                    }
                    favoriteFriendGroupOptions={favoriteFriendGroupOptions}
                    remoteFavoriteFriendGroupOptions={
                        remoteFavoriteFriendGroupOptions
                    }
                    localFavoriteFriendGroupOptions={
                        localFavoriteFriendGroupOptions
                    }
                    localFavoriteFriendsGroups={localFavoriteFriendsGroups}
                    onRecentActionCooldownEnabledChange={(checked) =>
                        void commit(
                            () =>
                                setRecentActionCooldownEnabledPreference(
                                    checked
                                ),
                            () => {
                                setPrefs((current) => ({
                                    ...current,
                                    recentActionCooldownEnabled: checked
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        recentActionCooldownEnabled: !checked
                                    }));
                            }
                        )
                    }
                    onRecentActionCooldownMinutesChange={(value) =>
                        setPrefs((current) => ({
                            ...current,
                            recentActionCooldownMinutes: value
                        }))
                    }
                    onRecentActionCooldownMinutesBlur={(value) =>
                        void commit(async () => {
                            const minutes =
                                await setRecentActionCooldownMinutesPreference(
                                    value
                                );
                            setPrefs((current) => ({
                                ...current,
                                recentActionCooldownMinutes: minutes
                            }));
                        })
                    }
                    onToggleLocalFavoriteFriendsGroup={(groupId, checked) =>
                        void toggleLocalFavoriteFriendsGroup(groupId, checked)
                    }
                />
                <SettingsNotificationsTab
                    t={t}
                    prefs={prefs}
                    notificationLayoutOptions={notificationLayoutOptions}
                    desktopToastOptions={desktopToastOptions}
                    notificationTtsOptions={notificationTtsOptions}
                    ttsVoices={ttsVoices}
                    notificationTtsTestVisible={notificationTtsTestVisible}
                    notificationTtsTest={notificationTtsTest}
                    onNotificationLayoutChange={(value) =>
                        void commit(
                            async () => {
                                const nextLayout =
                                    await setNotificationLayoutPreference(
                                        value
                                    );
                                setPrefs((current) => ({
                                    ...current,
                                    notificationLayout: nextLayout
                                }));
                            },
                            () => {
                                const previous = prefs.notificationLayout;
                                setPrefs((current) => ({
                                    ...current,
                                    notificationLayout: value
                                }));
                                return () =>
                                    setPrefs((current) => ({
                                        ...current,
                                        notificationLayout: previous
                                    }));
                            }
                        )
                    }
                    onOpenFeedFilterDialog={() => setFeedFilterDialogOpen(true)}
                    onTestDesktopNotification={() =>
                        void backend.app.DesktopNotification(
                            'VRCX-0',
                            t(
                                'view.settings.notifications.notifications.test_message'
                            )
                        )
                    }
                    onDesktopToastChange={(value) =>
                        void saveStringPreference(
                            'desktopToast',
                            'desktopToast',
                            value
                        )
                    }
                    onAfkDesktopToastChange={(checked) =>
                        void saveBoolPreference(
                            'afkDesktopToast',
                            'afkDesktopToast',
                            checked
                        )
                    }
                    onNotificationTtsModeChange={(value) =>
                        void saveNotificationTtsMode(value)
                    }
                    onNotificationTtsVoiceChange={(value) =>
                        void saveNotificationTtsVoice(value)
                    }
                    onNotificationTtsNicknameChange={(checked) =>
                        void saveBoolPreference(
                            'notificationTTSNickName',
                            'notificationTTSNickName',
                            checked
                        )
                    }
                    onNotificationTtsTestVisibleChange={
                        setNotificationTtsTestVisible
                    }
                    onNotificationTtsTestChange={setNotificationTtsTest}
                    onSpeakNotificationTts={(message) =>
                        speakNotificationTts(message)
                    }
                />
                <SettingsAdvancedTab
                    t={t}
                    prefs={prefs}
                    cacheStats={cacheStats}
                    avatarAutoCleanupOptions={avatarAutoCleanupOptions}
                    sqliteTableSizes={sqliteTableSizes}
                    sqliteTableSizeRows={sqliteTableSizeRows}
                    onlineVisitCount={onlineVisitCount}
                    configTreeData={configTreeData}
                    gameLogDisabledLabel={t(
                        'view.settings.generated_dynamic.value_value',
                        {
                            value: t(
                                'view.settings.advanced.advanced.cache_debug.disable_gamelog'
                            ),
                            value2: t(
                                'view.settings.advanced.advanced.cache_debug.disable_gamelog_notice'
                            )
                        }
                    )}
                    onRelaunchVRChatAfterCrashChange={(checked) =>
                        void saveBoolPreference(
                            'relaunchVRChatAfterCrash',
                            'VRCX_relaunchVRChatAfterCrash',
                            checked
                        )
                    }
                    onVrcQuitFixChange={(checked) =>
                        void saveBoolPreference(
                            'vrcQuitFix',
                            'vrcQuitFix',
                            checked
                        )
                    }
                    onAutoSweepVRChatCacheChange={(checked) =>
                        void saveBoolPreference(
                            'autoSweepVRChatCache',
                            'VRCX_autoSweepVRChatCache',
                            checked
                        )
                    }
                    onUdonExceptionLoggingChange={(checked) =>
                        void saveBoolPreference(
                            'udonExceptionLogging',
                            'VRCX_udonExceptionLogging',
                            checked
                        )
                    }
                    onLogResourceLoadChange={(checked) =>
                        void saveBoolPreference(
                            'logResourceLoad',
                            'logResourceLoad',
                            checked
                        )
                    }
                    onLogEmptyAvatarsChange={(checked) =>
                        void saveBoolPreference(
                            'logEmptyAvatars',
                            'logEmptyAvatars',
                            checked
                        )
                    }
                    onAutoLoginDelayEnabledChange={(checked) =>
                        void saveBoolPreference(
                            'autoLoginDelayEnabled',
                            'VRCX_autoLoginDelayEnabled',
                            checked
                        )
                    }
                    onPromptAutoLoginDelaySeconds={() =>
                        void promptAutoLoginDelaySeconds()
                    }
                    onOpenShortcutFolder={() =>
                        void backend.app.OpenShortcutFolder()
                    }
                    onEnableAppLauncherChange={(checked) =>
                        void saveAppLauncherField('enableAppLauncher', checked)
                    }
                    onEnableAppLauncherAutoCloseChange={(checked) =>
                        void saveAppLauncherField(
                            'enableAppLauncherAutoClose',
                            checked
                        )
                    }
                    onEnableAppLauncherRunProcessOnceChange={(checked) =>
                        void saveAppLauncherField(
                            'enableAppLauncherRunProcessOnce',
                            checked
                        )
                    }
                    onShowConfirmationOnSwitchAvatarChange={(checked) =>
                        void saveBoolPreference(
                            'showConfirmationOnSwitchAvatar',
                            'showConfirmationOnSwitchAvatar',
                            checked
                        )
                    }
                    onClearVrcxCache={() => void clearVrcxCache()}
                    onPromptAutoClearVrcxCacheFrequency={() =>
                        void promptAutoClearVrcxCacheFrequency()
                    }
                    onRefreshCacheSize={() => void refreshCacheSize()}
                    onGameLogDisabledChange={(checked) =>
                        void handleGameLogDisabledChange(checked)
                    }
                    onAvatarAutoCleanupChange={(value) =>
                        void saveStringPreference(
                            'avatarAutoCleanup',
                            'avatarAutoCleanup',
                            value
                        )
                    }
                    onOpenPurgeDialog={() => setPurgeDialogOpen(true)}
                    onOpenLaunchOptions={() =>
                        setSystemHostOpen('launchOptionsOpen', true)
                    }
                    onOpenRegistryBackup={() =>
                        setSystemHostOpen('registryBackupOpen', true)
                    }
                    onRefreshSqliteTableSizes={() =>
                        void refreshSqliteTableSizes()
                    }
                    onRefreshOnlineVisits={() => void refreshOnlineVisits()}
                    onRefreshConfigTreeData={() => void refreshConfigTreeData()}
                    onClearConfigTreeData={() => setConfigTreeData({})}
                />
            </Tabs>
            <SettingsDialogs
                t={t}
                customFont={{
                    open: customFontDialogOpen,
                    setOpen: setCustomFontDialogOpen,
                    draft: customFontDraft,
                    setDraft: setCustomFontDraft,
                    onSave: saveCustomFontFamily
                }}
                youtubeApi={{
                    open: youtubeApiDialogOpen,
                    setOpen: setYoutubeApiDialogOpen,
                    draft: youtubeApiKeyDraft,
                    setDraft: setYoutubeApiKeyDraft,
                    integrationStatus,
                    onSave: saveYoutubeApiKey
                }}
                translationApi={{
                    open: translationApiDialogOpen,
                    setOpen: setTranslationApiDialogOpen,
                    draft: translationDraft,
                    setDraftValue: setTranslationDraftValue,
                    providerOptions: translationProviderOptions,
                    fetchedModels: availableTranslationModels,
                    integrationStatus,
                    onFetchModels: fetchTranslationModels,
                    onTest: testTranslationApiConfig,
                    onSave: saveTranslationApiConfig
                }}
                tablePageSizes={{
                    open: tablePageSizesDialogOpen,
                    setOpen: setTablePageSizesDialogOpen,
                    onSaved: (tablePageSizes) =>
                        setPrefs((current) => ({
                            ...current,
                            tablePageSizes
                        }))
                }}
                tableLimits={{
                    open: tableLimitsDialogOpen,
                    setOpen: setTableLimitsDialogOpen,
                    draft: tableLimitsDraft,
                    setDraft: setTableLimitsDraft,
                    tableMaxSizeError,
                    searchLimitError,
                    saveDisabled: tableLimitsSaveDisabled,
                    onSave: saveTableLimitsDialog
                }}
                avatarProvider={{
                    open: avatarProviderDialogOpen,
                    setOpen: setAvatarProviderDialogOpen,
                    config: avatarProviderConfig,
                    onUpdate: updateAvatarProvider,
                    onSaveField: saveAvatarProviderField,
                    onRemove: removeAvatarProvider,
                    onAdd: addAvatarProvider
                }}
                purge={{
                    open: purgeDialogOpen,
                    setOpen: setPurgeDialogOpen,
                    period: purgePeriod,
                    setPeriod: setPurgePeriod,
                    inProgress: purgeInProgress,
                    onConfirm: purgeAvatarFeedData
                }}
                feedFilter={{
                    open: feedFilterDialogOpen,
                    setOpen: setFeedFilterDialogOpen,
                    mode: feedFilterMode,
                    setMode: setFeedFilterMode,
                    options: currentSharedFeedFilterOptions,
                    filters: sharedFeedFilters,
                    onUpdate: updateSharedFeedFilter,
                    onReset: resetSharedFeedFilters
                }}
                openSourceNotice={{
                    open: openSourceNoticeOpen,
                    setOpen: setOpenSourceNoticeOpen
                }}
            />
        </div>
    );
}
