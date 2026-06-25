import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { openWorldDialog } from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import {
    sendBoopToUser,
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    canRequestInviteFromFeedFriend,
    normalizeFeedId as normalizeId,
    resolveFeedCurrentInviteLocation as resolveCurrentInviteLocation
} from './feedRows';
import type {
    FeedFriendActionTarget,
    FeedFriendActions,
    FeedLocationActionPayload
} from './feedTypes';

function resolveActionFriendId(friend: FeedFriendActionTarget) {
    return normalizeId(friend?.id || friend?.userId);
}

export function useFeedFriendActions(): FeedFriendActions {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const confirm = useModalStore((state: any) => state.confirm);
    const boopPrompt = useModalStore((state: any) => state.boopPrompt);
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const currentInviteLocation = useMemo(
        () =>
            resolveCurrentInviteLocation(
                {
                    currentLocation: runtimeCurrentLocation,
                    currentDestination: runtimeCurrentDestination,
                    isGameRunning
                },
                currentUserSnapshot
            ),
        [
            currentUserSnapshot,
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation
        ]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );
    const canSendInviteFromFeed = Boolean(
        isGameRunning && currentInviteLocation && canInviteFromCurrentLocation
    );
    const canBoopFromFeed = Boolean(currentUserSnapshot?.isBoopingEnabled);

    const canUseFeedFriendLocation = useCallback(
        (location: unknown) => {
            const normalizedLocation = normalizeId(location);
            const parsedLocation = parseLocation(normalizedLocation);
            if (
                !parsedLocation.isRealInstance ||
                !parsedLocation.worldId ||
                !parsedLocation.instanceId
            ) {
                return false;
            }
            return checkCanInviteSelf(normalizedLocation, {
                currentUserId,
                cachedInstances: new Map(),
                friends: friendsMap
            });
        },
        [currentUserId, friendsMap]
    );

    const launchFeedFriendLocation = useCallback(
        async (location: unknown) => {
            const normalizedLocation = normalizeId(location);
            const parsedLocation = parseLocation(normalizedLocation);
            if (
                !parsedLocation.isRealInstance ||
                !parsedLocation.worldId ||
                !parsedLocation.instanceId
            ) {
                return;
            }
            try {
                const opened = await tryOpenLaunchLocation(
                    normalizedLocation,
                    parsedLocation.shortName || '',
                    currentEndpoint
                );
                if (opened) {
                    toast.success(
                        t('view.feed.success.vrchat_launch_request_sent')
                    );
                    return;
                }
                toast.error(
                    t('view.feed.error.unable_to_open_this_instance_in_vrchat')
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.toast.failed_to_launch_instance')
                );
            }
        },
        [currentEndpoint, t]
    );

    const selfInviteFeedFriendLocation = useCallback(
        async (location: unknown) => {
            const normalizedLocation = normalizeId(location);
            const parsedLocation = parseLocation(normalizedLocation);
            if (
                !parsedLocation.isRealInstance ||
                !parsedLocation.worldId ||
                !parsedLocation.instanceId
            ) {
                return;
            }
            try {
                await selfInviteToInstance(
                    normalizedLocation,
                    parsedLocation.shortName || '',
                    currentEndpoint
                );
                toast.success(t('message.invite.self_sent'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.toast.failed_to_send_self_invite')
                );
            }
        },
        [currentEndpoint, t]
    );

    const sendFeedFriendInvite = useCallback(
        async (friend: FeedFriendActionTarget) => {
            const friendId = resolveActionFriendId(friend);
            if (!friendId || friendId === normalizeId(currentUserId)) {
                return;
            }
            if (!currentInviteLocation) {
                toast.error(
                    t(
                        'view.feed.error.cannot_invite_no_current_vrchat_location_is_available'
                    )
                );
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.error(
                    t(
                        'view.feed.error.cannot_invite_from_the_current_instance_type'
                    )
                );
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.error(
                    t(
                        'view.feed.error.cannot_invite_current_location_is_not_a_concrete_instance'
                    )
                );
                return;
            }
            const result = await confirm({
                title: t('view.feed.modal.send_invite'),
                description:
                    typeof friend?.displayName === 'string'
                        ? friend.displayName
                        : 'this user',
                confirmText: t('view.feed.modal.invite'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
            try {
                const inviteLocation =
                    parsedLocation.tag || currentInviteLocation;
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
                        : t('view.feed.toast.failed_to_send_invite')
                );
            }
        },
        [
            canInviteFromCurrentLocation,
            confirm,
            currentEndpoint,
            currentInviteLocation,
            currentUserId,
            t
        ]
    );

    const requestFeedFriendInvite = useCallback(
        async (friend: FeedFriendActionTarget) => {
            const friendId = resolveActionFriendId(friend);
            if (!friendId || friendId === normalizeId(currentUserId)) {
                return;
            }
            if (!canRequestInviteFromFeedFriend(friend, currentUserSnapshot)) {
                toast.error(
                    t(
                        'view.feed.error.cannot_request_invite_friend_is_not_online'
                    )
                );
                return;
            }
            const result = await confirm({
                title: t('view.feed.modal.request_invite'),
                description:
                    typeof friend?.displayName === 'string'
                        ? friend.displayName
                        : 'this user',
                confirmText: t('view.feed.modal.request_invite_2'),
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
                toast.success(t('view.feed.success.invite_request_sent'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.toast.failed_to_request_invite')
                );
            }
        },
        [confirm, currentEndpoint, currentUserId, currentUserSnapshot, t]
    );

    const sendFeedFriendBoop = useCallback(
        async (friend: FeedFriendActionTarget) => {
            const friendId = resolveActionFriendId(friend);
            if (!friendId || friendId === normalizeId(currentUserId)) {
                return;
            }
            try {
                const result = await boopPrompt({
                    endpoint: currentEndpoint,
                    targetLabel:
                        friend?.displayName || friend?.username || friendId
                });
                if (!result.ok) {
                    return;
                }
                await sendBoopToUser({
                    userId: friendId,
                    emojiId: result.value,
                    endpoint: currentEndpoint
                });
                toast.success(t('view.feed.success.boop_sent'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.toast.failed_to_send_boop')
                );
            }
        },
        [boopPrompt, currentEndpoint, currentUserId, t]
    );

    const openFeedNewInstance = useCallback(
        ({
            location = '',
            worldId = '',
            worldName = '',
            groupName = '',
            selfInvite = false
        }: FeedLocationActionPayload = {}) => {
            const parsedLocation = parseLocation(location);
            const target =
                normalizeId(worldId) ||
                parsedLocation.worldId ||
                normalizeId(location);
            if (!target) {
                return;
            }
            openWorldDialog({
                worldId: target,
                title: normalizeId(worldName) || target,
                initialAction: selfInvite
                    ? 'newInstanceSelfInvite'
                    : 'newInstance',
                initialNewInstanceDefaults: {
                    groupId: parsedLocation.groupId || '',
                    groupAccessType: parsedLocation.groupAccessType || '',
                    groupName,
                    region: parsedLocation.region || ''
                }
            });
        },
        []
    );

    return useMemo(
        () => ({
            canBoopFromFeed,
            canSendInviteFromFeed,
            canUseFeedFriendLocation,
            launchFeedFriendLocation,
            openFeedNewInstance,
            requestFeedFriendInvite,
            selfInviteFeedFriendLocation,
            sendFeedFriendBoop,
            sendFeedFriendInvite
        }),
        [
            canBoopFromFeed,
            canSendInviteFromFeed,
            canUseFeedFriendLocation,
            launchFeedFriendLocation,
            openFeedNewInstance,
            requestFeedFriendInvite,
            selfInviteFeedFriendLocation,
            sendFeedFriendBoop,
            sendFeedFriendInvite
        ]
    );
}
