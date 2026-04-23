import { OpenSourceNoticeDialog } from './OpenSourceNoticeDialog.jsx';
import { TablePageSizesDialog } from './SettingsViewParts.jsx';
import { AvatarProviderDialog } from './settings-dialogs/AvatarProviderDialog.jsx';
import { CustomFontDialog } from './settings-dialogs/CustomFontDialog.jsx';
import { FeedFilterDialog } from './settings-dialogs/FeedFilterDialog.jsx';
import { PurgeConfirmDialog } from './settings-dialogs/PurgeConfirmDialog.jsx';
import { TableLimitsDialog } from './settings-dialogs/TableLimitsDialog.jsx';
import { TranslationApiDialog } from './settings-dialogs/TranslationApiDialog.jsx';
import { YoutubeApiDialog } from './settings-dialogs/YoutubeApiDialog.jsx';

export function SettingsDialogs({
    t,
    customFont,
    youtubeApi,
    translationApi,
    tablePageSizes,
    tableLimits,
    avatarProvider,
    purge,
    feedFilter,
    openSourceNotice
}) {
    return (
        <>
            <CustomFontDialog
                t={t}
                open={customFont.open}
                onOpenChange={customFont.setOpen}
                draft={customFont.draft}
                onDraftChange={customFont.setDraft}
                onSave={customFont.onSave}
            />
            <YoutubeApiDialog
                t={t}
                open={youtubeApi.open}
                onOpenChange={youtubeApi.setOpen}
                draft={youtubeApi.draft}
                onDraftChange={youtubeApi.setDraft}
                integrationStatus={youtubeApi.integrationStatus}
                onSave={youtubeApi.onSave}
            />
            <TranslationApiDialog
                t={t}
                open={translationApi.open}
                onOpenChange={translationApi.setOpen}
                draft={translationApi.draft}
                onDraftValueChange={translationApi.setDraftValue}
                providerOptions={translationApi.providerOptions}
                availableModels={translationApi.fetchedModels}
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
                t={t}
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
                t={t}
                open={avatarProvider.open}
                onOpenChange={avatarProvider.setOpen}
                config={avatarProvider.config}
                onUpdate={avatarProvider.onUpdate}
                onSaveField={avatarProvider.onSaveField}
                onRemove={avatarProvider.onRemove}
                onAdd={avatarProvider.onAdd}
            />
            <PurgeConfirmDialog
                t={t}
                open={purge.open}
                onOpenChange={purge.setOpen}
                period={purge.period}
                onPeriodChange={purge.setPeriod}
                inProgress={purge.inProgress}
                onConfirm={purge.onConfirm}
            />
            <FeedFilterDialog
                t={t}
                open={feedFilter.open}
                onOpenChange={feedFilter.setOpen}
                mode={feedFilter.mode}
                onModeChange={feedFilter.setMode}
                options={feedFilter.options}
                filters={feedFilter.filters}
                onUpdate={feedFilter.onUpdate}
                onReset={feedFilter.onReset}
            />
            <OpenSourceNoticeDialog
                open={openSourceNotice.open}
                onOpenChange={openSourceNotice.setOpen}
                t={t}
            />
        </>
    );
}
