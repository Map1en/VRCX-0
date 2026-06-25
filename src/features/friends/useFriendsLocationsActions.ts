import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import {
    sendBoopToUser,
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';

import {
    normalizeFriendsLocationId as normalizeId,
    resolveWorldDialogTarget
} from './friendsLocationsRows';

export function useFriendsLocationsActions({
    canInviteFromCurrentLocation,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    friendsMap,
    setCollapsedFavoriteGroups
}: {
    canInviteFromCurrentLocation: boolean;
    currentEndpoint: string;
    currentInviteLocation: string;
    currentUserId: string;
    friendsMap: Map<string, any>;
    setCollapsedFavoriteGroups: Dispatch<SetStateAction<Set<unknown>>>;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const boopPrompt = useModalStore((state: any) => state.boopPrompt);

    function toggleFavoriteGroup(groupKey: any) {
        setCollapsedFavoriteGroups((current: any) => {
            const next = new Set(current);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }

    function canUseFriendLocation(location: any) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return false;
        }
        return checkCanInviteSelf(location, {
            currentUserId,
            cachedInstances: new Map(),
            friends: friendsMap
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
                parsedLocation.shortName || '',
                currentEndpoint
            );
            if (opened) {
                toast.success(
                    t('view.friend_list.success.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t(
                    'view.friend_list.error.unable_to_open_this_instance_in_vrchat'
                )
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.toast.failed_to_launch_instance')
            );
        }
    }

    async function selfInviteFriendLocation(location: any) {
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
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.toast.failed_to_send_self_invite')
            );
        }
    }

    async function sendFriendInvite(friend: any) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'view.friend_list.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'view.friend_list.error.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'view.friend_list.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('view.friends.modal.send_invite'),
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: t('view.friends.modal.invite'),
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
            toast.success(t('message.invite.sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.toast.failed_to_send_invite')
            );
        }
    }

    async function requestFriendInvite(friend: any) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.modal.request_invite'),
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: t('view.friends.modal.request_invite_2'),
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
            toast.success(t('view.friend_list.success.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.toast.failed_to_request_invite')
            );
        }
    }

    async function sendFriendBoop(friend: any) {
        const friendId = normalizeId(friend?.id || friend?.userId);
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
            toast.success(t('view.friend_list.success.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.toast.failed_to_send_boop')
            );
        }
    }

    function openSectionWorld(section: any) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(section),
            title: section.title
        });
    }

    function openSectionGroup(section: any) {
        openGroupDialog({
            groupId: section.groupId,
            title: undefined
        });
    }

    function openFriendUser(friend: any) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined,
            seedData: friend
        });
    }

    function openFriendWorld(target: any, location: any) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(target),
            title: location.label || undefined
        });
    }

    function openFriendGroup(target: any) {
        openGroupDialog({
            groupId: target.groupId,
            title: undefined
        });
    }

    return {
        canUseFriendLocation,
        launchFriendLocation,
        openFriendGroup,
        openFriendUser,
        openFriendWorld,
        openSectionGroup,
        openSectionWorld,
        requestFriendInvite,
        selfInviteFriendLocation,
        sendFriendBoop,
        sendFriendInvite,
        toggleFavoriteGroup
    };
}
