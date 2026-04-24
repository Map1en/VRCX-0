export function useVrcNotificationPageActions({
    canInviteFromCurrentLocation,
    convertFileUrlToImageUrl,
    currentInviteLocation,
    currentUserId,
    endpoint,
    confirm,
    normalizeWorldTarget,
    notificationRepository,
    openAvatarDialog,
    openExternalLink,
    openGroupDialog,
    openImagePreview,
    openUserDialog,
    openWorldDialog,
    parseLocation,
    setBoopReplyRequest,
    setInviteResponseRequest,
    setReloadToken,
    t,
    toast,
    vrchatSearchRepository,
    withUploadTimeout
}) {
    function openNotificationLink(link) {
        const value = String(link || '').trim();
        if (!value) return;
        if (value.startsWith('user:')) {
            const userId = value.slice('user:'.length);
            openUserDialog({
                userId
            });
            return;
        }
        if (value.startsWith('group:')) {
            const groupId = value.slice('group:'.length);
            openGroupDialog({
                groupId
            });
            return;
        }
        if (value.startsWith('event:')) {
            const [groupId] = value.slice('event:'.length).split(',');
            if (groupId) {
                openGroupDialog({
                    groupId
                });
                return;
            }
        }
        if (value.startsWith('world:')) {
            const worldId = normalizeWorldTarget(value.slice('world:'.length));
            openWorldDialog({
                worldId
            });
            return;
        }
        if (value.startsWith('avatar:')) {
            const avatarId = value.slice('avatar:'.length);
            openAvatarDialog({
                avatarId
            });
            return;
        }
        void openExternalLink(value);
    }
    function openNotificationTypeTarget(notification) {
        if (
            (notification.type === 'group.queueReady' ||
                notification.type === 'instance.closed') &&
            notification.location
        ) {
            openWorldDialog({
                worldId: notification.location,
                title:
                    notification.worldName ||
                    notification.details?.worldName ||
                    undefined
            });
            return;
        }
        if (notification.link) {
            openNotificationLink(notification.link);
        }
    }
    function notificationTypeIsClickable(notification) {
        return Boolean(
            notification.link ||
            ((notification.type === 'group.queueReady' ||
                notification.type === 'instance.closed') &&
                notification.location)
        );
    }
    function openNotificationImagePreview(notification) {
        const imageUrl =
            notification.details?.imageUrl || notification.imageUrl || '';
        if (!imageUrl || imageUrl.startsWith('default_')) {
            return;
        }
        openImagePreview({
            url: convertFileUrlToImageUrl(imageUrl, 1024),
            title:
                notification.title ||
                notification.message ||
                notification.type ||
                'Notification image'
        });
    }
    async function markSeen(notification) {
        try {
            await notificationRepository.markSeen({
                userId: currentUserId,
                id: notification.id,
                version: notification.version,
                endpoint
            });
            setReloadToken((value) => value + 1);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_mark_notification_as_seen'
                      )
            );
        }
    }
    async function deleteNotification(
        notification,
        { skipConfirm = false } = {}
    ) {
        try {
            if (!skipConfirm) {
                const result = await confirm({
                    title: t(
                        'view.notifications.generated_modal.delete_notification_log_entry'
                    ),
                    description: t(
                        'view.notifications.generated_modal.delete_the_local_value_log_entry',
                        {
                            value: notification.type || 'notification'
                        }
                    ),
                    confirmText: t('common.actions.delete'),
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            await notificationRepository.deleteNotification({
                userId: currentUserId,
                id: notification.id,
                version: notification.version
            });
            setReloadToken((value) => value + 1);
            toast.success(
                t('view.notification.generated.notification_log_entry_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_delete_notification'
                      )
            );
        }
    }
    async function expireNotificationLocally(notification) {
        await notificationRepository.expireNotification({
            userId: currentUserId,
            id: notification.id
        });
        setReloadToken((value) => value + 1);
    }
    async function acceptFriendRequest(notification) {
        try {
            const result = await confirm({
                title: t(
                    'view.notifications.generated_modal.accept_friend_request'
                ),
                description: t(
                    'view.notifications.generated_dynamic.accept_the_friend_request_from_value',
                    {
                        value: notification.senderUsername || 'this user'
                    }
                )
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.acceptFriendRequest({
                id: notification.id,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(
                t('view.notification.generated.friend_request_accepted')
            );
        } catch (error) {
            if (error?.status === 404) {
                await expireNotificationLocally(notification);
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_accept_friend_request'
                      )
            );
        }
    }
    async function hideNotification(
        notification,
        { skipConfirm = false } = {}
    ) {
        try {
            if (!skipConfirm) {
                const result = await confirm({
                    title: t(
                        'view.notifications.generated_modal.decline_notification'
                    ),
                    description: t(
                        'view.notifications.generated_dynamic.decline_the_value_notification',
                        {
                            value: notification.type || 'notification'
                        }
                    ),
                    confirmText: t(
                        'view.notifications.generated_modal.decline'
                    ),
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            await notificationRepository.hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(
                t('view.notification.generated.notification_declined')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_decline_notification'
                      )
            );
        }
    }
    async function acceptRequestInvite(notification) {
        try {
            if (!currentInviteLocation) {
                toast.error(
                    t(
                        'view.notification.generated.cannot_invite_no_current_vrchat_location_is_available'
                    )
                );
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.error(
                    t(
                        'view.notification.generated.cannot_invite_from_the_current_instance_type'
                    )
                );
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.error(
                    t(
                        'view.notification.generated.cannot_invite_current_location_is_not_a_concrete_instance'
                    )
                );
                return;
            }
            const result = await confirm({
                title: t('view.notifications.generated_modal.send_invite'),
                description: t(
                    'view.notifications.generated_dynamic.send_an_invite_to_value',
                    {
                        value: notification.senderUsername || 'this user'
                    }
                )
            });
            if (!result.ok) {
                return;
            }
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                {
                    endpoint
                }
            );
            await notificationRepository.sendInvite({
                receiverUserId: notification.senderUserId,
                endpoint,
                params: {
                    instanceId: currentInviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName:
                        worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            await notificationRepository.hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(t('view.notification.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_send_invite'
                      )
            );
        }
    }
    function sendInviteResponseWithMessage(notification, messageType) {
        if (!currentUserId) {
            toast.error(
                t(
                    'view.notification.generated.cannot_send_invite_response_no_current_user_session_is_avail'
                )
            );
            return;
        }
        setInviteResponseRequest({
            notification,
            messageType
        });
    }
    async function sendInviteResponseSlot({ notification, row, imageData }) {
        if (!currentUserId) {
            throw new Error(
                'Cannot send invite response: no current user session is available.'
            );
        }
        const responseSlot = Number.parseInt(row?.slot, 10);
        if (!Number.isFinite(responseSlot)) {
            throw new Error('Response slot must be a number.');
        }
        if (imageData) {
            await withUploadTimeout(
                notificationRepository.sendInviteResponsePhoto({
                    id: notification.id,
                    responseSlot,
                    imageData,
                    endpoint
                })
            );
        } else {
            await notificationRepository.sendInviteResponse({
                id: notification.id,
                responseSlot,
                endpoint
            });
        }
        await notificationRepository.hideRemoteNotification({
            id: notification.id,
            version: notification.version,
            type: notification.type,
            senderUserId: notification.senderUserId,
            endpoint
        });
        await expireNotificationLocally(notification);
        toast.success(
            imageData
                ? t(
                      'view.notifications.generated_toast.invite_response_photo_sent'
                  )
                : t('view.notifications.generated_toast.invite_response_sent')
        );
    }
    async function dismissBoopNotifications(senderUserId) {
        if (!currentUserId || !senderUserId) {
            return;
        }
        const matchingRows = await notificationRepository
            .queryNotifications({
                userId: currentUserId,
                filters: ['boop']
            })
            .then((items) =>
                (Array.isArray(items) ? items : []).filter(
                    (item) =>
                        item?.type === 'boop' &&
                        !item.expired &&
                        item.link === `user:${senderUserId}`
                )
            );
        await Promise.allSettled(
            matchingRows.map(async (item) => {
                try {
                    await notificationRepository.hideRemoteNotification({
                        id: item.id,
                        version: item.version,
                        type: item.type,
                        senderUserId: item.senderUserId,
                        endpoint
                    });
                } finally {
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: item.id
                    });
                }
            })
        );
    }
    async function sendBoopReply(notification, emojiId = '') {
        if (!notification?.senderUserId) {
            throw new Error(
                'Cannot send boop: no sender user id is available.'
            );
        }
        await dismissBoopNotifications(notification.senderUserId);
        await notificationRepository.sendBoop({
            userId: notification.senderUserId,
            emojiId,
            endpoint
        });
        await notificationRepository
            .hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            })
            .catch(() => {});
        await expireNotificationLocally(notification);
        toast.success(t('view.notification.generated.boop_sent'));
    }
    async function sendNotificationResponse(notification, response) {
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
            await notificationRepository.sendNotificationResponse({
                id: notification.id,
                responseType: response?.type,
                responseData: response?.data || '',
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(
                t('view.notification.generated.notification_response_sent')
            );
        } catch (error) {
            if (notification.version >= 2) {
                await expireNotificationLocally(notification);
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_send_notification_response'
                      )
            );
        }
    }
    return {
        openNotificationLink,
        openNotificationTypeTarget,
        notificationTypeIsClickable,
        openNotificationImagePreview,
        markSeen,
        deleteNotification,
        acceptFriendRequest,
        hideNotification,
        acceptRequestInvite,
        sendInviteResponseWithMessage,
        sendInviteResponseSlot,
        sendBoopReply,
        sendNotificationResponse
    };
}
