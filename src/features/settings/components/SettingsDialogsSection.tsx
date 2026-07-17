import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { SettingsDialogs } from './SettingsDialogs';

type SettingsDialogsSectionProps = {
    dialogs: SettingsPageStateSections['dialogs'];
};

export function SettingsDialogsSection({
    dialogs
}: SettingsDialogsSectionProps) {
    const {
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
        fetchTranslationModels,
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
        webhookNotificationsDialogOpen,
        setWebhookNotificationsDialogOpen,
        ttsNotificationsDialogOpen,
        setTtsNotificationsDialogOpen,
        overlayActivityFilters,
        vrNotificationActivityFilters,
        hmdNotificationActivityFilters,
        desktopNotificationActivityFilters,
        webhookActivityFilters,
        ttsNotificationActivityFilters,
        saveOverlayActivityFilters,
        saveVrNotificationActivityFilters,
        saveHmdNotificationActivityFilters,
        saveDesktopNotificationActivityFilters,
        saveWebhookActivityFilters,
        saveTtsNotificationActivityFilters
    } = dialogs;

    return (
        <SettingsDialogs
            customFont={{
                open: customFontDialogOpen,
                setOpen: setCustomFontDialogOpen,
                draft: customFontDraft,
                setDraft: setCustomFontDraft,
                options: customFontOptions,
                loading: customFontOptionsLoading,
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
                llmEndpoints,
                integrationStatus,
                onFetchModels: fetchTranslationModels,
                onTest: testTranslationApiConfig,
                onSave: saveTranslationApiConfig
            }}
            tablePageSizes={{
                open: tablePageSizesDialogOpen,
                setOpen: setTablePageSizesDialogOpen,
                onSaved: (tablePageSizes: unknown) =>
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
            wristFeedNotifications={{
                open: wristFeedNotificationsDialogOpen,
                setOpen: setWristFeedNotificationsDialogOpen,
                value: overlayActivityFilters,
                onSave: saveOverlayActivityFilters
            }}
            vrNotifications={{
                open: vrNotificationsDialogOpen,
                setOpen: setVrNotificationsDialogOpen,
                value: vrNotificationActivityFilters,
                onSave: saveVrNotificationActivityFilters
            }}
            hmdNotifications={{
                open: hmdNotificationsDialogOpen,
                setOpen: setHmdNotificationsDialogOpen,
                value: hmdNotificationActivityFilters,
                onSave: saveHmdNotificationActivityFilters
            }}
            desktopNotifications={{
                open: desktopNotificationsDialogOpen,
                setOpen: setDesktopNotificationsDialogOpen,
                value: desktopNotificationActivityFilters,
                onSave: saveDesktopNotificationActivityFilters
            }}
            webhookNotifications={{
                open: webhookNotificationsDialogOpen,
                setOpen: setWebhookNotificationsDialogOpen,
                value: webhookActivityFilters,
                onSave: saveWebhookActivityFilters
            }}
            ttsNotifications={{
                open: ttsNotificationsDialogOpen,
                setOpen: setTtsNotificationsDialogOpen,
                value: ttsNotificationActivityFilters,
                onSave: saveTtsNotificationActivityFilters
            }}
        />
    );
}
