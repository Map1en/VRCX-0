import { InviteMessageDialog } from '../../InviteMessageDialog.jsx';
import {
    UserLanguageDialog,
    UserSocialStatusDialog
} from '../UserSelfEditDialogs.jsx';

export function UserDialogContentDialogs({
    actionStatus,
    socialStatusDialogOpen,
    onSocialStatusOpenChange,
    socialStatusDraft,
    setSocialStatusDraft,
    statusHistoryRows,
    selfStatusOptions,
    statusPresets,
    selfStatusLabelByValue,
    onSaveStatusPreset,
    onRemoveStatusPreset,
    onCancelSocialStatus,
    onSaveSocialStatus,
    languageDialogOpen,
    onLanguageOpenChange,
    currentLanguageRows,
    availableLanguageOptions,
    selectedLanguageToAdd,
    languageOptionsStatus,
    onSelectedLanguageChange,
    onAddLanguage,
    onRemoveLanguage,
    inviteMessageRequest,
    onInviteMessageOpenChange,
    normalizedCurrentUserId,
    currentEndpoint,
    targetLabel,
    onUseInviteMessage
}) {
    return (
        <>
            <UserSocialStatusDialog
                open={socialStatusDialogOpen}
                onOpenChange={onSocialStatusOpenChange}
                actionStatus={actionStatus}
                draft={socialStatusDraft}
                setDraft={setSocialStatusDraft}
                statusHistoryRows={statusHistoryRows}
                statusOptions={selfStatusOptions}
                statusPresets={statusPresets}
                statusLabelByValue={selfStatusLabelByValue}
                onSavePreset={onSaveStatusPreset}
                onRemovePreset={onRemoveStatusPreset}
                onCancel={onCancelSocialStatus}
                onSave={onSaveSocialStatus}
            />
            <UserLanguageDialog
                open={languageDialogOpen}
                onOpenChange={onLanguageOpenChange}
                actionStatus={actionStatus}
                currentLanguageRows={currentLanguageRows}
                availableLanguageOptions={availableLanguageOptions}
                selectedLanguageToAdd={selectedLanguageToAdd}
                languageOptionsStatus={languageOptionsStatus}
                onSelectedLanguageChange={onSelectedLanguageChange}
                onAddLanguage={onAddLanguage}
                onRemoveLanguage={onRemoveLanguage}
            />
            <InviteMessageDialog
                open={Boolean(inviteMessageRequest)}
                onOpenChange={onInviteMessageOpenChange}
                currentUserId={
                    inviteMessageRequest?.context?.messageOwnerUserId ||
                    normalizedCurrentUserId
                }
                endpoint={
                    inviteMessageRequest?.context?.endpoint || currentEndpoint
                }
                messageType={inviteMessageRequest?.messageType || 'message'}
                mode="select"
                title={
                    inviteMessageRequest?.kind === 'request'
                        ? 'Request With Message'
                        : 'Send With Message'
                }
                targetLabel={
                    inviteMessageRequest?.context?.targetLabel ||
                    targetLabel ||
                    'this user'
                }
                allowEdit={false}
                allowImageUpload={false}
                onUse={onUseInviteMessage}
            />
        </>
    );
}
