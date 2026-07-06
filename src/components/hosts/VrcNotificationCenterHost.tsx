import { BellIcon, CheckCheckIcon, RefreshCcwIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import { BoopReplyDialog } from '@/features/notifications/components/NotificationViewParts';
import { NotificationDrawerList } from '@/features/notifications/drawer/NotificationDrawerList';
import { shouldOpenBoopReplyDialog } from '@/features/notifications/notificationResponseModel';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import notificationPersistenceRepository, {
    type NotificationResponse,
    type NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import { openWorldDialog } from '@/services/dialogService';
import {
    acceptFriendRequestNotification,
    acceptRequestInviteNotification,
    hideRemoteAndExpireNotification,
    sendBoopReplyNotification,
    sendInviteResponseNotification,
    sendNotificationButtonResponse
} from '@/services/notificationActionService';
import { checkCanInvite } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    buildCachedInstanceMap,
    openNotificationLink,
    resolveCurrentInviteLocation
} from './vrc-notification-center/notificationCenterUtils';

type InviteResponseRequest = {
    notification: NotificationRow;
    messageType: string;
};

type InviteResponseSlotPayload = {
    notification: NotificationRow;
    row?: {
        slot?: unknown;
    };
};

export function VrcNotificationCenterHost() {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserLocationTag = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.$locationTag
    );
    const currentUserLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.location
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state) => {
        const tags = state.auth.currentUserSnapshot?.tags;
        return Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            (Array.isArray(tags) && tags.includes('system_supporter')) ||
            globalThis?.$debug?.debugVrcPlus
        );
    });
    const currentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const groupInstancesEndpoint = useRuntimeStore(
        (state) => state.groupInstances.endpoint
    );
    const groupInstancesUserId = useRuntimeStore(
        (state) => state.groupInstances.userId
    );
    const groupInstances = useRuntimeStore(
        (state) => state.groupInstances.instances
    );
    const isCenterOpen = useVrcNotificationStore((state) => state.isCenterOpen);
    const categories = useVrcNotificationStore((state) => state.categories);
    const unseenCount = useVrcNotificationStore((state) => state.unseenCount);
    const loadStatus = useVrcNotificationStore((state) => state.loadStatus);
    const detail = useVrcNotificationStore((state) => state.detail);
    const setCenterOpen = useVrcNotificationStore(
        (state) => state.setCenterOpen
    );
    const loadForCurrentUser = useVrcNotificationStore(
        (state) => state.loadForCurrentUser
    );
    const markNotificationSeen = useVrcNotificationStore(
        (state) => state.markNotificationSeen
    );
    const markAllSeen = useVrcNotificationStore((state) => state.markAllSeen);
    const [inviteResponseRequest, setInviteResponseRequest] =
        useState<InviteResponseRequest | null>(null);
    const [boopReplyRequest, setBoopReplyRequest] =
        useState<NotificationRow | null>(null);
    const groupInstanceRows =
        groupInstancesUserId === currentUserId &&
        groupInstancesEndpoint === endpoint
            ? groupInstances
            : [];
    const gameState = useMemo(
        () => ({
            currentLocation,
            currentDestination
        }),
        [currentDestination, currentLocation]
    );
    const currentUserSnapshot = useMemo(
        () => ({
            $locationTag: currentUserLocationTag,
            location: currentUserLocation
        }),
        [currentUserLocation, currentUserLocationTag]
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [currentUserSnapshot, gameState]
    );
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstanceRows),
        [groupInstanceRows]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId: currentUserId ?? '',
                lastLocationStr: currentInviteLocation,
                cachedInstances
            }),
        [cachedInstances, currentInviteLocation, currentUserId]
    );

    function markAllRead() {
        if (unseenCount <= 0) {
            return;
        }
        markAllSeen().catch((error: unknown) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.toast.failed_to_mark_notifications_as_seen'
                      )
            );
        });
    }

    function handleOpenChange(open: boolean) {
        if (!open) {
            setInviteResponseRequest(null);
            setBoopReplyRequest(null);
        }
        setCenterOpen(open);
    }

    function joinQueueReady(notification: NotificationRow) {
        const location = String(notification?.location || '').trim();
        if (!location) {
            return;
        }
        openWorldDialog({
            worldId: location,
            title:
                notification?.worldName ||
                notification?.details?.worldName ||
                ''
        });
    }

    function navigateToTable() {
        handleOpenChange(false);
        window.location.hash = '#/notification?fromCenter=1';
    }

    async function refreshCenter() {
        await loadForCurrentUser();
    }

    async function acceptFriendRequest(notification: NotificationRow) {
        try {
            const result = await confirm({
                title: t(
                    'host.vrc_notification_center.modal.accept_friend_request'
                ),
                description: t(
                    'host.vrc_notification_center.dynamic.accept_the_friend_request_from_value',
                    { value: notification.senderUsername || 'this user' }
                )
            });
            if (!result.ok) {
                return;
            }
            const acceptResult = await acceptFriendRequestNotification({
                currentUserId,
                endpoint,
                notification
            });
            await refreshCenter();
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
                          'host.vrc_notification_center.toast.failed_to_accept_friend_request'
                      )
            );
        }
    }

    async function hideNotification(notification: NotificationRow) {
        try {
            const result = await confirm({
                title: t(
                    'host.vrc_notification_center.modal.decline_notification'
                ),
                description: t(
                    'host.vrc_notification_center.dynamic.decline_the_value_notification',
                    { value: notification.type || 'notification' }
                ),
                confirmText: t('host.vrc_notification_center.modal.decline'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
            await hideRemoteAndExpireNotification({
                currentUserId,
                endpoint,
                notification
            });
            await refreshCenter();
            toast.success(t('view.notification.success.notification_declined'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.toast.failed_to_decline_notification'
                      )
            );
        }
    }

    async function acceptRequestInvite(notification: NotificationRow) {
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
                title: t('host.vrc_notification_center.modal.send_invite'),
                description: t(
                    'host.vrc_notification_center.dynamic.send_an_invite_to_value',
                    { value: notification.senderUsername || 'this user' }
                )
            });
            if (!result.ok) {
                return;
            }

            await acceptRequestInviteNotification({
                currentUserId,
                endpoint,
                instanceId: currentInviteLocation,
                worldId: parsedLocation.worldId,
                notification
            });
            await refreshCenter();
            toast.success(t('message.invite.sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.toast.failed_to_send_invite'
                      )
            );
        }
    }

    function sendInviteResponseWithMessage(
        notification: NotificationRow,
        messageType: string
    ) {
        if (!currentUserId) {
            toast.error(
                t(
                    'view.notification.error.cannot_send_invite_response_no_current_user_session_is_available'
                )
            );
            return;
        }
        setInviteResponseRequest({ notification, messageType });
    }

    async function sendInviteResponseSlot({
        notification,
        row
    }: InviteResponseSlotPayload) {
        await sendInviteResponseNotification({
            currentUserId,
            endpoint,
            notification,
            responseSlot: row?.slot
        });
        await refreshCenter();
        toast.success(t('view.notification.success.invite_response_sent'));
    }

    async function sendBoopReply(
        notification: NotificationRow | null,
        emojiId: unknown = ''
    ) {
        if (!notification) {
            return;
        }
        await sendBoopReplyNotification({
            currentUserId,
            emojiId,
            endpoint,
            notification
        });
        await refreshCenter();
        toast.success(t('view.notification.success.boop_sent'));
    }

    async function sendNotificationResponse(
        notification: NotificationRow,
        response: NotificationResponse
    ) {
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
                endpoint,
                notification,
                response
            });
            await refreshCenter();
            toast.success(
                t('view.notification.success.notification_response_sent')
            );
        } catch (error) {
            await refreshCenter();
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.toast.failed_to_send_notification_response'
                      )
            );
        }
    }

    async function deleteNotification(notification: NotificationRow) {
        try {
            const result = await confirm({
                title: t(
                    'host.vrc_notification_center.modal.delete_notification_log_entry'
                ),
                description: t(
                    'host.vrc_notification_center.modal.delete_the_local_value_log_entry',
                    { value: notification.type || 'notification' }
                ),
                confirmText: t('common.actions.delete'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
            await notificationPersistenceRepository.deleteNotification({
                userId: currentUserId,
                id: notification.id,
                version: notification.version
            });
            await refreshCenter();
            toast.success(
                t('view.notification.success.notification_log_entry_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.toast.failed_to_delete_notification'
                      )
            );
        }
    }

    return (
        <>
            <Sheet open={isCenterOpen} onOpenChange={handleOpenChange}>
                <SheetContent
                    side="right"
                    className="flex w-[min(100vw,40rem)]! flex-col gap-0 p-0 sm:max-w-none!"
                >
                    <SheetHeader className="border-b px-4 pt-4 pb-3">
                        <div className="flex items-center justify-between gap-3 pr-8">
                            <SheetTitle className="flex items-center gap-2">
                                <BellIcon className="size-4" />
                                {t('side_panel.notification_center.title')}
                            </SheetTitle>
                            <div className="flex items-center gap-2">
                                <Badge
                                    variant={
                                        unseenCount ? 'default' : 'outline'
                                    }
                                >
                                    {unseenCount}
                                </Badge>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={t(
                                                    'side_panel.notification_center.mark_all_read'
                                                )}
                                                disabled={unseenCount <= 0}
                                                onClick={markAllRead}
                                            >
                                                <CheckCheckIcon data-icon="inline-start" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        {t(
                                            'side_panel.notification_center.mark_all_read'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={t(
                                                    'view.notification.refresh_tooltip'
                                                )}
                                                disabled={
                                                    loadStatus === 'running'
                                                }
                                                onClick={() => {
                                                    loadForCurrentUser().catch(
                                                        (error: unknown) => {
                                                            toast.error(
                                                                userFacingErrorMessage(
                                                                    error,
                                                                    t(
                                                                        'host.vrc_notification_center.toast.failed_to_refresh_notifications'
                                                                    )
                                                                )
                                                            );
                                                        }
                                                    );
                                                }}
                                            >
                                                {loadStatus === 'running' ? (
                                                    <Spinner data-icon="inline-start" />
                                                ) : (
                                                    <RefreshCcwIcon data-icon="inline-start" />
                                                )}
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('view.notification.refresh_tooltip')}
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                        {detail ? (
                            <div className="text-muted-foreground text-xs">
                                {userFacingErrorMessage(
                                    detail,
                                    'Failed to load notifications.'
                                )}
                            </div>
                        ) : null}
                    </SheetHeader>
                    <NotificationDrawerList
                        categories={categories}
                        currentUserId={currentUserId ?? undefined}
                        canInviteFromCurrentLocation={
                            canInviteFromCurrentLocation
                        }
                        handlers={{
                            onAcceptFriendRequest: acceptFriendRequest,
                            onAcceptRequestInvite: acceptRequestInvite,
                            onSendInviteResponseWithMessage:
                                sendInviteResponseWithMessage,
                            onSendNotificationResponse:
                                sendNotificationResponse,
                            onHideNotification: hideNotification,
                            onDeleteNotification: deleteNotification,
                            onMarkSeen: markNotificationSeen,
                            onJoinQueueReady: joinQueueReady
                        }}
                        onNavigateToTable={navigateToTable}
                    />
                </SheetContent>
            </Sheet>
            <InviteMessageDialog
                open={Boolean(inviteResponseRequest)}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setInviteResponseRequest(null);
                    }
                }}
                currentUserId={currentUserId}
                endpoint={endpoint}
                messageType={inviteResponseRequest?.messageType || 'response'}
                mode="respond"
                targetLabel={String(
                    inviteResponseRequest?.notification?.senderUsername ||
                        inviteResponseRequest?.notification?.senderUserId ||
                        'this user'
                )}
                allowEdit
                allowImageUpload={false}
                onUse={(
                    payload: Omit<InviteResponseSlotPayload, 'notification'>
                ) => {
                    if (!inviteResponseRequest) {
                        return undefined;
                    }
                    return sendInviteResponseSlot({
                        ...payload,
                        notification: inviteResponseRequest.notification
                    });
                }}
            />
            <BoopReplyDialog
                request={boopReplyRequest}
                endpoint={endpoint}
                isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setBoopReplyRequest(null);
                    }
                }}
                onSend={sendBoopReply}
            />
        </>
    );
}
