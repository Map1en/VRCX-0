import { useSettingsPageSection } from '../SettingsPageStateContext';
import { AvatarProviderDialog } from './settings-dialogs/AvatarProviderDialog';
import { CustomFontDialog } from './settings-dialogs/CustomFontDialog';
import { PurgeConfirmDialog } from './settings-dialogs/PurgeConfirmDialog';
import { TableLimitsDialog } from './settings-dialogs/TableLimitsDialog';
import { TranslationApiDialog } from './settings-dialogs/TranslationApiDialog';
import {
    DesktopNotificationsDialog,
    DesktopWidgetActivityDialog,
    HmdNotificationsDialog,
    TtsNotificationsDialog,
    VrNotificationsDialog,
    WebhookNotificationsDialog,
    WristFeedNotificationsDialog
} from './settings-dialogs/WristFeedNotificationsDialog';
import { YoutubeApiDialog } from './settings-dialogs/YoutubeApiDialog';
import { TablePageSizesDialog } from './SettingsViewParts';

export function SettingsDialogs() {
    const dialogs = useSettingsPageSection('dialogs');
    const customFont = {
        open: dialogs.customFontDialogOpen,
        setOpen: dialogs.setCustomFontDialogOpen,
        draft: dialogs.customFontDraft,
        setDraft: dialogs.setCustomFontDraft,
        options: dialogs.customFontOptions,
        loading: dialogs.customFontOptionsLoading,
        onSave: dialogs.saveCustomFontFamily
    };
    const youtubeApi = {
        open: dialogs.youtubeApiDialogOpen,
        setOpen: dialogs.setYoutubeApiDialogOpen,
        draft: dialogs.youtubeApiKeyDraft,
        setDraft: dialogs.setYoutubeApiKeyDraft,
        integrationStatus: dialogs.integrationStatus,
        onSave: dialogs.saveYoutubeApiKey
    };
    const translationApi = {
        open: dialogs.translationApiDialogOpen,
        setOpen: dialogs.setTranslationApiDialogOpen,
        draft: dialogs.translationDraft,
        setDraftValue: dialogs.setTranslationDraftValue,
        providerOptions: dialogs.translationProviderOptions,
        llmEndpoints: dialogs.llmEndpoints,
        integrationStatus: dialogs.integrationStatus,
        defaultModel: dialogs.translationDefaultModel,
        onTest: dialogs.testTranslationApiConfig,
        onSave: dialogs.saveTranslationApiConfig
    };
    const tablePageSizes = {
        open: dialogs.tablePageSizesDialogOpen,
        setOpen: dialogs.setTablePageSizesDialogOpen,
        onSaved: (tablePageSizes: number[]) =>
            dialogs.setPrefs((current) => ({ ...current, tablePageSizes }))
    };
    const tableLimits = {
        open: dialogs.tableLimitsDialogOpen,
        setOpen: dialogs.setTableLimitsDialogOpen,
        draft: dialogs.tableLimitsDraft,
        setDraft: dialogs.setTableLimitsDraft,
        tableMaxSizeError: dialogs.tableMaxSizeError,
        searchLimitError: dialogs.searchLimitError,
        saveDisabled: dialogs.tableLimitsSaveDisabled,
        onSave: dialogs.saveTableLimitsDialog
    };
    const avatarProvider = {
        open: dialogs.avatarProviderDialogOpen,
        setOpen: dialogs.setAvatarProviderDialogOpen,
        config: dialogs.avatarProviderConfig,
        onUpdate: dialogs.updateAvatarProvider,
        onSaveField: dialogs.saveAvatarProviderField,
        onRemove: dialogs.removeAvatarProvider,
        onAdd: dialogs.addAvatarProvider
    };
    const purge = {
        open: dialogs.purgeDialogOpen,
        setOpen: dialogs.setPurgeDialogOpen,
        period: dialogs.purgePeriod,
        setPeriod: dialogs.setPurgePeriod,
        inProgress: dialogs.purgeInProgress,
        onConfirm: dialogs.purgeAvatarFeedData
    };
    const wristFeedNotifications = {
        open: dialogs.wristFeedNotificationsDialogOpen,
        setOpen: dialogs.setWristFeedNotificationsDialogOpen,
        value: dialogs.overlayActivityFilters,
        onSave: dialogs.saveOverlayActivityFilters
    };
    const vrNotifications = {
        open: dialogs.vrNotificationsDialogOpen,
        setOpen: dialogs.setVrNotificationsDialogOpen,
        value: dialogs.vrNotificationActivityFilters,
        onSave: dialogs.saveVrNotificationActivityFilters
    };
    const hmdNotifications = {
        open: dialogs.hmdNotificationsDialogOpen,
        setOpen: dialogs.setHmdNotificationsDialogOpen,
        value: dialogs.hmdNotificationActivityFilters,
        onSave: dialogs.saveHmdNotificationActivityFilters
    };
    const desktopNotifications = {
        open: dialogs.desktopNotificationsDialogOpen,
        setOpen: dialogs.setDesktopNotificationsDialogOpen,
        value: dialogs.desktopNotificationActivityFilters,
        onSave: dialogs.saveDesktopNotificationActivityFilters
    };
    const desktopWidgetActivity = {
        open: dialogs.desktopWidgetDialogOpen,
        setOpen: dialogs.setDesktopWidgetDialogOpen,
        value: dialogs.desktopWidgetActivityFilters,
        onSave: dialogs.saveDesktopWidgetActivityFilters
    };
    const webhookNotifications = {
        open: dialogs.webhookNotificationsDialogOpen,
        setOpen: dialogs.setWebhookNotificationsDialogOpen,
        value: dialogs.webhookActivityFilters,
        onSave: dialogs.saveWebhookActivityFilters
    };
    const ttsNotifications = {
        open: dialogs.ttsNotificationsDialogOpen,
        setOpen: dialogs.setTtsNotificationsDialogOpen,
        value: dialogs.ttsNotificationActivityFilters,
        onSave: dialogs.saveTtsNotificationActivityFilters
    };
    return (
        <>
            <CustomFontDialog
                open={customFont.open}
                onOpenChange={customFont.setOpen}
                draft={customFont.draft}
                onDraftChange={customFont.setDraft}
                fontOptions={customFont.options}
                fontOptionsLoading={customFont.loading}
                onSave={customFont.onSave}
            />
            <YoutubeApiDialog
                open={youtubeApi.open}
                onOpenChange={youtubeApi.setOpen}
                draft={youtubeApi.draft}
                onDraftChange={youtubeApi.setDraft}
                integrationStatus={youtubeApi.integrationStatus}
                onSave={youtubeApi.onSave}
            />
            <TranslationApiDialog
                open={translationApi.open}
                onOpenChange={translationApi.setOpen}
                draft={translationApi.draft}
                onDraftValueChange={translationApi.setDraftValue}
                providerOptions={translationApi.providerOptions}
                llmEndpoints={translationApi.llmEndpoints}
                integrationStatus={translationApi.integrationStatus}
                defaultModel={translationApi.defaultModel}
                onTest={translationApi.onTest}
                onSave={translationApi.onSave}
            />
            <TablePageSizesDialog
                open={tablePageSizes.open}
                onOpenChange={tablePageSizes.setOpen}
                onSaved={tablePageSizes.onSaved}
            />
            <TableLimitsDialog
                open={tableLimits.open}
                onOpenChange={tableLimits.setOpen}
                draft={tableLimits.draft}
                onDraftChange={tableLimits.setDraft}
                tableMaxSizeError={tableLimits.tableMaxSizeError}
                searchLimitError={tableLimits.searchLimitError}
                saveDisabled={tableLimits.saveDisabled}
                onSave={tableLimits.onSave}
            />
            <AvatarProviderDialog
                open={avatarProvider.open}
                onOpenChange={avatarProvider.setOpen}
                config={avatarProvider.config}
                onUpdate={avatarProvider.onUpdate}
                onSaveField={avatarProvider.onSaveField}
                onRemove={avatarProvider.onRemove}
                onAdd={avatarProvider.onAdd}
            />
            <PurgeConfirmDialog
                open={purge.open}
                onOpenChange={purge.setOpen}
                period={purge.period}
                onPeriodChange={purge.setPeriod}
                inProgress={purge.inProgress}
                onConfirm={purge.onConfirm}
            />
            <WristFeedNotificationsDialog
                open={wristFeedNotifications.open}
                onOpenChange={wristFeedNotifications.setOpen}
                value={wristFeedNotifications.value}
                onSave={wristFeedNotifications.onSave}
            />
            <VrNotificationsDialog
                open={vrNotifications.open}
                onOpenChange={vrNotifications.setOpen}
                value={vrNotifications.value}
                onSave={vrNotifications.onSave}
            />
            <HmdNotificationsDialog
                open={hmdNotifications.open}
                onOpenChange={hmdNotifications.setOpen}
                value={hmdNotifications.value}
                onSave={hmdNotifications.onSave}
            />
            <DesktopNotificationsDialog
                open={desktopNotifications.open}
                onOpenChange={desktopNotifications.setOpen}
                value={desktopNotifications.value}
                onSave={desktopNotifications.onSave}
            />
            <DesktopWidgetActivityDialog
                open={desktopWidgetActivity.open}
                onOpenChange={desktopWidgetActivity.setOpen}
                value={desktopWidgetActivity.value}
                onSave={desktopWidgetActivity.onSave}
            />
            <WebhookNotificationsDialog
                open={webhookNotifications.open}
                onOpenChange={webhookNotifications.setOpen}
                value={webhookNotifications.value}
                onSave={webhookNotifications.onSave}
            />
            <TtsNotificationsDialog
                open={ttsNotifications.open}
                onOpenChange={ttsNotifications.setOpen}
                value={ttsNotifications.value}
                onSave={ttsNotifications.onSave}
            />
        </>
    );
}
