import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoopEmojiChoice } from '@/domain/entities/boopEmoji';
import type { InviteMessageType } from '@/platform/tauri/bindings';
import notificationPersistenceRepository, {
    type NotificationResponse
} from '@/repositories/notificationPersistenceRepository';
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
import { signalFriendLogChanged } from '@/services/friendLogMutationService';
import {
    acceptFriendRequestNotification,
    acceptRequestInviteNotification,
    expireNotificationLocally,
    hideRemoteAndExpireNotification,
    sendBoopReplyNotification,
    sendInviteResponseNotification,
    sendNotificationButtonResponse
} from '@/services/notificationActionService';
import { toast } from '@/services/toastService';
import { withUploadTimeout } from '@/shared/utils/imageUpload';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import type {
    NotificationDialogRequest,
    NotificationRow
} from './notificationPageTypes';
import { shouldOpenBoopReplyDialog } from './notificationResponseModel';
import { normalizeWorldTarget } from './notificationRows';

type DialogParams = Record<string, unknown>;
type ConfirmationOptions = {
    skipConfirm?: boolean;
};
type InviteResponseSlotPayload = {
    imageData: string;
    notification: NotificationRow;
    row: { slot: number };
};

export function useNotificationActions({
    canInviteFromCurrentLocation,
    currentInviteLocation,
    currentUserId,
    notificationTypeLabel,
    reload,
    setBoopReplyRequest,
    setInviteResponseRequest
}: {
    canInviteFromCurrentLocation: boolean;
    currentInviteLocation?: string;
    currentUserId?: string;
    notificationTypeLabel: (type: string | undefined) => string;
    reload: () => void;
    setBoopReplyRequest: (request: NotificationRow | null) => void;
    setInviteResponseRequest: (request: NotificationDialogRequest) => void;
}) {
    const { t } = useTranslation();
    const markAllNotificationsSeen = useVrcNotificationStore(
        (state) => state.markAllSeen
    );
    const markNotificationSeen = useVrcNotificationStore(
        (state) => state.markNotificationSeen
    );
    const confirm = useModalStore((state) => state.confirm);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const openUser = useCallback((params: DialogParams) => {
        openUserDialog(params);
    }, []);
    const openGroup = useCallback((params: DialogParams) => {
        openGroupDialog(params);
    }, []);

    const openNotificationLink = useCallback((link: unknown) => {
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
        (notification: NotificationRow) => {
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
        (notification: NotificationRow) =>
            Boolean(
                notification.link ||
                ((notification.type === 'group.queueReady' ||
                    notification.type === 'instance.closed') &&
                    notification.location)
            ),
        []
    );

    const openNotificationImagePreview = useCallback(
        (notification: NotificationRow) => {
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
        async (notification: NotificationRow) => {
            try {
                await markNotificationSeen(notification);
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_mark_notification_as_seen'
                              )
                });
            }
        },
        [markNotificationSeen, t]
    );

    const markAllSeen = useCallback(async () => {
        try {
            await markAllNotificationsSeen();
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'host.vrc_notification_center.toast.failed_to_mark_notifications_as_seen'
                          )
            });
        }
    }, [markAllNotificationsSeen, t]);

    const deleteNotification = useCallback(
        async (
            notification: NotificationRow,
            { skipConfirm = false }: ConfirmationOptions = {}
        ) => {
            try {
                if (!skipConfirm) {
                    const result = await confirm({
                        confirmText: t('common.actions.delete'),
                        description: t(
                            'view.notifications.modal.delete_the_local_value_log_entry',
                            {
                                value: notificationTypeLabel(notification.type)
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
                    id:
                        typeof notification.id === 'string'
                            ? notification.id
                            : '',
                    userId: currentUserId
                });
                await reload();
                toast.add({
                    type: 'success',
                    title: t(
                        'view.notification.success.notification_log_entry_deleted'
                    )
                });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_delete_notification'
                              )
                });
            }
        },
        [confirm, currentUserId, notificationTypeLabel, reload, t]
    );

    const acceptFriendRequest = useCallback(
        async (notification: NotificationRow) => {
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
                    notification
                });
                await reload();
                if (acceptResult.status === 'not-found') {
                    return;
                }
                signalFriendLogChanged();
                if (acceptResult.outcome.status === 'remoteOkLocalFailed') {
                    toast.add({
                        type: 'warning',
                        title: t(
                            'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
                        )
                    });
                } else {
                    toast.add({
                        type: 'success',
                        title: t(
                            'view.notification.success.friend_request_accepted'
                        )
                    });
                }
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_accept_friend_request'
                              )
                });
            }
        },
        [confirm, reload, t]
    );

    const hideNotification = useCallback(
        async (
            notification: NotificationRow,
            { skipConfirm = false }: ConfirmationOptions = {}
        ) => {
            try {
                if (!skipConfirm) {
                    const result = await confirm({
                        confirmText: t('view.notifications.modal.decline'),
                        description: t(
                            'view.notifications.dynamic.decline_the_value_notification',
                            {
                                value: notificationTypeLabel(notification.type)
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
                    notification
                });
                await reload();
                toast.add({
                    type: 'success',
                    title: t('view.notification.success.notification_declined')
                });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_decline_notification'
                              )
                });
            }
        },
        [confirm, currentUserId, notificationTypeLabel, reload, t]
    );

    const ignoreNotificationLocally = useCallback(
        async (notification: NotificationRow) => {
            try {
                await expireNotificationLocally({
                    currentUserId,
                    notification
                });
                await reload();
                toast.add({
                    type: 'success',
                    title: t(
                        'view.notification.success.notification_ignored_locally'
                    )
                });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_ignore_notification'
                              )
                });
            }
        },
        [currentUserId, reload, t]
    );

    const acceptRequestInvite = useCallback(
        async (notification: NotificationRow) => {
            try {
                if (!currentInviteLocation) {
                    toast.add({
                        type: 'error',
                        title: t(
                            'view.notification.error.cannot_invite_no_current_vrchat_location_is_available'
                        )
                    });
                    return;
                }
                if (!canInviteFromCurrentLocation) {
                    toast.add({
                        type: 'error',
                        title: t(
                            'view.notification.error.cannot_invite_from_the_current_instance_type'
                        )
                    });
                    return;
                }
                const parsedLocation = parseLocation(currentInviteLocation);
                if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                    toast.add({
                        type: 'error',
                        title: t(
                            'view.notification.error.cannot_invite_current_location_is_not_a_concrete_instance'
                        )
                    });
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
                    instanceId: currentInviteLocation,
                    notification,
                    worldId: parsedLocation.worldId
                });
                await reload();
                toast.add({ type: 'success', title: t('message.invite.sent') });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_send_invite'
                              )
                });
            }
        },
        [
            canInviteFromCurrentLocation,
            confirm,
            currentInviteLocation,
            currentUserId,
            reload,
            t
        ]
    );

    const sendInviteResponseWithMessage = useCallback(
        (notification: NotificationRow, messageType: InviteMessageType) => {
            if (!currentUserId) {
                toast.add({
                    type: 'error',
                    title: t(
                        'view.notification.error.cannot_send_invite_response_no_current_user_session_is_available'
                    )
                });
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
        async ({ imageData, notification, row }: InviteResponseSlotPayload) => {
            if (!currentUserId) {
                throw new Error(
                    'Cannot send invite response: no current user session is available.'
                );
            }
            const result = await sendInviteResponseNotification({
                currentUserId,
                imageData,
                notification,
                responseSlot: row.slot,
                withUploadTimeout
            });
            await Promise.resolve(reload()).catch(() => undefined);
            toast.add({
                type: 'success',
                title: result.sentPhoto
                    ? t('view.notifications.toast.invite_response_photo_sent')
                    : t('view.notifications.toast.invite_response_sent')
            });
        },
        [currentUserId, reload, t]
    );

    const sendBoopReply = useCallback(
        async (
            notification: NotificationRow | null,
            emoji: BoopEmojiChoice | null
        ) => {
            if (!notification) {
                return;
            }
            await sendBoopReplyNotification({
                currentUserId,
                emoji,
                notification
            });
            await reload();
            toast.add({
                type: 'success',
                title: t('view.notification.success.boop_sent')
            });
        },
        [currentUserId, reload, t]
    );

    const sendNotificationResponse = useCallback(
        async (
            notification: NotificationRow,
            response: NotificationResponse
        ) => {
            try {
                if (response?.type === 'link') {
                    openNotificationLink(response.data);
                    return;
                }
                if (shouldOpenBoopReplyDialog(notification, response)) {
                    setBoopReplyRequest(notification);
                    return;
                }
                await sendNotificationButtonResponse({
                    currentUserId,
                    notification,
                    response
                });
                await reload();
                toast.add({
                    type: 'success',
                    title: t(
                        'view.notification.success.notification_response_sent'
                    )
                });
            } catch (error) {
                await reload();
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.notifications.toast.failed_to_send_notification_response'
                              )
                });
            }
        },
        [currentUserId, openNotificationLink, reload, setBoopReplyRequest, t]
    );

    return {
        acceptFriendRequest,
        acceptRequestInvite,
        deleteNotification,
        hideNotification,
        ignoreNotificationLocally,
        markAllSeen,
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
