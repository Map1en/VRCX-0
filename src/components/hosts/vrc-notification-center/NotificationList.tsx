import {
    BanIcon,
    BellOffIcon,
    CalendarDaysIcon,
    CheckIcon,
    ExternalLinkIcon,
    LinkIcon,
    MessageCircleIcon,
    ReplyIcon,
    TagIcon,
    Trash2Icon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    canDeclineNotification,
    formatNotificationTime,
    getNotificationImageUrl,
    getNotificationMessage,
    getResponseLabel,
    getSenderName,
    isNotificationExpired,
    openNotificationLink,
    openSender,
    shouldShowDeleteLog
} from './notificationCenterUtils';

function isGroupNotification(notification: any) {
    return (
        String(notification?.senderUserId || '').startsWith('grp_') ||
        notification?.type?.startsWith('group.') ||
        notification?.type === 'groupChange'
    );
}

function isFriendNotification(notification: any) {
    return [
        'invite',
        'requestInvite',
        'inviteResponse',
        'requestInviteResponse',
        'friendRequest',
        'ignoredFriendRequest',
        'boop'
    ].includes(notification?.type);
}

function getNotificationTypeLabel(notification: any, t: any) {
    const type = notification?.type || 'unknown';
    return t(`view.notification.filters.${type}`, {
        defaultValue: type
    });
}

function getNotificationAbsoluteTime(notification: any) {
    const timestamp = notification?.createdAt || notification?.created_at;
    if (!timestamp) {
        return '';
    }
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? ''
        : format(date, 'yyyy-MM-dd HH:mm:ss');
}

function getNotificationRelativeTime(notification: any) {
    const timestamp = notification?.createdAt || notification?.created_at;
    if (!timestamp) {
        return '';
    }
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? ''
        : formatDistanceToNow(date, { addSuffix: false });
}

function getGroupDisplayName(notification: any) {
    return (
        notification?.title ||
        notification?.data?.groupName ||
        notification?.groupName ||
        notification?.details?.groupName ||
        notification?.senderUsername ||
        ''
    );
}

function getHoverTitle(notification: any) {
    return notification?.data?.announcementTitle || notification?.title || '';
}

function getFriendMessage(notification: any) {
    return (
        notification?.message ||
        notification?.details?.inviteMessage ||
        notification?.details?.requestMessage ||
        notification?.details?.responseMessage ||
        ''
    );
}

function NotificationAvatar({
    notification,
    className = 'size-9 rounded-md',
    fallbackClassName = 'rounded-md'
}: any) {
    const imageUrl = getNotificationImageUrl(notification);
    const isGroup = isGroupNotification(notification);
    const Icon = isGroup ? UsersIcon : UserIcon;

    return (
        <Avatar className={cn('shrink-0', className)}>
            {imageUrl ? (
                <AvatarImage
                    src={imageUrl}
                    alt=""
                    className={fallbackClassName}
                />
            ) : null}
            <AvatarFallback className={fallbackClassName}>
                <Icon className="size-4" />
            </AvatarFallback>
        </Avatar>
    );
}

function NotificationLocationLine({ notification }: any) {
    if (notification?.type === 'invite' && notification?.details?.worldId) {
        return (
            <Location
                location={notification.details.worldId}
                hint={notification.details.worldName || ''}
                grouphint={notification.details.groupName || ''}
                link
                className="text-xs"
            />
        );
    }

    if (
        (notification?.type === 'group.queueReady' ||
            notification?.type === 'instance.closed') &&
        notification?.location
    ) {
        return (
            <Location
                location={notification.location}
                hint={notification.worldName || ''}
                grouphint={notification.groupName || ''}
                link
                className="text-xs"
            />
        );
    }

    return null;
}

function NotificationHoverContent({
    notification,
    senderName,
    typeLabel,
    message,
    absoluteTime
}: any) {
    const groupNotification = isGroupNotification(notification);
    const friendNotification = isFriendNotification(notification);
    const groupDisplayName = getGroupDisplayName(notification);
    const hoverTitle = getHoverTitle(notification);
    const friendMessage = getFriendMessage(notification);
    const fallbackTitle = senderName || notification?.type || 'Notification';

    return (
        <HoverCardContent
            side="left"
            sideOffset={8}
            className="w-72 p-3 sm:w-96"
        >
            {groupNotification ? (
                <>
                    <div className="mb-2 flex items-center gap-2">
                        <NotificationAvatar
                            notification={notification}
                            className="size-8 rounded-md"
                            fallbackClassName="rounded-md"
                        />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {groupDisplayName || fallbackTitle}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {typeLabel}
                            </p>
                        </div>
                    </div>
                    {hoverTitle ? (
                        <p className="mb-1 text-sm font-medium">{hoverTitle}</p>
                    ) : null}
                    {notification?.message ? (
                        <p className="text-muted-foreground text-xs leading-relaxed break-words whitespace-pre-line">
                            {notification.message}
                        </p>
                    ) : null}
                </>
            ) : friendNotification ? (
                <>
                    <div className="mb-2 flex items-center gap-2">
                        <NotificationAvatar notification={notification} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {senderName}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {typeLabel}
                            </p>
                        </div>
                    </div>
                    <div className="mb-1 text-xs">
                        <NotificationLocationLine notification={notification} />
                    </div>
                    {friendMessage ? (
                        <p className="text-muted-foreground text-xs leading-relaxed break-words">
                            {friendMessage}
                        </p>
                    ) : null}
                </>
            ) : (
                <>
                    <div className="mb-2 flex items-center gap-2">
                        <NotificationAvatar notification={notification} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {fallbackTitle}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {typeLabel}
                            </p>
                        </div>
                    </div>
                    {notification?.title ? (
                        <p className="mb-1 text-sm font-medium">
                            {notification.title}
                        </p>
                    ) : null}
                    {message ? (
                        <p className="text-muted-foreground text-xs leading-relaxed break-words whitespace-pre-line">
                            {message}
                        </p>
                    ) : null}
                </>
            )}
            {absoluteTime ? (
                <>
                    <Separator className="my-2" />
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <CalendarDaysIcon data-icon="inline-start" />
                        {absoluteTime}
                    </div>
                </>
            ) : null}
        </HoverCardContent>
    );
}

function NotificationActionButton({ label, onClick, children }: any) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={label}
                    onClick={onClick}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function getResponseIcon(response: any, notificationType: any) {
    if (response?.type === 'link') {
        return LinkIcon;
    }
    switch (response?.icon) {
        case 'check':
            return CheckIcon;
        case 'cancel':
            return XIcon;
        case 'ban':
            return BanIcon;
        case 'bell-slash':
            return BellOffIcon;
        case 'reply':
            return notificationType === 'boop' ? MessageCircleIcon : ReplyIcon;
        default:
            return TagIcon;
    }
}

function canMarkNotificationSeen(notification: any) {
    return !(
        Number(notification?.version ?? 1) !== 2 &&
        notification?.type === 'friendRequest'
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
}: any) {
    const { t } = useTranslation();
    const message = getNotificationMessage(notification);
    const senderName =
        getSenderName(notification) ||
        notification?.type ||
        t('nav_tooltip.notification');
    const typeLabel = getNotificationTypeLabel(notification, t);
    const relativeTime = getNotificationRelativeTime(notification);
    const absoluteTime =
        getNotificationAbsoluteTime(notification) ||
        formatNotificationTime(notification);
    const hasLink = Boolean(notification?.link);
    const responses = Array.isArray(notification?.responses)
        ? notification.responses
        : [];
    const remoteActionsVisible =
        notification?.senderUserId !== currentUserId &&
        !isNotificationExpired(notification);

    return (
        <HoverCard openDelay={400} closeDelay={100}>
            <HoverCardTrigger asChild>
                <div className="bg-card text-card-foreground mb-1.5 flex gap-2 rounded-md border p-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 p-0"
                        aria-label={senderName}
                        onClick={() => openSender(notification, t)}
                    >
                        <NotificationAvatar notification={notification} />
                    </Button>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto min-w-0 flex-1 justify-start p-0 text-left text-sm font-medium"
                                onClick={() => openSender(notification, t)}
                            >
                                <span className="truncate">{senderName}</span>
                            </Button>
                            <Badge
                                variant="secondary"
                                className="text-muted-foreground shrink-0 text-xs"
                            >
                                {typeLabel}
                            </Badge>
                            {isUnseen &&
                            !isNotificationExpired(notification) ? (
                                <span className="bg-primary ml-auto size-2 shrink-0 rounded-full" />
                            ) : null}
                        </div>
                        <div className="text-muted-foreground mt-1 truncate text-xs">
                            <NotificationLocationLine
                                notification={notification}
                            />
                        </div>
                        {message ? (
                            <div className="text-muted-foreground truncate text-xs">
                                {message}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                        {relativeTime ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                                        {relativeTime}
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>{absoluteTime}</TooltipContent>
                            </Tooltip>
                        ) : null}
                        <div className="flex items-center gap-1">
                            {remoteActionsVisible &&
                            notification.type === 'friendRequest' ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.actions.accept'
                                    )}
                                    onClick={() => {
                                        onAcceptFriendRequest(notification);
                                    }}
                                >
                                    <CheckIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'requestInvite' &&
                            canInviteFromCurrentLocation ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.actions.invite'
                                    )}
                                    onClick={() => {
                                        onAcceptRequestInvite(notification);
                                    }}
                                >
                                    <CheckIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'invite' ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.actions.decline_with_message'
                                    )}
                                    onClick={() => {
                                        onSendInviteResponseWithMessage(
                                            notification,
                                            'response'
                                        );
                                    }}
                                >
                                    <MessageCircleIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'requestInvite' ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.actions.decline_with_message'
                                    )}
                                    onClick={() => {
                                        onSendInviteResponseWithMessage(
                                            notification,
                                            'requestResponse'
                                        );
                                    }}
                                >
                                    <MessageCircleIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {remoteActionsVisible
                                ? responses.map((response: any) => {
                                      const responseLabel =
                                          getResponseLabel(response);
                                      const ResponseIcon = getResponseIcon(
                                          response,
                                          notification.type
                                      );
                                      return (
                                          <NotificationActionButton
                                              key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                              label={responseLabel}
                                              onClick={() => {
                                                  onSendNotificationResponse(
                                                      notification,
                                                      response
                                                  );
                                              }}
                                          >
                                              <ResponseIcon data-icon="icon" />
                                          </NotificationActionButton>
                                      );
                                  })
                                : null}
                            {remoteActionsVisible &&
                            canDeclineNotification(notification) ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.actions.decline'
                                    )}
                                    onClick={() => {
                                        onHideNotification(notification);
                                    }}
                                >
                                    <XIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {hasLink ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.action.open_notification_link'
                                    )}
                                    onClick={() =>
                                        openNotificationLink(notification.link)
                                    }
                                >
                                    <ExternalLinkIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {isUnseen &&
                            canMarkNotificationSeen(notification) ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.action.mark_seen'
                                    )}
                                    onClick={() => {
                                        onMarkSeen(notification);
                                    }}
                                >
                                    <CheckIcon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                            {shouldShowDeleteLog(notification) ? (
                                <NotificationActionButton
                                    label={t(
                                        'view.notification.actions.delete_log'
                                    )}
                                    onClick={() => {
                                        onDeleteNotification(notification);
                                    }}
                                >
                                    <Trash2Icon data-icon="icon" />
                                </NotificationActionButton>
                            ) : null}
                        </div>
                    </div>
                </div>
            </HoverCardTrigger>
            <NotificationHoverContent
                notification={notification}
                senderName={senderName}
                typeLabel={typeLabel}
                message={message}
                absoluteTime={absoluteTime}
            />
        </HoverCard>
    );
}

export function NotificationList({
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
    onNavigateToTable
}: any) {
    const { t } = useTranslation();
    const rows = [
        ...unseen.map((notification: any) => ({
            key: `unseen:${notification.id}`,
            notification,
            isUnseen: true
        })),
        ...(recent.length ? [{ key: 'recent-header', section: true }] : []),
        ...recent.map((notification: any) => ({
            key: `recent:${notification.id}`,
            notification,
            isUnseen: false
        }))
    ];

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {rows.length ? (
                    rows.map((row: any) =>
                        row.section ? (
                            <div
                                key={row.key}
                                className="flex items-center gap-2 px-2 py-2"
                            >
                                <Separator className="flex-1" />
                                <span className="text-muted-foreground shrink-0 text-xs tracking-wider uppercase">
                                    {t(
                                        'side_panel.notification_center.past_notifications'
                                    )}
                                </span>
                                <Separator className="flex-1" />
                            </div>
                        ) : (
                            <NotificationRow
                                key={row.key}
                                notification={row.notification}
                                isUnseen={row.isUnseen}
                                currentUserId={currentUserId}
                                canInviteFromCurrentLocation={
                                    canInviteFromCurrentLocation
                                }
                                onAcceptFriendRequest={onAcceptFriendRequest}
                                onAcceptRequestInvite={onAcceptRequestInvite}
                                onSendInviteResponseWithMessage={
                                    onSendInviteResponseWithMessage
                                }
                                onSendNotificationResponse={
                                    onSendNotificationResponse
                                }
                                onHideNotification={onHideNotification}
                                onDeleteNotification={onDeleteNotification}
                                onMarkSeen={onMarkSeen}
                            />
                        )
                    )
                ) : (
                    <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
                        {t(
                            'side_panel.notification_center.no_new_notifications'
                        )}
                    </div>
                )}
            </div>
            <div className="flex justify-center border-t p-3">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onNavigateToTable}
                >
                    {t('side_panel.notification_center.view_more')}
                </Button>
            </div>
        </div>
    );
}
