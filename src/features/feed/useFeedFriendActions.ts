import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    canRequestInviteFromFeedFriend,
    normalizeFeedId as normalizeId,
    resolveFeedCurrentInviteLocation as resolveCurrentInviteLocation
} from '@/components/feed/feedRows';
import type {
    FeedFriendActionTarget,
    FeedFriendActions,
    FeedLocationActionPayload
} from '@/components/feed/feedTypes';
import { openWorldDialog } from '@/services/dialogService';
import {
    sendBoopToUser,
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import {
    addFeedHiddenUserPreference,
    removeFeedHiddenUserPreference
} from '@/services/preferencesService';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

function resolveActionFriendId(friend: FeedFriendActionTarget) {
    return normalizeId(friend?.id || friend?.userId);
}

export function useFeedFriendActions(): FeedFriendActions {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const feedHiddenUsers = usePreferencesStore(
        (state) => state.feedHiddenUsers
    );
    const confirm = useModalStore((state) => state.confirm);
    const boopPrompt = useModalStore((state) => state.boopPrompt);
    const normalizedCurrentUserId = normalizeId(currentUserId);
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const hiddenUserIdSet = useMemo(
        () => new Set(feedHiddenUsers),
        [feedHiddenUsers]
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
                currentUserId: normalizedCurrentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, normalizedCurrentUserId]
    );
    const canSendInviteFromFeed = Boolean(
        isGameRunning && currentInviteLocation && canInviteFromCurrentLocation
    );
    const canBoopFromFeed = Boolean(currentUserSnapshot?.isBoopingEnabled);

    const isFeedUserHidden = useCallback(
        (userId: string) => hiddenUserIdSet.has(normalizeId(userId)),
        [hiddenUserIdSet]
    );

    const addFeedHiddenUser = useCallback(
        async (userId: string) => {
            try {
                await addFeedHiddenUserPreference(userId);
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.settings.toast.failed_to_save_setting')
                );
            }
        },
        [t]
    );

    const removeFeedHiddenUser = useCallback(
        async (userId: string) => {
            try {
                await removeFeedHiddenUserPreference(userId);
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.settings.toast.failed_to_save_setting')
                );
            }
        },
        [t]
    );

    const canUseFeedFriendLocation = useCallback(
        (location: string) => {
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
                currentUserId: normalizedCurrentUserId,
                cachedInstances: new Map(),
                friends: friendsMap
            });
        },
        [friendsMap, normalizedCurrentUserId]
    );

    const selfInviteFeedFriendLocation = useCallback(
        async (location: string) => {
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
                    parsedLocation.shortName || ''
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
        [t]
    );

    const sendFeedFriendInvite = useCallback(
        async (friend: FeedFriendActionTarget) => {
            const friendId = resolveActionFriendId(friend);
            if (!friendId || friendId === normalizedCurrentUserId) {
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
            currentInviteLocation,
            normalizedCurrentUserId,
            t
        ]
    );

    const requestFeedFriendInvite = useCallback(
        async (friend: FeedFriendActionTarget) => {
            const friendId = resolveActionFriendId(friend);
            if (!friendId || friendId === normalizedCurrentUserId) {
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
                    receiverUserId: friendId
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
        [confirm, currentUserSnapshot, normalizedCurrentUserId, t]
    );

    const sendFeedFriendBoop = useCallback(
        async (friend: FeedFriendActionTarget) => {
            const friendId = resolveActionFriendId(friend);
            if (!friendId || friendId === normalizedCurrentUserId) {
                return;
            }
            try {
                const result = await boopPrompt({
                    targetLabel:
                        normalizeId(friend?.displayName || friend?.username) ||
                        friendId
                });
                if (!result.ok) {
                    return;
                }
                await sendBoopToUser({
                    userId: friendId,
                    emojiId: normalizeId(result.value)
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
        [boopPrompt, normalizedCurrentUserId, t]
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
                    groupName: normalizeId(groupName),
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
            addFeedHiddenUser,
            isFeedUserHidden,
            openFeedNewInstance,
            removeFeedHiddenUser,
            requestFeedFriendInvite,
            selfInviteFeedFriendLocation,
            sendFeedFriendBoop,
            sendFeedFriendInvite
        }),
        [
            canBoopFromFeed,
            canSendInviteFromFeed,
            canUseFeedFriendLocation,
            addFeedHiddenUser,
            isFeedUserHidden,
            openFeedNewInstance,
            removeFeedHiddenUser,
            requestFeedFriendInvite,
            selfInviteFeedFriendLocation,
            sendFeedFriendBoop,
            sendFeedFriendInvite
        ]
    );
}
