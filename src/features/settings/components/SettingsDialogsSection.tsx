import { SettingsDialogs } from './SettingsDialogs';

export function SettingsDialogsSection({ dialogs }: any) {
    const {
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
        feedFilterDialogOpen,
        setFeedFilterDialogOpen,
        feedFilterMode,
        currentSharedFeedFilterOptions,
        sharedFeedFilters,
        updateSharedFeedFilter,
        resetSharedFeedFilters,
        wristFeedNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        vrNotificationsDialogOpen,
        setVrNotificationsDialogOpen,
        overlayActivityFilters,
        saveOverlayActivityFilters,
        vrNotificationActivityFilters,
        saveVrNotificationActivityFilters
    } = dialogs;

    return (
        <SettingsDialogs
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
                onSaved: (tablePageSizes: any) =>
                    setPrefs((current: any) => ({
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
                options: currentSharedFeedFilterOptions,
                filters: sharedFeedFilters,
                onUpdate: updateSharedFeedFilter,
                onReset: resetSharedFeedFilters
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
        />
    );
}
