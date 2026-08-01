import { describe, expect, it, vi } from 'vitest';

import { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import {
    buildSettingsPageStateSections,
    type BuildSettingsPageStateSectionsInput
} from './settingsPageStateSections';

function createInput(
    overrides: Partial<BuildSettingsPageStateSectionsInput> = {}
): BuildSettingsPageStateSectionsInput {
    const callback = vi.fn();

    return {
        activeSettingsTab: 'system',
        avatarProviderConfig: {
            enabled: true,
            providerList: [],
            selectedProvider: ''
        },
        configTreeData: {},
        commit: callback,
        deleteAllScreenshotMetadata: callback,
        desktopNotificationsDialogOpen: false,
        discordPrefs: {
            discordActive: false,
            discordInstance: true,
            discordHideInvite: true,
            discordJoinButton: false,
            discordHideImage: false,
            discordShowPlatform: true,
            discordWorldIntegration: true,
            discordWorldNameAsDiscordStatus: false
        },
        handleCropInstancePrintsChange: callback,
        handleGameLogDisabledChange: callback,
        hmdNotificationsDialogOpen: false,
        integrationPrefs: {
            youtubeAPI: false,
            youtubeAPIKey: '',
            translationAPI: false,
            bioLanguage: 'en',
            translationAPIType: 'google',
            translationAPIKey: '',
            translationEndpointId: '',
            translationAPIEndpoint: '',
            translationAPIModel: '',
            translationAPIPrompt: '',
            translationAPIReasoningEffort: ''
        },
        locale: 'en',
        migrateLegacyVrcxData: callback,
        normalizeRecentActionCooldownMinutes: () => 60,
        notificationTtsTest: '',
        notificationTtsTestVisible: false,
        onlineVisitCount: null,
        openAppDataDirSelector: callback,
        cleanupAppDataDir: callback,
        dismissAppDataDirCleanup: callback,
        openCustomFontDialog: callback,
        openTableLimitsDialog: callback,
        openTablePageSizesDialog: callback,
        openTranslationApiDialog: callback,
        openUgcFolderSelector: callback,
        openYoutubeApiDialog: callback,
        prefs: createDefaultSettingsPrefs(),
        promptAutoLoginDelaySeconds: callback,
        promptBackgroundModeDelayMinutes: callback,
        refreshConfigTreeData: callback,
        refreshOnlineVisits: callback,
        refreshSqliteTableSizes: callback,
        resetAppDataDir: callback,
        resetTrustColors: callback,
        resetUgcFolder: callback,
        saveAvatarProviderEnabled: callback,
        saveBoolPreference: callback,
        saveDesktopNotificationActivityFilters: callback,
        saveDiscordBoolPreference: callback,
        saveFontFamilyPreference: callback,
        saveHmdNotificationActivityFilters: callback,
        saveIntegrationBoolPreference: callback,
        saveInterfaceZoomLevel: callback,
        saveNotificationTtsMode: callback,
        saveNotificationTtsVoice: callback,
        saveOverlayActivityFilters: callback,
        savePreferenceValue: callback,
        saveStringPreference: callback,
        saveTrustColor: callback,
        saveTtsNotificationActivityFilters: callback,
        saveVrNotificationActivityFilters: callback,
        saveWebhookActivityFilters: callback,
        saveWristOverlayEnabled: callback,
        selectCjkFontPack: callback,
        setAccessibleStatusIndicatorsPreference: callback,
        setActiveSettingsTab: callback,
        setAppLanguagePreference: callback,
        setAvatarProviderDialogOpen: callback,
        setCloseToTrayPreference: callback,
        setConfigTreeData: callback,
        setDataTableStripedPreference: callback,
        setDesktopNotificationsDialogOpen: callback,
        setHmdNotificationsDialogOpen: callback,
        setIntConfigPreference: callback,
        setNotificationLayoutPreference: callback,
        setNotificationTtsTest: callback,
        setNotificationTtsTestVisible: callback,
        setPrefs: callback,
        setProxyEnabledPreference: callback,
        setPurgeDialogOpen: callback,
        setRecentActionCooldownEnabledPreference: callback,
        setRecentActionCooldownMinutesPreference: callback,
        setSaveInstanceEmojiPreference: callback,
        setSaveInstancePrintsPreference: callback,
        setSaveInstanceStickersPreference: callback,
        setScreenshotHelperCopyToClipboardPreference: callback,
        setScreenshotHelperModifyFilenamePreference: callback,
        setScreenshotHelperPreference: callback,
        setShowNewDashboardButtonPreference: callback,
        setStartAsMinimizedPreference: callback,
        setStartAtWindowsStartupPreference: callback,
        setTableDensityPreference: callback,
        setTranslationApiEnabledPreference: callback,
        setTtsNotificationsDialogOpen: callback,
        setVrNotificationsDialogOpen: callback,
        setWebhookNotificationsDialogOpen: callback,
        setWristFeedNotificationsDialogOpen: callback,
        setYoutubeApiEnabledPreference: callback,
        setZoomInput: callback,
        speakNotificationTts: callback,
        sqliteTableSizes: {},
        toggleLocalFavoriteFriendsGroup: callback,
        ttsNotificationsDialogOpen: false,
        ttsVoices: [],
        vrNotificationsDialogOpen: false,
        webhookNotificationsDialogOpen: false,
        wristFeedNotificationsDialogOpen: false,
        addFeedHiddenUser: callback,
        favoriteFriendGroupOptions: [],
        localFavoriteFriendGroupOptions: [],
        localFavoriteFriendsGroups: [],
        remoteFavoriteFriendGroupOptions: [],
        removeFeedHiddenUser: callback,
        selectedFavoriteFriendGroupLabel: '',
        zoomInput: '100',
        ...overrides
    };
}

describe('settingsPageStateSections', () => {
    it('preserves every top-level section and the key section values', () => {
        const prefs = createDefaultSettingsPrefs();
        const sections = buildSettingsPageStateSections(
            createInput({
                activeSettingsTab: 'interface',
                locale: 'ja',
                prefs,
                zoomInput: '125',
                zoomLevel: 1.25,
                customFontDialogOpen: true,
                youtubeApiDialogOpen: true,
                translationApiDialogOpen: true,
                tablePageSizesDialogOpen: true,
                tableLimitsDialogOpen: true,
                avatarProviderDialogOpen: true,
                purgeDialogOpen: true
            })
        );

        expect(Object.keys(sections)).toEqual([
            'shell',
            'system',
            'interface',
            'media',
            'integrations',
            'social',
            'notifications',
            'vr',
            'advanced',
            'dialogs'
        ]);
        expect(sections.shell).toMatchObject({
            activeSettingsTab: 'interface'
        });
        expect(sections.system.prefs).toBe(prefs);
        expect(sections.interface).toMatchObject({
            locale: 'ja',
            prefs,
            zoomInput: '125',
            zoomLevel: 1.25
        });
        expect(sections.media.prefs).toBe(prefs);
        expect(sections.integrations.avatarProviderConfig).toEqual({
            enabled: true,
            providerList: [],
            selectedProvider: ''
        });
        expect(sections.social.feedHiddenUsers).toBe(prefs.feedHiddenUsers);
        expect(sections.notifications.ttsVoices).toEqual([]);
        expect(sections.vr.prefs).toBe(prefs);
        expect(sections.advanced.configTreeData).toEqual({});
        expect(sections.dialogs).toMatchObject({
            customFontDialogOpen: true,
            youtubeApiDialogOpen: true,
            translationApiDialogOpen: true,
            tablePageSizesDialogOpen: true,
            tableLimitsDialogOpen: true,
            avatarProviderDialogOpen: true,
            purgeDialogOpen: true
        });
        expect(sections.dialogs.overlayActivityFilters).toBe(
            prefs.overlayActivityFilters
        );
    });

    it('preserves direct callback identity across every section', () => {
        const setActiveSettingsTab = vi.fn();
        const savePreferenceValue = vi.fn();
        const commit = vi.fn();
        const deleteAllScreenshotMetadata = vi.fn();
        const saveDiscordBoolPreference = vi.fn();
        const addFeedHiddenUser = vi.fn();
        const speakNotificationTts = vi.fn();
        const saveWristOverlayEnabled = vi.fn();
        const refreshConfigTreeData = vi.fn();
        const saveOverlayActivityFilters = vi.fn();

        const sections = buildSettingsPageStateSections(
            createInput({
                setActiveSettingsTab,
                savePreferenceValue,
                commit,
                deleteAllScreenshotMetadata,
                saveDiscordBoolPreference,
                addFeedHiddenUser,
                speakNotificationTts,
                saveWristOverlayEnabled,
                refreshConfigTreeData,
                saveOverlayActivityFilters
            })
        );

        expect(sections.shell.setActiveSettingsTab).toBe(setActiveSettingsTab);
        expect(sections.system.savePreferenceValue).toBe(savePreferenceValue);
        expect(sections.interface.commit).toBe(commit);
        expect(sections.media.deleteAllScreenshotMetadata).toBe(
            deleteAllScreenshotMetadata
        );
        expect(sections.integrations.saveDiscordBoolPreference).toBe(
            saveDiscordBoolPreference
        );
        expect(sections.social.onAddFeedHiddenUser).toBe(addFeedHiddenUser);
        expect(sections.notifications.speakNotificationTts).toBe(
            speakNotificationTts
        );
        expect(sections.vr.saveWristOverlayEnabled).toBe(
            saveWristOverlayEnabled
        );
        expect(sections.advanced.refreshConfigTreeData).toBe(
            refreshConfigTreeData
        );
        expect(sections.dialogs.saveOverlayActivityFilters).toBe(
            saveOverlayActivityFilters
        );
    });

    it('preserves interface, media, and integration callback routing', () => {
        const openCustomFontDialog = vi.fn();
        const saveFontFamilyPreference = vi.fn();
        const deleteAllScreenshotMetadata = vi.fn();
        const setAvatarProviderDialogOpen = vi.fn();
        const sections = buildSettingsPageStateSections(
            createInput({
                openCustomFontDialog,
                saveFontFamilyPreference,
                deleteAllScreenshotMetadata,
                setAvatarProviderDialogOpen
            })
        );

        sections.interface.onFontFamilyChange('custom');
        sections.interface.onFontFamilyChange('Inter');
        sections.media.onDeleteAllScreenshotMetadata();
        sections.integrations.onOpenAvatarProviderDialog();

        expect(openCustomFontDialog).toHaveBeenCalledOnce();
        expect(saveFontFamilyPreference).toHaveBeenCalledWith('Inter');
        expect(deleteAllScreenshotMetadata).toHaveBeenCalledOnce();
        expect(setAvatarProviderDialogOpen).toHaveBeenCalledWith(true);
    });

    it('routes profile decoration visibility through the interface section', () => {
        const saveBoolPreference = vi.fn();
        const prefs = createDefaultSettingsPrefs();
        const sections = buildSettingsPageStateSections(
            createInput({
                activeSettingsTab: 'interface',
                prefs,
                saveBoolPreference
            })
        );

        expect(prefs.showUserDialogProfileDecorations).toBe(true);

        sections.interface.onShowUserDialogProfileDecorationsChange(false);

        expect(saveBoolPreference).toHaveBeenCalledWith(
            'showUserDialogProfileDecorations',
            'showUserDialogProfileDecorations',
            false
        );
    });

    it('routes the hide-unfriend-event preference through the social section', () => {
        const saveBoolPreference = vi.fn();
        const sections = buildSettingsPageStateSections(
            createInput({
                activeSettingsTab: 'social',
                saveBoolPreference
            })
        );

        expect('onHideUnfriendsChange' in sections.interface).toBe(false);

        sections.social.onHideUnfriendsChange(true);

        expect(saveBoolPreference).toHaveBeenCalledWith(
            'hideUnfriends',
            'hideUnfriends',
            true
        );
    });
});
