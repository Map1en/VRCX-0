import { translationProviderOptions } from '../settingsOptions';
import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type DialogsSectionInput = SettingsSectionInput<
    | 'customFontDialogOpen'
    | 'setCustomFontDialogOpen'
    | 'customFontDraft'
    | 'setCustomFontDraft'
    | 'customFontOptions'
    | 'customFontOptionsLoading'
    | 'saveCustomFontFamily'
    | 'youtubeApiDialogOpen'
    | 'setYoutubeApiDialogOpen'
    | 'youtubeApiKeyDraft'
    | 'setYoutubeApiKeyDraft'
    | 'integrationStatus'
    | 'saveYoutubeApiKey'
    | 'translationApiDialogOpen'
    | 'setTranslationApiDialogOpen'
    | 'translationDraft'
    | 'setTranslationDraftValue'
    | 'llmEndpoints'
    | 'translationDefaultModel'
    | 'testTranslationApiConfig'
    | 'saveTranslationApiConfig'
    | 'tablePageSizesDialogOpen'
    | 'setTablePageSizesDialogOpen'
    | 'setPrefs'
    | 'tableLimitsDialogOpen'
    | 'setTableLimitsDialogOpen'
    | 'tableLimitsDraft'
    | 'setTableLimitsDraft'
    | 'tableMaxSizeError'
    | 'searchLimitError'
    | 'tableLimitsSaveDisabled'
    | 'saveTableLimitsDialog'
    | 'avatarProviderDialogOpen'
    | 'setAvatarProviderDialogOpen'
    | 'avatarProviderConfig'
    | 'updateAvatarProvider'
    | 'saveAvatarProviderField'
    | 'removeAvatarProvider'
    | 'addAvatarProvider'
    | 'purgeDialogOpen'
    | 'setPurgeDialogOpen'
    | 'purgePeriod'
    | 'setPurgePeriod'
    | 'purgeInProgress'
    | 'purgeAvatarFeedData'
    | 'wristFeedNotificationsDialogOpen'
    | 'setWristFeedNotificationsDialogOpen'
    | 'vrNotificationsDialogOpen'
    | 'setVrNotificationsDialogOpen'
    | 'hmdNotificationsDialogOpen'
    | 'setHmdNotificationsDialogOpen'
    | 'desktopNotificationsDialogOpen'
    | 'setDesktopNotificationsDialogOpen'
    | 'desktopWidgetDialogOpen'
    | 'setDesktopWidgetDialogOpen'
    | 'webhookNotificationsDialogOpen'
    | 'setWebhookNotificationsDialogOpen'
    | 'ttsNotificationsDialogOpen'
    | 'setTtsNotificationsDialogOpen'
    | 'prefs'
    | 'saveOverlayActivityFilters'
    | 'saveVrNotificationActivityFilters'
    | 'saveHmdNotificationActivityFilters'
    | 'saveDesktopNotificationActivityFilters'
    | 'saveDesktopWidgetActivityFilters'
    | 'saveWebhookActivityFilters'
    | 'saveTtsNotificationActivityFilters'
>;

export function buildDialogsSection({
    customFontDialogOpen,
    setCustomFontDialogOpen,
    customFontDraft,
    setCustomFontDraft,
    customFontOptions,
    customFontOptionsLoading,
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
    llmEndpoints,
    translationDefaultModel,
    testTranslationApiConfig,
    saveTranslationApiConfig,
    tablePageSizesDialogOpen,
    setTablePageSizesDialogOpen,
    setPrefs,
    tableLimitsDialogOpen,
    setTableLimitsDialogOpen,
    tableLimitsDraft,
    setTableLimitsDraft,
    tableMaxSizeError,
    searchLimitError,
    tableLimitsSaveDisabled,
    saveTableLimitsDialog,
    avatarProviderDialogOpen,
    setAvatarProviderDialogOpen,
    avatarProviderConfig,
    updateAvatarProvider,
    saveAvatarProviderField,
    removeAvatarProvider,
    addAvatarProvider,
    purgeDialogOpen,
    setPurgeDialogOpen,
    purgePeriod,
    setPurgePeriod,
    purgeInProgress,
    purgeAvatarFeedData,
    wristFeedNotificationsDialogOpen,
    setWristFeedNotificationsDialogOpen,
    vrNotificationsDialogOpen,
    setVrNotificationsDialogOpen,
    hmdNotificationsDialogOpen,
    setHmdNotificationsDialogOpen,
    desktopNotificationsDialogOpen,
    setDesktopNotificationsDialogOpen,
    desktopWidgetDialogOpen,
    setDesktopWidgetDialogOpen,
    webhookNotificationsDialogOpen,
    setWebhookNotificationsDialogOpen,
    ttsNotificationsDialogOpen,
    setTtsNotificationsDialogOpen,
    prefs,
    saveOverlayActivityFilters,
    saveVrNotificationActivityFilters,
    saveHmdNotificationActivityFilters,
    saveDesktopNotificationActivityFilters,
    saveDesktopWidgetActivityFilters,
    saveWebhookActivityFilters,
    saveTtsNotificationActivityFilters
}: DialogsSectionInput) {
    return {
        customFontDialogOpen,
        setCustomFontDialogOpen,
        customFontDraft,
        setCustomFontDraft,
        customFontOptions,
        customFontOptionsLoading,
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
        llmEndpoints,
        translationDefaultModel,
        testTranslationApiConfig,
        saveTranslationApiConfig,
        tablePageSizesDialogOpen,
        setTablePageSizesDialogOpen,
        setPrefs,
        tableLimitsDialogOpen,
        setTableLimitsDialogOpen,
        tableLimitsDraft,
        setTableLimitsDraft,
        tableMaxSizeError,
        searchLimitError,
        tableLimitsSaveDisabled,
        saveTableLimitsDialog,
        avatarProviderDialogOpen,
        setAvatarProviderDialogOpen,
        avatarProviderConfig,
        updateAvatarProvider,
        saveAvatarProviderField,
        removeAvatarProvider,
        addAvatarProvider,
        purgeDialogOpen,
        setPurgeDialogOpen,
        purgePeriod,
        setPurgePeriod,
        purgeInProgress,
        purgeAvatarFeedData,
        wristFeedNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        vrNotificationsDialogOpen,
        setVrNotificationsDialogOpen,
        hmdNotificationsDialogOpen,
        setHmdNotificationsDialogOpen,
        desktopNotificationsDialogOpen,
        setDesktopNotificationsDialogOpen,
        desktopWidgetDialogOpen,
        setDesktopWidgetDialogOpen,
        webhookNotificationsDialogOpen,
        setWebhookNotificationsDialogOpen,
        ttsNotificationsDialogOpen,
        setTtsNotificationsDialogOpen,
        overlayActivityFilters: prefs.overlayActivityFilters,
        vrNotificationActivityFilters: prefs.vrNotificationActivityFilters,
        hmdNotificationActivityFilters: prefs.hmdNotificationActivityFilters,
        desktopNotificationActivityFilters:
            prefs.desktopNotificationActivityFilters,
        desktopWidgetActivityFilters: prefs.desktopWidgetActivityFilters,
        webhookActivityFilters: prefs.webhookActivityFilters,
        ttsNotificationActivityFilters: prefs.ttsNotificationActivityFilters,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveHmdNotificationActivityFilters,
        saveDesktopNotificationActivityFilters,
        saveDesktopWidgetActivityFilters,
        saveWebhookActivityFilters,
        saveTtsNotificationActivityFilters
    };
}
