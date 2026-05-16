// @ts-nocheck
import { InviteMessageDialog } from '../../InviteMessageDialog';
import {
    UserProfileDetailsDialog,
    UserSocialStatusDialog
} from '../UserSelfEditDialogs';

export function UserDialogContentDialogs({
    actionStatus,
    socialStatusDialog,
    profileDetailsDialog,
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
            <UserProfileDetailsDialog
                open={profileDetailsDialog.open}
                onOpenChange={profileDetailsDialog.onOpenChange}
                actionStatus={actionStatus}
                draft={profileDetailsDialog.draft}
                setDraft={profileDetailsDialog.setDraft}
                languageRows={profileDetailsDialog.languageRows}
                availableLanguageOptions={
                    profileDetailsDialog.availableLanguageOptions
                }
                languageOptionsStatus={
                    profileDetailsDialog.languageOptionsStatus
                }
                onCancel={profileDetailsDialog.onCancel}
                onSave={profileDetailsDialog.onSave}
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
