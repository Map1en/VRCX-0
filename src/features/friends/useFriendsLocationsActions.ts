import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    type Dispatch,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import type { FriendRecord } from '@/domain/friends/types';
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
import { toast } from '@/services/toastService';
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';

import { resolveWorldDialogTarget } from './friendsLocationsRows';
import type { FriendsLocationsWorldGroup } from './friendsLocationsWorlds';

type FriendsLocationsSectionActionTarget = Record<string, unknown> & {
    groupId?: string;
    title?: string;
};

type FriendsLocationsLocationActionSummary = {
    label?: unknown;
};

function getFriendActionLabel(friend: FriendRecord, fallback: string): string {
    return friend.displayName || normalizeString(friend.username) || fallback;
}

function openSectionWorld(section: FriendsLocationsSectionActionTarget) {
    openWorldDialog({
        worldId: resolveWorldDialogTarget(section),
        title: section.title
    });
}

function openWorldGroup(group: FriendsLocationsWorldGroup, name: string) {
    openWorldDialog({
        worldId: group.worldId,
        title: name || undefined
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
        title: normalizeString(location.label) || undefined
    });
}

export function useFriendsLocationsActions({
    canInviteFromCurrentLocation,
    currentInviteLocation,
    currentUserId,
    setCollapsedGroups,
    instanceActionGatesByLocation
}: {
    canInviteFromCurrentLocation: boolean;
    currentInviteLocation: string;
    currentUserId: string;
    setCollapsedGroups: Dispatch<SetStateAction<Set<string>>>;
    instanceActionGatesByLocation: Map<string, LocalInstanceActionGates>;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const boopPrompt = useModalStore((state) => state.boopPrompt);

    const toggleCollapsibleGroup = useCallback(
        (groupKey: string) => {
            setCollapsedGroups((current) => {
                const next = new Set(current);
                if (next.has(groupKey)) {
                    next.delete(groupKey);
                } else {
                    next.add(groupKey);
                }
                return next;
            });
        },
        [setCollapsedGroups]
    );

    const joinableLocationsKey = Array.from(instanceActionGatesByLocation)
        .filter(([, gates]) => gates.canJoin)
        .map(([location]) => location)
        .sort()
        .join('\u0000');
    const joinableLocations = useMemo(
        () =>
            new Set(
                joinableLocationsKey ? joinableLocationsKey.split('\u0000') : []
            ),
        [joinableLocationsKey]
    );
    const canUseFriendLocation = useCallback(
        (location: string) => {
            const parsedLocation = parseLocation(location);
            if (
                !parsedLocation.isRealInstance ||
                !parsedLocation.worldId ||
                !parsedLocation.instanceId
            ) {
                return false;
            }
            return joinableLocations.has(location);
        },
        [joinableLocations]
    );

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
                parsedLocation.shortName || ''
            );
            if (opened) {
                toast.add({
                    type: 'success',
                    title: t(
                        'view.friend_list.success.vrchat_launch_request_sent'
                    )
                });
                return;
            }
            toast.add({
                type: 'error',
                title: t(
                    'view.friend_list.error.unable_to_open_this_instance_in_vrchat'
                )
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.friends.toast.failed_to_launch_instance')
            });
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
                parsedLocation.shortName || ''
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
                        : t('view.friends.toast.failed_to_send_self_invite')
            });
        }
    }

    async function sendFriendInvite(friend: FriendRecord) {
        const friendId = normalizeString(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeString(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.add({
                type: 'error',
                title: t(
                    'view.friend_list.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            });
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.add({
                type: 'error',
                title: t(
                    'view.friend_list.error.cannot_invite_from_the_current_instance_type'
                )
            });
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.add({
                type: 'error',
                title: t(
                    'view.friend_list.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            });
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
                instanceId: inviteLocation,
                worldId: parsedLocation.worldId,
                rsvp: true
            });
            toast.add({ type: 'success', title: t('message.invite.sent') });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.friends.toast.failed_to_send_invite')
            });
        }
    }

    async function requestFriendInvite(friend: FriendRecord) {
        const friendId = normalizeString(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeString(currentUserId)) {
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
                receiverUserId: friendId
            });
            toast.add({
                type: 'success',
                title: t('view.friend_list.success.invite_request_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.friends.toast.failed_to_request_invite')
            });
        }
    }

    async function sendFriendBoop(friend: FriendRecord) {
        const friendId = normalizeString(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeString(currentUserId)) {
            return;
        }
        try {
            const result = await boopPrompt({
                targetLabel: getFriendActionLabel(friend, friendId)
            });
            if (!result.ok) {
                return;
            }
            await sendBoopToUser({
                userId: friendId,
                emoji: result.value ?? null
            });
            toast.add({
                type: 'success',
                title: t('view.friend_list.success.boop_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.friends.toast.failed_to_send_boop')
            });
        }
    }

    const handlers = {
        launchFriendLocation,
        requestFriendInvite,
        selfInviteFriendLocation,
        sendFriendBoop,
        sendFriendInvite
    };
    const latestHandlers = useRef(handlers);
    useLayoutEffect(() => {
        latestHandlers.current = handlers;
    });
    const stableHandlers = useMemo<typeof handlers>(
        () => ({
            launchFriendLocation: (location) =>
                latestHandlers.current.launchFriendLocation(location),
            requestFriendInvite: (friend) =>
                latestHandlers.current.requestFriendInvite(friend),
            selfInviteFriendLocation: (location) =>
                latestHandlers.current.selfInviteFriendLocation(location),
            sendFriendBoop: (friend) =>
                latestHandlers.current.sendFriendBoop(friend),
            sendFriendInvite: (friend) =>
                latestHandlers.current.sendFriendInvite(friend)
        }),
        []
    );

    return useMemo(
        () => ({
            ...stableHandlers,
            canUseFriendLocation,
            openFriendUser,
            openFriendWorld,
            openSectionGroup,
            openSectionWorld,
            openWorldGroup,
            toggleCollapsibleGroup
        }),
        [canUseFriendLocation, stableHandlers, toggleCollapsibleGroup]
    );
}
