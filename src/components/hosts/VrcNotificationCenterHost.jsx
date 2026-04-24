import { BellIcon, RefreshCcwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog.jsx';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { NotificationList } from './vrc-notification-center/NotificationList.jsx';
import {
    buildCachedInstanceMap,
    categoryOrder,
    openNotificationLink,
    resolveCurrentInviteLocation
} from './vrc-notification-center/notificationCenterUtils.js';

export function VrcNotificationCenterHost() {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserLocationTag = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.$locationTag
    );
    const currentUserLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.location
    );
    const currentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const groupInstancesEndpoint = useRuntimeStore(
        (state) => state.groupInstances.endpoint
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
    const [activeTab, setActiveTab] = useState('friend');
    const [inviteResponseRequest, setInviteResponseRequest] = useState(null);
    const groupInstanceRows =
        groupInstancesEndpoint === endpoint ? groupInstances : [];
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

    useEffect(() => {
        if (!isCenterOpen) {
            return;
        }
        for (const category of categoryOrder) {
            if (categories[category]?.unseen?.length) {
                setActiveTab(category);
                return;
            }
        }
        setActiveTab('friend');
    }, [categories, isCenterOpen]);

    function markAllSeenOnClose() {
        if (unseenCount <= 0) {
            return;
        }
        void markAllSeen().catch((error) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.generated_toast.failed_to_mark_notifications_as_seen'
                      )
            );
        });
    }

    function handleOpenChange(open) {
        if (!open && unseenCount > 0) {
            markAllSeenOnClose();
        }
        if (!open) {
            setInviteResponseRequest(null);
        }
        setCenterOpen(open);
    }

    function navigateToTable() {
        handleOpenChange(false);
        window.location.hash = '#/notification?fromCenter=1';
    }

    async function refreshCenter() {
        await loadForCurrentUser();
    }

    async function expireNotificationLocally(notification) {
        await notificationRepository.expireNotification({
            userId: currentUserId,
            id: notification.id
        });
        await refreshCenter();
    }

    async function acceptFriendRequest(notification) {
        try {
            const result = await confirm({
                title: t(
                    'host.vrc_notification_center.generated_modal.accept_friend_request'
                ),
                description: t(
                    'host.vrc_notification_center.generated_dynamic.accept_the_friend_request_from_value',
                    { value: notification.senderUsername || 'this user' }
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
                          'host.vrc_notification_center.generated_toast.failed_to_accept_friend_request'
                      )
            );
        }
    }

    async function hideNotification(notification) {
        try {
            const result = await confirm({
                title: t(
                    'host.vrc_notification_center.generated_modal.decline_notification'
                ),
                description: t(
                    'host.vrc_notification_center.generated_dynamic.decline_the_value_notification',
                    { value: notification.type || 'notification' }
                ),
                confirmText: t(
                    'host.vrc_notification_center.generated_modal.decline'
                ),
                destructive: true
            });
            if (!result.ok) {
                return;
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
                          'host.vrc_notification_center.generated_toast.failed_to_decline_notification'
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
                title: t(
                    'host.vrc_notification_center.generated_modal.send_invite'
                ),
                description: t(
                    'host.vrc_notification_center.generated_dynamic.send_an_invite_to_value',
                    { value: notification.senderUsername || 'this user' }
                )
            });
            if (!result.ok) {
                return;
            }

            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint }
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
                          'host.vrc_notification_center.generated_toast.failed_to_send_invite'
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
        setInviteResponseRequest({ notification, messageType });
    }

    async function sendInviteResponseSlot({ notification, row }) {
        const responseSlot = Number.parseInt(row?.slot, 10);
        if (!notification || !Number.isFinite(responseSlot)) {
            throw new Error('Response slot must be a number.');
        }
        await notificationRepository.sendInviteResponse({
            id: notification.id,
            responseSlot,
            endpoint
        });
        await notificationRepository.hideRemoteNotification({
            id: notification.id,
            version: notification.version,
            type: notification.type,
            senderUserId: notification.senderUserId,
            endpoint
        });
        await expireNotificationLocally(notification);
        toast.success(t('view.notification.generated.invite_response_sent'));
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
                (
                    responseType === 'reply' ||
                    responseType === 'boop' ||
                    response?.icon === 'reply'
                )
            ) {
                await notificationRepository.sendBoop({
                    userId: notification.senderUserId,
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
                          'host.vrc_notification_center.generated_toast.failed_to_send_notification_response'
                      )
            );
        }
    }

    async function deleteNotification(notification) {
        try {
            const result = await confirm({
                title: t(
                    'host.vrc_notification_center.generated_modal.delete_notification_log_entry'
                ),
                description: t(
                    'host.vrc_notification_center.generated_modal.delete_the_local_value_log_entry',
                    { value: notification.type || 'notification' }
                ),
                confirmText: t('common.actions.delete'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.deleteNotification({
                userId: currentUserId,
                id: notification.id,
                version: notification.version
            });
            await refreshCenter();
            toast.success(
                t('view.notification.generated.notification_log_entry_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'host.vrc_notification_center.generated_toast.failed_to_delete_notification'
                      )
            );
        }
    }

    return (
        <>
            <Sheet open={isCenterOpen} onOpenChange={handleOpenChange}>
                <SheetContent
                    side="right"
                    className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
                >
                    <SheetHeader className="border-b px-4 pt-4 pb-3">
                        <div className="flex items-center justify-between gap-3 pr-8">
                            <SheetTitle className="flex items-center gap-2">
                                <BellIcon className="size-4" />
                                {t('side_panel.notification_center.title')}
                            </SheetTitle>
                            <div className="flex items-center gap-2">
                                <Badge
                                    variant={unseenCount ? 'default' : 'outline'}
                                >
                                    {unseenCount}
                                </Badge>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t(
                                        'view.notification.refresh_tooltip'
                                    )}
                                    title={t('view.notification.refresh_tooltip')}
                                    disabled={loadStatus === 'running'}
                                    onClick={() => {
                                        void loadForCurrentUser().catch(
                                            (error) => {
                                                toast.error(
                                                    userFacingErrorMessage(
                                                        error,
                                                        t(
                                                            'host.vrc_notification_center.generated_toast.failed_to_refresh_notifications'
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
                    <Tabs
                        value={activeTab}
                        onValueChange={setActiveTab}
                        className="flex min-h-0 flex-1 flex-col"
                    >
                        <TabsList className="mx-2 mt-2 grid grid-cols-3">
                            {categoryOrder.map((category) => (
                                <TabsTrigger key={category} value={category}>
                                    {t(
                                        `side_panel.notification_center.tab_${category}`
                                    )}
                                    {categories[category]?.unseen?.length ? (
                                        <span className="text-muted-foreground ml-1 text-xs">
                                            (
                                            {
                                                categories[category].unseen
                                                    .length
                                            }
                                            )
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        {categoryOrder.map((category) => (
                            <TabsContent
                                key={category}
                                value={category}
                                className="mt-0 min-h-0 flex-1 overflow-hidden"
                            >
                                <NotificationList
                                    unseen={categories[category]?.unseen || []}
                                    recent={categories[category]?.recent || []}
                                    currentUserId={currentUserId}
                                    canInviteFromCurrentLocation={
                                        canInviteFromCurrentLocation
                                    }
                                    onAcceptFriendRequest={acceptFriendRequest}
                                    onAcceptRequestInvite={acceptRequestInvite}
                                    onSendInviteResponseWithMessage={
                                        sendInviteResponseWithMessage
                                    }
                                    onSendNotificationResponse={
                                        sendNotificationResponse
                                    }
                                    onHideNotification={hideNotification}
                                    onDeleteNotification={deleteNotification}
                                    onMarkSeen={markNotificationSeen}
                                    onNavigateToTable={navigateToTable}
                                    t={t}
                                />
                            </TabsContent>
                        ))}
                    </Tabs>
                </SheetContent>
            </Sheet>
            <InviteMessageDialog
                open={Boolean(inviteResponseRequest)}
                onOpenChange={(open) => {
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
                onUse={(payload) =>
                    sendInviteResponseSlot({
                        ...payload,
                        notification: inviteResponseRequest?.notification
                    })
                }
            />
        </>
    );
}
