import { BellIcon, CheckCheckIcon, RefreshCcwIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import type { GroupInstanceRecord } from '@/domain/entities/group';
import { BoopReplyDialog } from '@/features/notifications/components/NotificationViewParts';
import { NotificationDrawerList } from '@/features/notifications/drawer/NotificationDrawerList';
import type {
    NotificationDialogRequest,
    NotificationRow
} from '@/features/notifications/notificationPageTypes';
import { useNotificationActions } from '@/features/notifications/useNotificationActions';
import { useNotificationTypeLabel } from '@/features/notifications/useNotificationTypeLabel';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { preserveAppTitleBarOnOpenChange } from '@/lib/overlayTitlebar';
import { cn } from '@/lib/utils';
import { openWorldDialog } from '@/services/dialogService';
import { checkCanInvite } from '@/shared/utils/invite';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    buildCachedInstanceMap,
    resolveCurrentInviteLocation
} from './notificationCenterUtils';

type InviteResponseSlotPayload = {
    imageData: string;
    notification: NotificationRow;
    row: {
        slot: number;
    };
};

const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];

export function VrcNotificationCenterHost() {
    const { t } = useTranslation();
    const notificationTypeLabel = useNotificationTypeLabel();
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
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
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
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const isCenterOpen = useVrcNotificationStore((state) => state.isCenterOpen);
    const categories = useVrcNotificationStore((state) => state.categories);
    const unseenCount = useVrcNotificationStore((state) => state.unseenCount);
    const loadStatus = useVrcNotificationStore((state) => state.loadStatus);
    const detail = useVrcNotificationStore((state) => state.detail);
    const setCenterOpen = useVrcNotificationStore(
        (state) => state.setCenterOpen
    );
    const refreshForCurrentUser = useVrcNotificationStore(
        (state) => state.refreshForCurrentUser
    );
    const [inviteResponseRequest, setInviteResponseRequest] =
        useState<NotificationDialogRequest>(null);
    const [boopReplyRequest, setBoopReplyRequest] =
        useState<NotificationRow | null>(null);
    const groupInstanceRows =
        groupInstancesUserId === currentUserId &&
        groupInstancesEndpoint === endpoint
            ? groupInstances
            : EMPTY_GROUP_INSTANCES;
    const gameState = useMemo(
        () => ({
            currentLocation,
            currentDestination,
            isGameRunning
        }),
        [currentDestination, currentLocation, isGameRunning]
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

    const {
        acceptFriendRequest,
        acceptRequestInvite,
        deleteNotification,
        hideNotification,
        markAllSeen,
        markSeen,
        sendBoopReply,
        sendInviteResponseSlot,
        sendInviteResponseWithMessage,
        sendNotificationResponse
    } = useNotificationActions({
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUserId: currentUserId ?? undefined,
        notificationTypeLabel,
        reload: refreshForCurrentUser,
        setBoopReplyRequest,
        setInviteResponseRequest
    });

    function markAllRead() {
        if (unseenCount <= 0) {
            return;
        }
        void markAllSeen();
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

    return (
        <>
            <Sheet
                open={isCenterOpen}
                modal="trap-focus"
                onOpenChange={(open, eventDetails) => {
                    if (preserveAppTitleBarOnOpenChange(open, eventDetails)) {
                        return;
                    }
                    handleOpenChange(open);
                }}
            >
                <SheetContent
                    side="right"
                    variant="inset"
                    showCloseButton={false}
                    className={cn(
                        'flex w-full! flex-col gap-0 p-0 sm:max-w-[40rem]!',
                        sidebarWindowMode &&
                            'm-4 w-[calc(100%-(--spacing(8)))]! rounded-2xl border'
                    )}
                >
                    <SheetHeader className="border-b px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                            <SheetTitle className="flex items-center gap-2 text-base">
                                <BellIcon className="text-muted-foreground size-4" />
                                {t('side_panel.notification_center.title')}
                                {unseenCount ? (
                                    <Badge
                                        variant="default"
                                        className="h-5 min-w-5 justify-center px-1.5 tabular-nums"
                                    >
                                        {unseenCount}
                                    </Badge>
                                ) : null}
                            </SheetTitle>
                            <div className="flex items-center gap-0.5">
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
                                                    refreshForCurrentUser().catch(
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
                                <SheetClose
                                    render={
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={t(
                                                'common.actions.close'
                                            )}
                                        />
                                    }
                                >
                                    <XIcon data-icon="inline-start" />
                                </SheetClose>
                            </div>
                        </div>
                        {detail ? (
                            <div className="text-muted-foreground text-xs">
                                {userFacingErrorMessage(
                                    detail,
                                    t(
                                        'view.notifications.toast.failed_to_load_notifications'
                                    )
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
                            onMarkSeen: markSeen,
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
