import { BoopEmojiDialog } from '../../BoopEmojiDialog';
import { InviteMessageDialog } from '../../InviteMessageDialog';
import {
    UserProfileDetailsDialog,
    UserSocialStatusDialog
} from '../UserSelfEditDialogs';
import { UserDialogGroupQuickModerationDialog } from './UserDialogGroupQuickModerationDialog';
import { UserNoteMemoDialog } from './UserNoteMemoDialog';

export function UserDialogContentDialogs({
    actionStatus,
    boopDialog,
    groupQuickModerationDialog,
    noteMemoDialog,
    socialStatusDialog,
    profileDetailsDialog,
    inviteMessageDialog
}: any) {
    return (
        <>
            <UserNoteMemoDialog
                open={noteMemoDialog.open}
                targetLabel={noteMemoDialog.targetLabel}
                editingCurrentUser={noteMemoDialog.editingCurrentUser}
                note={noteMemoDialog.note}
                memo={noteMemoDialog.memo}
                saving={noteMemoDialog.saving}
                onOpenChange={noteMemoDialog.onOpenChange}
                onNoteChange={noteMemoDialog.onNoteChange}
                onMemoChange={noteMemoDialog.onMemoChange}
                onCancel={noteMemoDialog.onCancel}
                onSave={noteMemoDialog.onSave}
            />
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
                allowImageUpload={Boolean(inviteMessageDialog.allowImageUpload)}
                onUse={inviteMessageDialog.onUse}
            />
            <BoopEmojiDialog
                open={Boolean(boopDialog.request)}
                endpoint={boopDialog.request?.endpoint}
                isLocalUserVrcPlusSupporter={
                    boopDialog.isLocalUserVrcPlusSupporter
                }
                targetLabel={boopDialog.request?.targetLabel || 'this user'}
                sendDisabled={actionStatus !== 'idle'}
                onOpenChange={boopDialog.onOpenChange}
                onSend={boopDialog.onSend}
            />
            <UserDialogGroupQuickModerationDialog
                open={Boolean(groupQuickModerationDialog.open)}
                endpoint={groupQuickModerationDialog.endpoint}
                currentUserId={groupQuickModerationDialog.currentUserId}
                targetUserId={groupQuickModerationDialog.targetUserId}
                targetLabel={groupQuickModerationDialog.targetLabel}
                targetImageUrl={groupQuickModerationDialog.targetImageUrl}
                onOpenChange={groupQuickModerationDialog.onOpenChange}
                onDetailedManagement={
                    groupQuickModerationDialog.onDetailedManagement
                }
            />
        </>
    );
}
