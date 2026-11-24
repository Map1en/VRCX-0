import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { normalizeFeedId as normalizeId } from '@/components/feed/feedRows';
import type {
    FeedFriendActionTarget,
    FeedFriendActions,
    FeedLocationActionPayload
} from '@/components/feed/feedTypes';
import { useCurrentInviteContext } from '@/lib/useCurrentInviteContext';
import { openWorldDialog } from '@/services/dialogService';
import {
    boopFriend,
    requestInviteFromFriend
} from '@/services/friendActionService';
import { sendInviteToLocation } from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import {
    addFeedHiddenUserPreference,
    removeFeedHiddenUserPreference
} from '@/services/preferencesService';
import { toast } from '@/services/toastService';
import { checkCanInviteSelf } from '@/shared/utils/invite';
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
    const canBoopFromFeed = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.isBoopingEnabled === true
    );
    const friendIds = useFriendRosterStore(
        useShallow((state) => Object.keys(state.friendsById))
    );
    const feedHiddenUsers = usePreferencesStore(
        (state) => state.feedHiddenUsers
    );
    const confirm = useModalStore((state) => state.confirm);
    const normalizedCurrentUserId = normalizeId(currentUserId);
    const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);
    const hiddenUserIdSet = useMemo(
        () => new Set(feedHiddenUsers),
        [feedHiddenUsers]
    );
    const {
        currentInviteLocation,
        canInviteFromCurrentLocation,
        canSendInvite: canSendInviteFromFeed
    } = useCurrentInviteContext();

    const isFeedUserHidden = useCallback(
        (userId: string) => hiddenUserIdSet.has(normalizeId(userId)),
        [hiddenUserIdSet]
    );

    const addFeedHiddenUser = useCallback(
        async (userId: string) => {
            try {
                await addFeedHiddenUserPreference(userId);
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.settings.toast.failed_to_save_setting')
                });
            }
        },
        [t]
    );

    const removeFeedHiddenUser = useCallback(
        async (userId: string) => {
            try {
                await removeFeedHiddenUserPreference(userId);
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.settings.toast.failed_to_save_setting')
                });
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
                friends: friendIdSet
            });
        },
        [friendIdSet, normalizedCurrentUserId]
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
                            : t('view.feed.toast.failed_to_send_self_invite')
                });
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
                toast.add({
                    type: 'error',
                    title: t(
                        'view.feed.error.cannot_invite_no_current_vrchat_location_is_available'
                    )
                });
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.add({
                    type: 'error',
                    title: t(
                        'view.feed.error.cannot_invite_from_the_current_instance_type'
                    )
                });
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.add({
                    type: 'error',
                    title: t(
                        'view.feed.error.cannot_invite_current_location_is_not_a_concrete_instance'
                    )
                });
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
                toast.add({ type: 'success', title: t('message.invite.sent') });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.feed.toast.failed_to_send_invite')
                });
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
        (friend: FeedFriendActionTarget) =>
            requestInviteFromFriend({
                id: resolveActionFriendId(friend),
                label:
                    typeof friend?.displayName === 'string'
                        ? friend.displayName
                        : ''
            }),
        []
    );

    const sendFeedFriendBoop = useCallback(
        (friend: FeedFriendActionTarget) =>
            boopFriend({
                id: resolveActionFriendId(friend),
                label: normalizeId(friend?.displayName || friend?.username)
            }),
        []
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
