import { InviteMessageDialog } from '../../InviteMessageDialog.jsx';
import {
    UserLanguageDialog,
    UserSocialStatusDialog
} from '../UserSelfEditDialogs.jsx';

export function UserDialogContentDialogs({
    actionStatus,
    socialStatusDialog,
    languageDialog,
    inviteMessageDialog
}) {
    return (
        <>
            <UserSocialStatusDialog
                open={socialStatusDialog.open}
                onOpenChange={socialStatusDialog.onOpenChange}
                actionStatus={actionStatus}
                draft={socialStatusDialog.draft}
                setDraft={socialStatusDialog.setDraft}
                statusHistoryRows={socialStatusDialog.statusHistoryRows}
                statusOptions={socialStatusDialog.statusOptions}
                statusPresets={socialStatusDialog.statusPresets}
                statusLabelByValue={socialStatusDialog.statusLabelByValue}
                onSavePreset={socialStatusDialog.onSavePreset}
                onRemovePreset={socialStatusDialog.onRemovePreset}
                onCancel={socialStatusDialog.onCancel}
                onSave={socialStatusDialog.onSave}
            />
            <UserLanguageDialog
                open={languageDialog.open}
                onOpenChange={languageDialog.onOpenChange}
                actionStatus={actionStatus}
                currentLanguageRows={languageDialog.currentLanguageRows}
                availableLanguageOptions={languageDialog.availableLanguageOptions}
                selectedLanguageToAdd={languageDialog.selectedLanguageToAdd}
                languageOptionsStatus={languageDialog.languageOptionsStatus}
                onSelectedLanguageChange={languageDialog.onSelectedLanguageChange}
                onAddLanguage={languageDialog.onAddLanguage}
                onRemoveLanguage={languageDialog.onRemoveLanguage}
            />
            <InviteMessageDialog
                open={Boolean(inviteMessageDialog.request)}
                onOpenChange={inviteMessageDialog.onOpenChange}
                currentUserId={
                    inviteMessageDialog.request?.context?.messageOwnerUserId ||
                    inviteMessageDialog.normalizedCurrentUserId
                }
                endpoint={
                    inviteMessageDialog.request?.context?.endpoint ||
                    inviteMessageDialog.currentEndpoint
                }
                messageType={
                    inviteMessageDialog.request?.messageType || 'message'
                }
                mode="select"
                title={
                    inviteMessageDialog.request?.kind === 'request'
                        ? 'Request With Message'
                        : 'Send With Message'
                }
                targetLabel={
                    inviteMessageDialog.request?.context?.targetLabel ||
                    inviteMessageDialog.targetLabel ||
                    'this user'
                }
                allowEdit={false}
                allowImageUpload={false}
                onUse={inviteMessageDialog.onUse}
            />
        </>
    );
}
