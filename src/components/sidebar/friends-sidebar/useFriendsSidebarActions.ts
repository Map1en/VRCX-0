import { useTranslation } from 'react-i18next';

import { useCurrentUserSocialStatusDialog } from '@/components/dialogs/user-dialog/useCurrentUserSocialStatusDialog';
import type { SidebarFriendRecord } from '@/components/friends/friendStatusModel';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type {
    CurrentUserUpdateRequest,
    UserStatus
} from '@/platform/tauri/bindings';
import currentUserProfileService from '@/services/currentUserProfileService';
import { openUserDialog } from '@/services/dialogService';
import {
    boopFriend,
    requestInviteFromFriend
} from '@/services/friendActionService';
import { sendInviteToLocation } from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { recordRecentAction } from '@/services/recentActionService';
import { toast } from '@/services/toastService';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { StatusPreset } from './FriendsSidebarActionItems';

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
            toast.add({
                type: 'success',
                title: t('message.invite.self_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.friends_sidebar.toast.failed_to_send_self_invite'
                          )
            });
        }
    }

    async function sendFriendInvite(friend: SidebarFriendRecord) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.add({
                type: 'error',
                title: t(
                    'side_panel.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            });
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.add({
                type: 'error',
                title: t(
                    'side_panel.error.cannot_invite_from_the_current_instance_type'
                )
            });
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.add({
                type: 'error',
                title: t(
                    'side_panel.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            });
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
            toast.add({ type: 'success', title: t('message.invite.sent') });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.friends_sidebar.toast.failed_to_send_invite'
                          )
            });
        }
    }

    function requestFriendInvite(friend: SidebarFriendRecord) {
        return requestInviteFromFriend({
            id: friend?.id,
            label: friend?.displayName || ''
        });
    }

    function sendFriendBoop(friend: SidebarFriendRecord) {
        return boopFriend({
            id: friend?.id,
            label: friend?.displayName || friend?.username || ''
        });
    }

    async function saveCurrentUserPatch(
        patch: CurrentUserUpdateRequest,
        { successMessage, errorMessage }: SaveCurrentUserPatchMessages
    ) {
        if (!currentUserId) {
            toast.add({
                type: 'error',
                title: t(
                    'side_panel.error.cannot_update_profile_no_current_user_session_is_available'
                )
            });
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
            toast.add({ type: 'success', title: successMessage });
            return true;
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(error, errorMessage)
            });
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
