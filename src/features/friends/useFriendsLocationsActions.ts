import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { FriendRecord } from '@/domain/friends/friendRosterTypes';
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
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';

import {
    normalizeFriendsLocationId as normalizeId,
    resolveWorldDialogTarget
} from './friendsLocationsRows';

type FriendsLocationsSectionActionTarget = Record<string, unknown> & {
    groupId?: string;
    title?: string;
};

type FriendsLocationsLocationActionSummary = {
    label?: unknown;
};

function getFriendActionLabel(friend: FriendRecord, fallback: string): string {
    return friend.displayName || normalizeId(friend.username) || fallback;
}

export function useFriendsLocationsActions({
    canInviteFromCurrentLocation,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    setCollapsedGroups,
    instanceActionGatesByLocation
}: {
    canInviteFromCurrentLocation: boolean;
    currentEndpoint: string;
    currentInviteLocation: string;
    currentUserId: string;
    setCollapsedGroups: Dispatch<SetStateAction<Set<string>>>;
    instanceActionGatesByLocation: Map<string, LocalInstanceActionGates>;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const boopPrompt = useModalStore((state) => state.boopPrompt);

    function toggleCollapsibleGroup(groupKey: string) {
        setCollapsedGroups((current) => {
            const next = new Set(current);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }

    function canUseFriendLocation(location: string) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return false;
        }
        return Boolean(instanceActionGatesByLocation.get(location)?.canJoin);
    }

    async function launchFriendLocation(location: string) {
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

    async function selfInviteFriendLocation(location: string) {
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

    async function sendFriendInvite(friend: FriendRecord) {
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
            description: getFriendActionLabel(friend, 'this user'),
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

    async function requestFriendInvite(friend: FriendRecord) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.modal.request_invite'),
            description: getFriendActionLabel(friend, 'this user'),
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

    async function sendFriendBoop(friend: FriendRecord) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await boopPrompt({
                endpoint: currentEndpoint,
                targetLabel: getFriendActionLabel(friend, friendId)
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

    function openSectionWorld(section: FriendsLocationsSectionActionTarget) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(section),
            title: section.title
        });
    }

    function openSectionGroup(section: FriendsLocationsSectionActionTarget) {
        openGroupDialog({
            groupId: section.groupId,
            title: undefined
        });
    }

    function openFriendUser(friend: FriendRecord) {
        openUserDialog({
            userId: friend?.id,
            title: getFriendActionLabel(friend, '') || undefined,
            seedData: friend
        });
    }

    function openFriendWorld(
        target: FriendsLocationsSectionActionTarget,
        location: FriendsLocationsLocationActionSummary
    ) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(target),
            title: location.label || undefined
        });
    }

    function openFriendGroup(target: FriendsLocationsSectionActionTarget) {
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
        toggleCollapsibleGroup
    };
}
