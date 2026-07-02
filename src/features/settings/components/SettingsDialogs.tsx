import { AvatarProviderDialog } from './settings-dialogs/AvatarProviderDialog';
import { CustomFontDialog } from './settings-dialogs/CustomFontDialog';
import { FeedFilterDialog } from './settings-dialogs/FeedFilterDialog';
import { PurgeConfirmDialog } from './settings-dialogs/PurgeConfirmDialog';
import { TableLimitsDialog } from './settings-dialogs/TableLimitsDialog';
import { TranslationApiDialog } from './settings-dialogs/TranslationApiDialog';
import {
    DesktopNotificationsDialog,
    WebhookNotificationsDialog,
    VrNotificationsDialog,
    WristFeedNotificationsDialog
} from './settings-dialogs/WristFeedNotificationsDialog';
import { YoutubeApiDialog } from './settings-dialogs/YoutubeApiDialog';
import { TablePageSizesDialog } from './SettingsViewParts';

export function SettingsDialogs({
    customFont,
    youtubeApi,
    translationApi,
    tablePageSizes,
    tableLimits,
    avatarProvider,
    purge,
    feedFilter,
    wristFeedNotifications,
    vrNotifications,
    desktopNotifications,
    webhookNotifications
}: any) {
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
                onFetchModels={translationApi.onFetchModels}
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
            <FeedFilterDialog
                open={feedFilter.open}
                onOpenChange={feedFilter.setOpen}
                mode={feedFilter.mode}
                options={feedFilter.options}
                filters={feedFilter.filters}
                onUpdate={feedFilter.onUpdate}
                onReset={feedFilter.onReset}
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
            <DesktopNotificationsDialog
                open={desktopNotifications.open}
                onOpenChange={desktopNotifications.setOpen}
                value={desktopNotifications.value}
                onSave={desktopNotifications.onSave}
            />
            <WebhookNotificationsDialog
                open={webhookNotifications.open}
                onOpenChange={webhookNotifications.setOpen}
                value={webhookNotifications.value}
                onSave={webhookNotifications.onSave}
            />
        </>
    );
}
