import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    notificationRepository,
    userProfileRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { recordRecentAction } from '@/services/recentActionService.js';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { normalizeId } from './friendsSidebarModel.js';

export function useFriendsSidebarActions({
    canInviteFromCurrentLocation,
    confirm,
    currentEndpoint,
    currentInviteLocation,
    currentUser,
    currentUserId,
    prompt
}) {
    const { t } = useTranslation();

    function openFriend(friend) {
        openUserDialog({
            userId: friend.id,
            title: friend.displayName || friend.username || undefined,
            seedData: friend
        });
    }

    async function launchFriendLocation(location) {
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
                    t('side_panel.generated.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t('side_panel.generated.unable_to_open_this_instance_in_vrchat')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.generated_toast.failed_to_launch_instance'
                      )
            );
        }
    }

    async function selfInviteToFriendLocation(location) {
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
            toast.success(t('side_panel.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.generated_toast.failed_to_send_self_invite'
                      )
            );
        }
    }

    async function sendFriendInvite(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'side_panel.generated.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'side_panel.generated.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'side_panel.generated.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('component.friends_sidebar.generated_modal.send_invite'),
            description: friend.displayName || friendId,
            confirmText: t('component.friends_sidebar.generated_modal.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint: currentEndpoint }
            );
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await notificationRepository.sendInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    instanceId: inviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName:
                        worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            recordRecentAction(friendId, 'Invite');
            toast.success(t('side_panel.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.generated_toast.failed_to_send_invite'
                      )
            );
        }
    }

    async function requestFriendInvite(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t(
                'component.friends_sidebar.generated_modal.request_invite'
            ),
            description: friend.displayName || friendId,
            confirmText: t(
                'component.friends_sidebar.generated_modal.request_invite_2'
            ),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await notificationRepository.sendRequestInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    platform: 'standalonewindows'
                }
            });
            recordRecentAction(friendId, 'Request Invite');
            toast.success(t('side_panel.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.generated_toast.failed_to_request_invite'
                      )
            );
        }
    }

    async function sendFriendBoop(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await prompt({
                title: t('component.friends_sidebar.generated_modal.send_boop'),
                description: t(
                    'component.friends_sidebar.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'
                ),
                inputValue: '',
                confirmText: t(
                    'component.friends_sidebar.generated_modal.send'
                ),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('side_panel.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.friends_sidebar.generated_toast.failed_to_send_boop'
                      )
            );
        }
    }

    async function saveCurrentUserPatch(
        patch,
        { successMessage, errorMessage }
    ) {
        if (!currentUserId) {
            toast.error(
                t(
                    'side_panel.generated.cannot_update_profile_no_current_user_session_is_available'
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
                    currentUserId: mergedUser.id,
                    currentUserDisplayName:
                        mergedUser.displayName || mergedUser.username || '',
                    currentUserSnapshot: mergedUser
                });
            }
            toast.success(successMessage);
        } catch (error) {
            toast.error(userFacingErrorMessage(error, errorMessage));
        }
    }

    async function changeCurrentUserStatus(status) {
        await saveCurrentUserPatch(
            { status },
            {
                successMessage: 'Social status updated.',
                errorMessage: 'Failed to update social status.'
            }
        );
    }

    async function setCurrentUserStatusDescription(statusDescription) {
        await saveCurrentUserPatch(
            { statusDescription },
            {
                successMessage: 'Status description updated.',
                errorMessage: 'Failed to update status description.'
            }
        );
    }

    async function editCurrentUserStatusDescription() {
        const result = await prompt({
            title: t(
                'component.friends_sidebar.generated_modal.edit_status_description'
            ),
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

    async function applyCurrentUserStatusPreset(preset) {
        if (!preset?.status) {
            return;
        }
        const patch = { status: preset.status };
        if (Object.prototype.hasOwnProperty.call(preset, 'statusDescription')) {
            patch.statusDescription = preset.statusDescription || '';
        }
        await saveCurrentUserPatch(patch, {
            successMessage: 'Status updated.',
            errorMessage: 'Failed to update status.'
        });
    }

    return {
        openFriend,
        rowActions: {
            open: openFriend,
            launch: launchFriendLocation,
            selfInvite: selfInviteToFriendLocation,
            invite: sendFriendInvite,
            requestInvite: requestFriendInvite,
            boop: sendFriendBoop,
            changeStatus: changeCurrentUserStatus,
            setStatusDescription: setCurrentUserStatusDescription,
            editStatusDescription: editCurrentUserStatusDescription,
            applyStatusPreset: applyCurrentUserStatusPreset
        }
    };
}
