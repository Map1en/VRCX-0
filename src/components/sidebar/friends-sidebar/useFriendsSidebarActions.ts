import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
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

export function useFriendsSidebarActions({
    canInviteFromCurrentLocation,
    confirm,
    currentEndpoint,
    currentInviteLocation,
    currentUser,
    currentUserId,
    prompt
}: any) {
    const { t } = useTranslation();
    const boopPrompt = useModalStore((state: any) => state.boopPrompt);

    function openFriend(friend: any) {
        openUserDialog({
            userId: friend.id,
            title: friend.displayName || friend.username || undefined,
            seedData: friend
        });
    }

    async function launchFriendLocation(location: any) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parsedLocation.shortName,
                currentEndpoint
            );
            if (opened) {
                toast.success(
                    t('side_panel.success.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t('side_panel.error.unable_to_open_this_instance_in_vrchat')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.toast.failed_to_launch_instance'
                      )
            );
        }
    }

    async function selfInviteToFriendLocation(location: any) {
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
                location,
                parsedLocation.shortName,
                currentEndpoint
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

    async function sendFriendInvite(friend: any) {
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
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await sendInviteToLocation({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                instanceId: inviteLocation,
                worldId: parsedLocation.worldId,
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

    async function requestFriendInvite(friend: any) {
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
                receiverUserId: friendId,
                endpoint: currentEndpoint
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

    async function sendFriendBoop(friend: any) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await boopPrompt({
                endpoint: currentEndpoint,
                targetLabel: friend?.displayName || friend?.username || friendId
            });
            if (!result.ok) {
                return;
            }
            await sendBoopToUser({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
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
        patch: any,
        { successMessage, errorMessage }: any
    ) {
        if (!currentUserId) {
            toast.error(
                t(
                    'side_panel.error.cannot_update_profile_no_current_user_session_is_available'
                )
            );
            return;
        }
        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
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
        } catch (error) {
            toast.error(userFacingErrorMessage(error, errorMessage));
        }
    }

    async function changeCurrentUserStatus(status: any) {
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

    async function setCurrentUserStatusDescription(statusDescription: any) {
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

    async function editCurrentUserStatusDescription() {
        const result = await prompt({
            title: t('component.friends_sidebar.modal.edit_status_description'),
            inputValue: currentUser?.statusDescription || '',
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        await setCurrentUserStatusDescription(result.value);
    }

    async function applyCurrentUserStatusPreset(preset: any) {
        if (!preset?.status) {
            return;
        }
        const patch: any = { status: preset.status };
        if (Object.prototype.hasOwnProperty.call(preset, 'statusDescription')) {
            patch.statusDescription = preset.statusDescription || '';
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
        editCurrentUserStatusDescription,
        launchFriendLocation,
        openFriend,
        requestFriendInvite,
        selfInviteToFriendLocation,
        sendFriendBoop,
        sendFriendInvite,
        setCurrentUserStatusDescription
    };
}
