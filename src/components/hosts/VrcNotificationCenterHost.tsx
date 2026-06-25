import { BellIcon, CheckCheckIcon, RefreshCcwIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import { BoopReplyDialog } from '@/features/notifications/components/NotificationViewParts';
import { NotificationDrawerList } from '@/features/notifications/drawer/NotificationDrawerList';
import { shouldOpenBoopReplyDialog } from '@/features/notifications/notificationResponseModel';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
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
import { parseLocation } from '@/shared/utils/locationParser';
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

export function VrcNotificationCenterHost() {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const endpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserLocationTag = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.$locationTag
    );
    const currentUserLocation = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.location
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state: any) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            state.auth.currentUserSnapshot?.tags?.includes?.(
                'system_supporter'
            ) ||
            globalThis?.$debug?.debugVrcPlus
        )
    );
    const currentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const currentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const groupInstancesEndpoint = useRuntimeStore(
        (state: any) => state.groupInstances.endpoint
    );
    const groupInstancesUserId = useRuntimeStore(
        (state: any) => state.groupInstances.userId
    );
    const groupInstances = useRuntimeStore(
        (state: any) => state.groupInstances.instances
    );
    const isCenterOpen = useVrcNotificationStore(
        (state: any) => state.isCenterOpen
    );
    const categories = useVrcNotificationStore(
        (state: any) => state.categories
    );
    const unseenCount = useVrcNotificationStore(
        (state: any) => state.unseenCount
    );
    const loadStatus = useVrcNotificationStore(
        (state: any) => state.loadStatus
    );
    const detail = useVrcNotificationStore((state: any) => state.detail);
    const setCenterOpen = useVrcNotificationStore(
        (state: any) => state.setCenterOpen
    );
    const loadForCurrentUser = useVrcNotificationStore(
        (state: any) => state.loadForCurrentUser
    );
    const markNotificationSeen = useVrcNotificationStore(
        (state: any) => state.markNotificationSeen
    );
    const markAllSeen = useVrcNotificationStore(
        (state: any) => state.markAllSeen
    );
    const [inviteResponseRequest, setInviteResponseRequest] = useState<{
        notification: any;
        messageType: any;
    } | null>(null);
    const [boopReplyRequest, setBoopReplyRequest] = useState<any>(null);
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
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances
            }),
        [cachedInstances, currentInviteLocation, currentUserId]
    );

    function markAllRead() {
        if (unseenCount <= 0) {
            return;
        }
        markAllSeen().catch((error: any) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.toast.failed_to_mark_notifications_as_seen'
                      )
            );
        });
    }

    function handleOpenChange(open: any) {
        if (!open) {
            setInviteResponseRequest(null);
            setBoopReplyRequest(null);
        }
        setCenterOpen(open);
    }

    function joinQueueReady(notification: any) {
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

    async function acceptFriendRequest(notification: any) {
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

    async function hideNotification(notification: any) {
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

    async function acceptRequestInvite(notification: any) {
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
        notification: any,
        messageType: any
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

    async function sendInviteResponseSlot({ notification, row }: any) {
        await sendInviteResponseNotification({
            currentUserId,
            endpoint,
            notification,
            responseSlot: row?.slot
        });
        await refreshCenter();
        toast.success(t('view.notification.success.invite_response_sent'));
    }

    async function sendBoopReply(notification: any, emojiId: any = '') {
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

    async function sendNotificationResponse(notification: any, response: any) {
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

    async function deleteNotification(notification: any) {
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
                                    <TooltipTrigger asChild>
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
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t(
                                            'side_panel.notification_center.mark_all_read'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={t(
                                                'view.notification.refresh_tooltip'
                                            )}
                                            disabled={loadStatus === 'running'}
                                            onClick={() => {
                                                loadForCurrentUser().catch(
                                                    (error: any) => {
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
                                    </TooltipTrigger>
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
                        currentUserId={currentUserId}
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
                onOpenChange={(open: any) => {
                    if (!open) {
                        setInviteResponseRequest(null);
                    }
                }}
                currentUserId={currentUserId}
                endpoint={endpoint}
                messageType={inviteResponseRequest?.messageType || 'response'}
                mode="respond"
                targetLabel={
                    inviteResponseRequest?.notification?.senderUsername ||
                    inviteResponseRequest?.notification?.senderUserId ||
                    'this user'
                }
                allowEdit
                allowImageUpload={false}
                onUse={(payload: any) =>
                    sendInviteResponseSlot({
                        ...payload,
                        notification: inviteResponseRequest?.notification
                    })
                }
            />
            <BoopReplyDialog
                request={boopReplyRequest}
                endpoint={endpoint}
                isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                onOpenChange={(open: any) => {
                    if (!open) {
                        setBoopReplyRequest(null);
                    }
                }}
                onSend={sendBoopReply}
            />
        </>
    );
}
