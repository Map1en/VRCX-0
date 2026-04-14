import { useEffect, useMemo, useState } from 'react';
import {
    BellIcon,
    CheckIcon,
    ExternalLinkIcon,
    MessageCircleIcon,
    RefreshCcwIcon,
    SendIcon,
    Trash2Icon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { convertFileUrlToImageUrl, openExternalLink } from '@/lib/entityMedia.js';
import {
    notificationRepository,
    toolsRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { getNotificationTs } from '@/shared/utils/notificationCategory.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

const categoryOrder = ['friend', 'group', 'other'];

function normalizeWorldTarget(value) {
    const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    const parsed = parseLocation(text);
    if (parsed.isRealInstance && parsed.tag) {
        return parsed.tag;
    }
    return parsed.worldId || text.split(':')[0] || text;
}

function getNotificationMessage(notification) {
    return [
        notification?.title,
        notification?.message,
        notification?.details?.inviteMessage,
        notification?.details?.requestMessage,
        notification?.details?.responseMessage,
        notification?.details?.worldName
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
}

function getSenderName(notification) {
    return (
        notification?.title ||
        notification?.senderUsername ||
        notification?.data?.groupName ||
        notification?.groupName ||
        notification?.details?.groupName ||
        notification?.type ||
        'Notification'
    );
}

function getImageUrl(notification) {
    return notification?.details?.imageUrl || notification?.imageUrl || notification?.senderUserIcon || '';
}

function formatNotificationTime(notification) {
    const timestamp = getNotificationTs(notification);
    if (!timestamp) {
        return '';
    }
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(timestamp));
}

function isNotificationExpired(notification) {
    if (notification?.expired !== undefined) {
        return Boolean(notification.expired);
    }
    if (!notification?.expiresAt) {
        return false;
    }
    const expiresAt = Date.parse(notification.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function canDeclineNotification(notification) {
    const type = notification?.type || '';
    const link = notification?.link || '';
    return (
        type !== 'requestInviteResponse' &&
        type !== 'inviteResponse' &&
        type !== 'message' &&
        type !== 'boop' &&
        type !== 'groupChange' &&
        !type.includes('group.') &&
        !type.includes('moderation.') &&
        !type.includes('instance.') &&
        !link.startsWith('economy.')
    );
}

function shouldShowDeleteLog(notification) {
    const type = notification?.type || '';
    return type !== 'friendRequest' && type !== 'ignoredFriendRequest';
}

function getResponseLabel(response) {
    return response?.text || response?.type || 'Respond';
}

function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    if (currentLocation === 'traveling') {
        return String(gameState?.currentDestination || '').trim();
    }
    return (
        currentLocation ||
        String(gameState?.currentDestination || '').trim() ||
        String(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location || '').trim()
    );
}

function openNotificationLink(link) {
    const value = String(link || '').trim();
    if (!value) {
        return false;
    }
    if (value.startsWith('user:')) {
        const userId = value.slice('user:'.length);
        openUserDialog({ userId });
        return true;
    }
    if (value.startsWith('group:')) {
        const groupId = value.slice('group:'.length);
        openGroupDialog({ groupId });
        return true;
    }
    if (value.startsWith('event:')) {
        const [groupId] = value.slice('event:'.length).split(',');
        if (groupId) {
            openGroupDialog({ groupId });
            return true;
        }
    }
    if (value.startsWith('world:')) {
        const worldId = normalizeWorldTarget(value.slice('world:'.length));
        openWorldDialog({ worldId });
        return true;
    }
    if (value.startsWith('avatar:')) {
        const avatarId = value.slice('avatar:'.length);
        openAvatarDialog({ avatarId });
        return true;
    }
    void openExternalLink(value);
    return true;
}

function openSender(notification) {
    const userId = String(notification?.senderUserId || '').trim();
    if (userId.startsWith('grp_') || notification?.type?.startsWith('group.') || notification?.type === 'groupChange') {
        const groupId = userId.startsWith('grp_') ? userId : notification?.data?.groupId || notification?.details?.groupId || '';
        if (groupId) {
            openGroupDialog({ groupId, title: getSenderName(notification) });
            return;
        }
    }
    if (userId) {
        openUserDialog({ userId, title: notification?.senderUsername || undefined });
        return;
    }
    if (!openNotificationLink(notification?.link)) {
        toast.info('This notification does not expose a navigable sender.');
    }
}

function NotificationAvatar({ notification }) {
    const imageUrl = getImageUrl(notification);
    const isGroup = String(notification?.senderUserId || '').startsWith('grp_') || notification?.type?.startsWith('group.');
    const Icon = isGroup ? UsersIcon : UserIcon;

    if (imageUrl && !imageUrl.startsWith('default_')) {
        return (
            <img
                src={convertFileUrlToImageUrl(imageUrl, 64)}
                alt=""
                className="size-9 shrink-0 rounded-md object-cover"
            />
        );
    }

    return (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Icon className="size-4" />
        </div>
    );
}

function NotificationRow({
    notification,
    isUnseen,
    currentUserId,
    canInviteFromCurrentLocation,
    onAcceptFriendRequest,
    onAcceptRequestInvite,
    onSendInviteResponseWithMessage,
    onSendNotificationResponse,
    onHideNotification,
    onDeleteNotification,
    onMarkSeen
}) {
    const message = getNotificationMessage(notification);
    const timeLabel = formatNotificationTime(notification);
    const hasLink = Boolean(notification?.link);
    const responses = Array.isArray(notification?.responses) ? notification.responses : [];
    const remoteActionsVisible =
        notification?.senderUserId !== currentUserId && !isNotificationExpired(notification);

    return (
        <div className="mb-1.5 flex gap-2 rounded-md border bg-card p-2 text-card-foreground">
            <button type="button" className="shrink-0" onClick={() => openSender(notification)}>
                <NotificationAvatar notification={notification} />
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                        onClick={() => openSender(notification)}>
                        {getSenderName(notification)}
                    </button>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {notification?.type || 'unknown'}
                    </Badge>
                    {isUnseen ? <span className="size-2 shrink-0 rounded-full bg-blue-500" /> : null}
                </div>
                {message ? (
                    <div className="mt-1 truncate text-xs text-muted-foreground">{message}</div>
                ) : null}
                {notification?.details?.worldName ? (
                    <div className="truncate text-xs text-muted-foreground">{notification.details.worldName}</div>
                ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                {timeLabel ? <span className="text-[10px] text-muted-foreground">{timeLabel}</span> : null}
                <div className="flex items-center gap-1">
                    {remoteActionsVisible && notification.type === 'friendRequest' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Accept"
                            onClick={() => void onAcceptFriendRequest(notification)}>
                            <CheckIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible && notification.type === 'requestInvite' && canInviteFromCurrentLocation ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Invite"
                            onClick={() => void onAcceptRequestInvite(notification)}>
                            <SendIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible && notification.type === 'invite' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Decline with message"
                            onClick={() => void onSendInviteResponseWithMessage(notification, 'response')}>
                            <MessageCircleIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible && notification.type === 'requestInvite' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Decline with message"
                            onClick={() => void onSendInviteResponseWithMessage(notification, 'requestResponse')}>
                            <MessageCircleIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible
                        ? responses.map((response) => (
                            <Button
                                key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                title={getResponseLabel(response)}
                                onClick={() => void onSendNotificationResponse(notification, response)}>
                                {response?.type === 'link' ? (
                                    <ExternalLinkIcon className="size-3.5" />
                                ) : (
                                    <CheckIcon className="size-3.5" />
                                )}
                            </Button>
                        ))
                        : null}
                    {remoteActionsVisible && canDeclineNotification(notification) ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Decline"
                            onClick={() => void onHideNotification(notification)}>
                            <XIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {hasLink ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => openNotificationLink(notification.link)}>
                            <ExternalLinkIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {isUnseen ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => {
                                void onMarkSeen(notification);
                            }}>
                            <CheckIcon className="size-3.5" />
                        </Button>
                    ) : null}
                    {shouldShowDeleteLog(notification) ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Delete log"
                            onClick={() => void onDeleteNotification(notification)}>
                            <Trash2Icon className="size-3.5" />
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function NotificationList({
    unseen,
    recent,
    currentUserId,
    canInviteFromCurrentLocation,
    onAcceptFriendRequest,
    onAcceptRequestInvite,
    onSendInviteResponseWithMessage,
    onSendNotificationResponse,
    onHideNotification,
    onDeleteNotification,
    onMarkSeen,
    onNavigateToTable,
    t
}) {
    const rows = useMemo(
        () => [
            ...unseen.map((notification) => ({
                key: `unseen:${notification.id}`,
                notification,
                isUnseen: true
            })),
            ...(recent.length
                ? [{ key: 'recent-header', section: true }]
                : []),
            ...recent.map((notification) => ({
                key: `recent:${notification.id}`,
                notification,
                isUnseen: false
            }))
        ],
        [recent, unseen]
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {rows.length ? (
                    rows.map((row) =>
                        row.section ? (
                            <div key={row.key} className="flex items-center gap-2 px-2 py-2">
                                <Separator className="flex-1" />
                                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                                    {t('side_panel.notification_center.past_notifications')}
                                </span>
                                <Separator className="flex-1" />
                            </div>
                        ) : (
                            <NotificationRow
                                key={row.key}
                                notification={row.notification}
                                isUnseen={row.isUnseen}
                                currentUserId={currentUserId}
                                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                                onAcceptFriendRequest={onAcceptFriendRequest}
                                onAcceptRequestInvite={onAcceptRequestInvite}
                                onSendInviteResponseWithMessage={onSendInviteResponseWithMessage}
                                onSendNotificationResponse={onSendNotificationResponse}
                                onHideNotification={onHideNotification}
                                onDeleteNotification={onDeleteNotification}
                                onMarkSeen={onMarkSeen}
                            />
                        )
                    )
                ) : (
                    <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                        {t('side_panel.notification_center.no_new_notifications')}
                    </div>
                )}
            </div>
            <div className="flex justify-center border-t p-3">
                <Button type="button" variant="secondary" size="sm" onClick={onNavigateToTable}>
                    {t('side_panel.notification_center.view_more')}
                </Button>
            </div>
        </div>
    );
}

export function VrcNotificationCenterHost() {
    const { t } = useI18n();
    const modalStore = useModalStore();
    const runtimeAuth = useRuntimeStore((state) => state.auth);
    const gameState = useRuntimeStore((state) => state.gameState);
    const isCenterOpen = useVrcNotificationStore((state) => state.isCenterOpen);
    const categories = useVrcNotificationStore((state) => state.categories);
    const unseenCount = useVrcNotificationStore((state) => state.unseenCount);
    const loadStatus = useVrcNotificationStore((state) => state.loadStatus);
    const detail = useVrcNotificationStore((state) => state.detail);
    const setCenterOpen = useVrcNotificationStore((state) => state.setCenterOpen);
    const loadForCurrentUser = useVrcNotificationStore((state) => state.loadForCurrentUser);
    const markNotificationSeen = useVrcNotificationStore((state) => state.markNotificationSeen);
    const markAllSeen = useVrcNotificationStore((state) => state.markAllSeen);
    const [activeTab, setActiveTab] = useState('friend');
    const currentUserId = runtimeAuth.currentUserId;
    const endpoint = runtimeAuth.currentUserEndpoint;
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, runtimeAuth.currentUserSnapshot),
        [gameState, runtimeAuth.currentUserSnapshot]
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
            toast.error(error instanceof Error ? error.message : 'Failed to mark notifications as seen.');
        });
    }

    function handleOpenChange(open) {
        if (!open && unseenCount > 0) {
            markAllSeenOnClose();
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
            const result = await modalStore.confirm({
                title: 'Accept friend request',
                description: `Accept the friend request from ${notification.senderUsername || 'this user'}?`
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.acceptFriendRequest({
                id: notification.id,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success('Friend request accepted.');
        } catch (error) {
            if (error?.status === 404) {
                await expireNotificationLocally(notification);
                return;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to accept friend request.');
        }
    }

    async function hideNotification(notification) {
        try {
            const result = await modalStore.confirm({
                title: 'Decline notification',
                description: `Decline the ${notification.type || 'notification'} notification?`,
                confirmText: 'Decline',
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
            toast.success('Notification declined.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to decline notification.');
        }
    }

    async function acceptRequestInvite(notification) {
        try {
            if (!currentInviteLocation) {
                toast.error('Cannot invite: no current VRChat location is available.');
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.error('Cannot invite from the current instance type.');
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.error('Cannot invite: current location is not a concrete instance.');
                return;
            }
            const result = await modalStore.confirm({
                title: 'Send invite',
                description: `Send an invite to ${notification.senderUsername || 'this user'}?`
            });
            if (!result.ok) {
                return;
            }

            const worldResponse = await vrchatSearchRepository.getWorlds({}, parsedLocation.worldId, { endpoint });
            await notificationRepository.sendInvite({
                receiverUserId: notification.senderUserId,
                endpoint,
                params: {
                    instanceId: currentInviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName: worldResponse.json?.name || parsedLocation.worldId,
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
            toast.success('Invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite.');
        }
    }

    async function sendInviteResponseWithMessage(notification, messageType) {
        try {
            if (!currentUserId) {
                toast.error('Cannot send invite response: no current user session is available.');
                return;
            }
            const rows = await toolsRepository.getInviteMessages(
                { currentUserId, messageType },
                { endpoint }
            );
            const slots = (Array.isArray(rows) ? rows : [])
                .map((row) => ({
                    slot: Number.parseInt(row?.slot, 10),
                    message: String(row?.message || '').trim()
                }))
                .filter((row) => Number.isFinite(row.slot));
            const defaultSlot = String(slots[0]?.slot ?? 0);
            const preview = slots
                .slice(0, 6)
                .map((row) => `${row.slot}: ${row.message || '(empty)'}`)
                .join('\n');
            const result = await modalStore.prompt({
                title: 'Decline with message',
                description: preview
                    ? `Choose the invite response slot to send.\n${preview}`
                    : 'Choose the invite response slot to send.',
                inputValue: defaultSlot,
                confirmText: 'Send'
            });
            if (!result.ok) {
                return;
            }
            const responseSlot = Number.parseInt(result.value, 10);
            if (!Number.isFinite(responseSlot)) {
                toast.error('Response slot must be a number.');
                return;
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
            toast.success('Invite response sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite response.');
        }
    }

    async function sendNotificationResponse(notification, response) {
        try {
            const responseType = String(response?.type || '').toLowerCase();
            if (response?.type === 'link') {
                openNotificationLink(response.data);
                return;
            }
            if (notification.type === 'boop' && (responseType === 'reply' || responseType === 'boop')) {
                await notificationRepository.sendBoop({
                    userId: notification.senderUserId,
                    endpoint
                });
                await notificationRepository.hideRemoteNotification({
                    id: notification.id,
                    version: notification.version,
                    type: notification.type,
                    senderUserId: notification.senderUserId,
                    endpoint
                }).catch(() => {});
                await expireNotificationLocally(notification);
                toast.success('Boop sent.');
                return;
            }
            await notificationRepository.sendNotificationResponse({
                id: notification.id,
                responseType: response?.type,
                responseData: response?.data || '',
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success('Notification response sent.');
        } catch (error) {
            if (notification.version >= 2) {
                await expireNotificationLocally(notification);
            }
            toast.error(error instanceof Error ? error.message : 'Failed to send notification response.');
        }
    }

    async function deleteNotification(notification) {
        try {
            const result = await modalStore.confirm({
                title: 'Delete notification log entry',
                description: `Delete the local ${notification.type || 'notification'} log entry?`,
                confirmText: 'Delete',
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
            toast.success('Notification log entry deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete notification.');
        }
    }

    return (
        <Sheet open={isCenterOpen} onOpenChange={handleOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
                <SheetHeader className="border-b px-4 pt-4 pb-3">
                    <div className="flex items-center justify-between gap-3 pr-8">
                        <SheetTitle className="flex items-center gap-2">
                            <BellIcon className="size-4" />
                            {t('side_panel.notification_center.title')}
                        </SheetTitle>
                        <div className="flex items-center gap-2">
                            <Badge variant={unseenCount ? 'default' : 'outline'}>{unseenCount}</Badge>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                disabled={loadStatus === 'running'}
                                onClick={() => {
                                    void loadForCurrentUser().catch((error) => {
                                        toast.error(error instanceof Error ? error.message : 'Failed to refresh notifications.');
                                    });
                                }}>
                                <RefreshCcwIcon className={`size-4 ${loadStatus === 'running' ? 'animate-spin' : ''}`} />
                            </Button>
                        </div>
                    </div>
                    {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
                </SheetHeader>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
                    <TabsList className="mx-2 mt-2 grid grid-cols-3">
                        {categoryOrder.map((category) => (
                            <TabsTrigger key={category} value={category}>
                                {t(`side_panel.notification_center.tab_${category}`)}
                                {categories[category]?.unseen?.length ? (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        ({categories[category].unseen.length})
                                    </span>
                                ) : null}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {categoryOrder.map((category) => (
                        <TabsContent key={category} value={category} className="mt-0 min-h-0 flex-1 overflow-hidden">
                            <NotificationList
                                unseen={categories[category]?.unseen || []}
                                recent={categories[category]?.recent || []}
                                currentUserId={currentUserId}
                                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                                onAcceptFriendRequest={acceptFriendRequest}
                                onAcceptRequestInvite={acceptRequestInvite}
                                onSendInviteResponseWithMessage={sendInviteResponseWithMessage}
                                onSendNotificationResponse={sendNotificationResponse}
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
    );
}
