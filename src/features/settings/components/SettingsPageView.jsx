import { SettingsAdvancedSection } from './SettingsAdvancedSection.jsx';
import { SettingsDialogsSection } from './SettingsDialogsSection.jsx';
import { SettingsNotificationsSection } from './SettingsNotificationsSection.jsx';
import { SettingsSystemSection } from './SettingsSystemSection.jsx';

export function SettingsPageView({ controller }) {
    const {
        shell,
        system,
        interface: settingsInterface,
        media,
        integrations,
        social,
        notifications,
        advanced,
        dialogs
    } = controller;
    const {
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
        Spinner
    } = shell;
    const {
        SettingsInterfaceTab,
        locale,
        prefs,
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
        savePreferenceValue,
        setDataTableStripedPreference,
        setPointerOnHoverPreference,
        setAccessibleStatusIndicatorsPreference,
        setShowNewDashboardButtonPreference,
        openTablePageSizesDialog,
        openTableLimitsDialog,
        setIntConfigPreference,
        resetTrustColors,
        saveTrustColor,
        setPrefs
    } = settingsInterface;
    const {
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
        setSaveInstanceEmojiPreference
    } = media;
    const {
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
        setAvatarProviderDialogOpen
    } = integrations;
    const {
        SettingsSocialTab,
        selectedFavoriteFriendGroupLabel,
        favoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        localFavoriteFriendsGroups,
        setRecentActionCooldownEnabledPreference,
        setRecentActionCooldownMinutesPreference,
        toggleLocalFavoriteFriendsGroup
    } = social;

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
                <SettingsSystemSection system={system} />
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
                <SettingsNotificationsSection notifications={notifications} />
                <SettingsAdvancedSection advanced={advanced} />
            </Tabs>
            <SettingsDialogsSection dialogs={dialogs} />
        </div>
    );
}
