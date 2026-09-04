import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useCurrentUserSocialStatusDialog } from '@/components/dialogs/user-dialog/useCurrentUserSocialStatusDialog';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type {
    CurrentUserUpdateRequest,
    UserStatus
} from '@/platform/tauri/bindings';
import currentUserProfileService from '@/services/currentUserProfileService';
import { openUserDialog } from '@/services/dialogService';
import {
    sendBoopToUser,
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { recordRecentAction } from '@/services/recentActionService';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { StatusPreset } from './FriendsSidebarActionItems';
import type { SidebarFriendRecord } from './friendsSidebarModel';

type ModalStoreActions = ReturnType<typeof useModalStore.getState>;
type CurrentUserRecord = Record<string, unknown>;

type FriendsSidebarActionsInput = {
    canInviteFromCurrentLocation?: boolean;
    confirm: ModalStoreActions['confirm'];
    currentInviteLocation?: string;
    currentUser?: CurrentUserRecord | null;
    currentUserId?: string | null;
};

type SaveCurrentUserPatchMessages = {
    successMessage: string;
    errorMessage: string;
};

export function useFriendsSidebarActions({
    canInviteFromCurrentLocation,
    confirm,
    currentInviteLocation,
    currentUser,
    currentUserId
}: FriendsSidebarActionsInput) {
    const { t } = useTranslation();
    const boopPrompt = useModalStore((state) => state.boopPrompt);
    const {
        dialog: socialStatusDialog,
        openDialog: editCurrentUserSocialStatus
    } = useCurrentUserSocialStatusDialog({
        profile: currentUser ?? null,
        currentUserSnapshot: currentUser ?? null,
        onSave: (patch) =>
            saveCurrentUserPatch(patch, {
                successMessage: t(
                    'component.friends_sidebar.success.social_status_updated'
                ),
                errorMessage: t(
                    'component.friends_sidebar.toast.failed_to_update_social_status'
                )
            })
    });

    function openFriend(friend: SidebarFriendRecord) {
        openUserDialog({
            userId: friend.id,
            title: friend.displayName || friend.username || undefined,
            seedData: friend
        });
    }

    async function selfInviteToFriendLocation(location: string) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        try {
            await selfInviteToInstance(
                parsedLocation.tag,
                parsedLocation.shortName
            );
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.toast.failed_to_send_self_invite'
                      )
            );
        }
    }

    async function sendFriendInvite(friend: SidebarFriendRecord) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'side_panel.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'side_panel.error.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'side_panel.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('component.friends_sidebar.modal.send_invite'),
            description: friend.displayName || friendId,
            confirmText: t('component.friends_sidebar.modal.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const inviteLocation =
                normalizeId(parsedLocation.tag) ||
                normalizeId(currentInviteLocation);
            await sendInviteToLocation({
                receiverUserId: friendId,
                instanceId: inviteLocation,
                worldId: normalizeId(parsedLocation.worldId),
                rsvp: true
            });
            recordRecentAction(friendId, 'Invite');
            toast.success(t('message.invite.sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.friends_sidebar.toast.failed_to_send_invite')
            );
        }
    }

    async function requestFriendInvite(friend: SidebarFriendRecord) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t('component.friends_sidebar.modal.request_invite'),
            description: friend.displayName || friendId,
            confirmText: t('component.friends_sidebar.modal.request_invite_2'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await sendRequestInviteToUser({
                receiverUserId: friendId
            });
            recordRecentAction(friendId, 'Request Invite');
            toast.success(t('side_panel.success.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.toast.failed_to_request_invite'
                      )
            );
        }
    }

    async function sendFriendBoop(friend: SidebarFriendRecord) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await boopPrompt({
                targetLabel: friend?.displayName || friend?.username || friendId
            });
            if (!result.ok) {
                return;
            }
            await sendBoopToUser({
                userId: friendId,
                emojiId: result.value
            });
            toast.success(t('side_panel.success.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.friends_sidebar.toast.failed_to_send_boop')
            );
        }
    }

    async function saveCurrentUserPatch(
        patch: CurrentUserUpdateRequest,
        { successMessage, errorMessage }: SaveCurrentUserPatchMessages
    ) {
        if (!currentUserId) {
            toast.error(
                t(
                    'side_panel.error.cannot_update_profile_no_current_user_session_is_available'
                )
            );
            return false;
        }
        try {
            const nextUser = await currentUserProfileService.updateCurrentUser({
                userId: currentUserId,
                params: patch
            });
            if (nextUser?.id) {
                const previousUser =
                    useRuntimeStore.getState().auth.currentUserSnapshot;
                const mergedUser = mergeCurrentUserPresenceFields(
                    nextUser,
                    previousUser
                );
                useRuntimeStore.getState().setAuthBootstrap({
                    currentUserId: String(mergedUser.id),
                    currentUserDisplayName: String(
                        mergedUser.displayName || mergedUser.username || ''
                    ),
                    currentUserSnapshot: mergedUser
                });
            }
            toast.success(successMessage);
            return true;
        } catch (error) {
            toast.error(userFacingErrorMessage(error, errorMessage));
            return false;
        }
    }

    async function changeCurrentUserStatus(status: UserStatus) {
        await saveCurrentUserPatch(
            { status },
            {
                successMessage: t(
                    'component.friends_sidebar.success.social_status_updated'
                ),
                errorMessage: t(
                    'component.friends_sidebar.toast.failed_to_update_social_status'
                )
            }
        );
    }

    async function setCurrentUserStatusDescription(statusDescription: string) {
        await saveCurrentUserPatch(
            { statusDescription },
            {
                successMessage: t(
                    'component.friends_sidebar.success.status_description_updated'
                ),
                errorMessage: t(
                    'component.friends_sidebar.toast.failed_to_update_status_description'
                )
            }
        );
    }

    async function applyCurrentUserStatusPreset(preset: StatusPreset) {
        const status = preset.status;
        if (!status) {
            return;
        }
        const patch: CurrentUserUpdateRequest = { status };
        if (preset.statusDescription !== undefined) {
            patch.statusDescription = preset.statusDescription;
        }
        await saveCurrentUserPatch(patch, {
            successMessage: t(
                'component.friends_sidebar.success.status_updated'
            ),
            errorMessage: t(
                'component.friends_sidebar.toast.failed_to_update_status'
            )
        });
    }

    return {
        applyCurrentUserStatusPreset,
        changeCurrentUserStatus,
        editCurrentUserSocialStatus,
        openFriend,
        requestFriendInvite,
        selfInviteToFriendLocation,
        sendFriendBoop,
        sendFriendInvite,
        setCurrentUserStatusDescription,
        socialStatusDialog
    };
}
