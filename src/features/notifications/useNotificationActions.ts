import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import {
    acceptFriendRequestNotification,
    acceptRequestInviteNotification,
    hideRemoteAndExpireNotification,
    sendBoopReplyNotification,
    sendInviteResponseNotification,
    sendNotificationButtonResponse
} from '@/services/notificationActionService';
import { withUploadTimeout } from '@/shared/utils/imageUpload';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';

import type {
    NotificationDialogRequest,
    NotificationRow
} from './notificationPageTypes';
import { normalizeWorldTarget } from './notificationRows';

export function useNotificationActions({
    canInviteFromCurrentLocation,
    currentInviteLocation,
    currentUserId,
    endpoint,
    reload,
    setBoopReplyRequest,
    setInviteResponseRequest
}: {
    canInviteFromCurrentLocation: boolean;
    currentInviteLocation?: string;
    currentUserId?: string;
    endpoint?: string;
    reload: () => void;
    setBoopReplyRequest: (request: NotificationRow | null) => void;
    setInviteResponseRequest: (request: NotificationDialogRequest) => void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const openUser = useCallback((params: any) => {
        openUserDialog(params);
    }, []);
    const openGroup = useCallback((params: any) => {
        openGroupDialog(params);
    }, []);

    const openNotificationLink = useCallback((link: any) => {
        const value = String(link || '').trim();
        if (!value) return;
        if (value.startsWith('user:')) {
            const userId = value.slice('user:'.length);
            openUserDialog({ userId });
            return;
        }
        if (value.startsWith('group:')) {
            const groupId = value.slice('group:'.length);
            openGroupDialog({ groupId });
            return;
        }
        if (value.startsWith('event:')) {
            const [groupId] = value.slice('event:'.length).split(',');
            if (groupId) {
                openGroupDialog({ groupId });
                return;
            }
        }
        if (value.startsWith('world:')) {
            const worldId = normalizeWorldTarget(value.slice('world:'.length));
            openWorldDialog({ worldId });
            return;
        }
        if (value.startsWith('avatar:')) {
            const avatarId = value.slice('avatar:'.length);
            openAvatarDialog({ avatarId });
            return;
        }
        openExternalLink(value, { directAccess: true });
    }, []);

    const openNotificationTypeTarget = useCallback(
        (notification: any) => {
            if (
                (notification.type === 'group.queueReady' ||
                    notification.type === 'instance.closed') &&
                notification.location
            ) {
                openWorldDialog({
                    title:
                        notification.worldName ||
                        notification.details?.worldName ||
                        undefined,
                    worldId: notification.location
                });
                return;
            }
            if (notification.link) {
                openNotificationLink(notification.link);
            }
        },
        [openNotificationLink]
    );

    const notificationTypeIsClickable = useCallback(
        (notification: any) =>
            Boolean(
                notification.link ||
                ((notification.type === 'group.queueReady' ||
                    notification.type === 'instance.closed') &&
                    notification.location)
            ),
        []
    );

    const openNotificationImagePreview = useCallback(
        (notification: any) => {
            const imageUrl =
                notification.details?.imageUrl || notification.imageUrl || '';
            if (!imageUrl || imageUrl.startsWith('default_')) {
                return;
            }
            openImagePreview({
                title:
                    notification.title ||
                    notification.message ||
                    notification.type ||
                    'Notification image',
                url: convertFileUrlToImageUrl(imageUrl, 1024)
            });
        },
        [openImagePreview]
    );

    const markSeen = useCallback(
        async (notification: any) => {
            try {
                await notificationPersistenceRepository.markSeen({
                    endpoint,
                    id: notification.id,
                    userId: currentUserId,
                    version: notification.version
                });
                reload();
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.notifications.toast.failed_to_mark_notification_as_seen'
                          )
                );
            }
        },
        [currentUserId, endpoint, reload, t]
    );

    const deleteNotification = useCallback(
        async (notification: any, { skipConfirm = false }: any = {}) => {
            try {
                if (!skipConfirm) {
                    const result = await confirm({
                        confirmText: t('common.actions.delete'),
                        description: t(
                            'view.notifications.modal.delete_the_local_value_log_entry',
                            {
                                value: notification.type || 'notification'
                            }
                        ),
                        destructive: true,
                        title: t(
                            'view.notifications.modal.delete_notification_log_entry'
                        )
                    });
                    if (!result.ok) {
                        return;
                    }
                }
                await notificationPersistenceRepository.deleteNotification({
                    id: notification.id,
                    userId: currentUserId,
                    version: notification.version
                });
                reload();
                toast.success(
                    t(
                        'view.notification.success.notification_log_entry_deleted'
                    )
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.notifications.toast.failed_to_delete_notification'
                          )
                );
            }
        },
        [confirm, currentUserId, reload, t]
    );

    const acceptFriendRequest = useCallback(
        async (notification: any) => {
            try {
                const result = await confirm({
                    description: t(
                        'view.notifications.dynamic.accept_the_friend_request_from_value',
                        {
                            value: notification.senderUsername || 'this user'
                        }
                    ),
                    title: t('view.notifications.modal.accept_friend_request')
                });
                if (!result.ok) {
                    return;
                }
                const acceptResult = await acceptFriendRequestNotification({
                    currentUserId,
                    endpoint,
                    notification
                });
                reload();
                if (acceptResult.status === 'not-found') {
                    return;
                }
                toast.success(
                    t('view.notification.success.friend_request_accepted')
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.notifications.toast.failed_to_accept_friend_request'
                          )
                );
            }
        },
        [confirm, currentUserId, endpoint, reload, t]
    );

    const hideNotification = useCallback(
        async (notification: any, { skipConfirm = false }: any = {}) => {
            try {
                if (!skipConfirm) {
                    const result = await confirm({
                        confirmText: t('view.notifications.modal.decline'),
                        description: t(
                            'view.notifications.dynamic.decline_the_value_notification',
                            {
                                value: notification.type || 'notification'
                            }
                        ),
                        destructive: true,
                        title: t(
                            'view.notifications.modal.decline_notification'
                        )
                    });
                    if (!result.ok) {
                        return;
                    }
                }
                await hideRemoteAndExpireNotification({
                    currentUserId,
                    endpoint,
                    notification
                });
                reload();
                toast.success(
                    t('view.notification.success.notification_declined')
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.notifications.toast.failed_to_decline_notification'
                          )
                );
            }
        },
        [confirm, currentUserId, endpoint, reload, t]
    );

    const acceptRequestInvite = useCallback(
        async (notification: any) => {
            try {
                if (!currentInviteLocation) {
                    toast.error(
                        t(
                            'view.notification.error.cannot_invite_no_current_vrchat_location_is_available'
                        )
                    );
                    return;
                }
                if (!canInviteFromCurrentLocation) {
                    toast.error(
                        t(
                            'view.notification.error.cannot_invite_from_the_current_instance_type'
                        )
                    );
                    return;
                }
                const parsedLocation = parseLocation(currentInviteLocation);
                if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                    toast.error(
                        t(
                            'view.notification.error.cannot_invite_current_location_is_not_a_concrete_instance'
                        )
                    );
                    return;
                }
                const result = await confirm({
                    description: t(
                        'view.notifications.dynamic.send_an_invite_to_value',
                        {
                            value: notification.senderUsername || 'this user'
                        }
                    ),
                    title: t('view.notifications.modal.send_invite')
                });
                if (!result.ok) {
                    return;
                }
                await acceptRequestInviteNotification({
                    currentUserId,
                    endpoint,
                    instanceId: currentInviteLocation,
                    notification,
                    worldId: parsedLocation.worldId
                });
                reload();
                toast.success(t('message.invite.sent'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.notifications.toast.failed_to_send_invite')
                );
            }
        },
        [
            canInviteFromCurrentLocation,
            confirm,
            currentInviteLocation,
            currentUserId,
            endpoint,
            reload,
            t
        ]
    );

    const sendInviteResponseWithMessage = useCallback(
        (notification: any, messageType: any) => {
            if (!currentUserId) {
                toast.error(
                    t(
                        'view.notification.error.cannot_send_invite_response_no_current_user_session_is_available'
                    )
                );
                return;
            }
            setInviteResponseRequest({
                messageType,
                notification
            });
        },
        [currentUserId, setInviteResponseRequest, t]
    );

    const sendInviteResponseSlot = useCallback(
        async ({ imageData, notification, row }: any) => {
            if (!currentUserId) {
                throw new Error(
                    'Cannot send invite response: no current user session is available.'
                );
            }
            const result = await sendInviteResponseNotification({
                currentUserId,
                endpoint,
                imageData,
                notification,
                responseSlot: row?.slot,
                withUploadTimeout
            });
            reload();
            toast.success(
                result.sentPhoto
                    ? t('view.notifications.toast.invite_response_photo_sent')
                    : t('view.notifications.toast.invite_response_sent')
            );
        },
        [currentUserId, endpoint, reload, t]
    );

    const sendBoopReply = useCallback(
        async (notification: any, emojiId: any = '') => {
            await sendBoopReplyNotification({
                currentUserId,
                emojiId,
                endpoint,
                notification
            });
            reload();
            toast.success(t('view.notification.success.boop_sent'));
        },
        [currentUserId, endpoint, reload, t]
    );

    const sendNotificationResponse = useCallback(
        async (notification: any, response: any) => {
            try {
                const responseType = String(response?.type || '').toLowerCase();
                if (response?.type === 'link') {
                    openNotificationLink(response.data);
                    return;
                }
                if (
                    notification.type === 'boop' &&
                    (responseType === 'reply' ||
                        responseType === 'boop' ||
                        response?.icon === 'reply')
                ) {
                    setBoopReplyRequest(notification);
                    return;
                }
                await sendNotificationButtonResponse({
                    currentUserId,
                    endpoint,
                    notification,
                    response
                });
                reload();
                toast.success(
                    t('view.notification.success.notification_response_sent')
                );
            } catch (error) {
                reload();
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.notifications.toast.failed_to_send_notification_response'
                          )
                );
            }
        },
        [
            currentUserId,
            endpoint,
            openNotificationLink,
            reload,
            setBoopReplyRequest,
            t
        ]
    );

    return {
        acceptFriendRequest,
        acceptRequestInvite,
        deleteNotification,
        hideNotification,
        markSeen,
        notificationTypeIsClickable,
        openGroup,
        openNotificationImagePreview,
        openNotificationLink,
        openNotificationTypeTarget,
        openUser,
        sendBoopReply,
        sendInviteResponseSlot,
        sendInviteResponseWithMessage,
        sendNotificationResponse
    };
}
