import type { TFunction } from 'i18next';
import {
    BanIcon,
    BellIcon,
    BellOffIcon,
    CalendarDaysIcon,
    CalendarIcon,
    CheckIcon,
    GlobeIcon,
    LinkIcon,
    MessageCircleIcon,
    MoreHorizontalIcon,
    ReplyIcon,
    SendIcon,
    ShieldIcon,
    TagIcon,
    Trash2Icon,
    UserIcon,
    UsersIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
} from '@/components/hosts/vrc-notification-center/notificationCenterUtils';
import { Location } from '@/components/Location';
import { formatDateFilter, formatRelativeTime } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type {
    NotificationResponse,
    NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getNotificationLifecycleBucket } from './notificationDrawerBuckets';
import type { NotificationDrawerHandlers } from './NotificationDrawerList';

const STATUS_JOINME_TINT =
    'color-mix(in srgb, var(--status-joinme) 14%, transparent)';
const STATUS_JOINME_UNSEEN =
    'color-mix(in srgb, var(--status-joinme) 8%, transparent)';
const STATUS_ASKME_TINT =
    'color-mix(in srgb, var(--status-askme) 14%, transparent)';

const PERSON_TYPES = new Set<string>([
    'friendRequest',
    'ignoredFriendRequest',
    'invite',
    'requestInvite',
    'inviteResponse',
    'requestInviteResponse',
    'boop',
    'message'
]);

type NotificationDrawerAction = {
    Icon: LucideIcon;
    key: string;
    label: string;
    onClick: () => void;
};

function usesAvatar(notification: NotificationRow | null | undefined) {
    return (
        PERSON_TYPES.has(String(notification?.type || '')) &&
        !hasGroupIdPrefix(String(notification?.senderUserId || ''))
    );
}

function getDiscIcon(
    notification: NotificationRow | null | undefined
): LucideIcon {
    const type = String(notification?.type || '');
    if (type === 'event.announcement') {
        return CalendarIcon;
    }
    if (type.startsWith('moderation.')) {
        return ShieldIcon;
    }
    if (type === 'instance.closed') {
        return GlobeIcon;
    }
    if (type === 'economy.alert') {
        return TagIcon;
    }
    if (type.startsWith('group.') || type === 'groupChange') {
        return UsersIcon;
    }
    return BellIcon;
}

function getResponseIcon(
    response: NotificationResponse | null | undefined,
    notificationType: unknown
): LucideIcon {
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

function canMarkNotificationSeen(
    notification: NotificationRow | null | undefined
) {
    return !(
        Number(notification?.version ?? 1) !== 2 &&
        notification?.type === 'friendRequest'
    );
}

function getNotificationTypeLabel(
    notification: NotificationRow | null | undefined,
    t: TFunction
) {
    const type = notification?.type || 'unknown';
    return String(
        t(`view.notification.filters.${type}`, {
            defaultValue: type
        })
    );
}

function getNotificationAbsoluteTime(
    notification: NotificationRow | null | undefined
) {
    const timestamp = notification?.createdAt || notification?.created_at;
    if (!timestamp) {
        return '';
    }
    const formatted = formatDateFilter(timestamp, 'long');
    return formatted === '-' ? '' : formatted;
}

function getNotificationRelativeTime(
    notification: NotificationRow | null | undefined
) {
    const timestamp = notification?.createdAt || notification?.created_at;
    if (!timestamp) {
        return '';
    }
    return formatRelativeTime(timestamp);
}

function getGroupDisplayName(notification: NotificationRow | null | undefined) {
    return (
        notification?.title ||
        notification?.data?.groupName ||
        notification?.groupName ||
        notification?.details?.groupName ||
        notification?.senderUsername ||
        ''
    );
}

function getHoverTitle(notification: NotificationRow | null | undefined) {
    return notification?.data?.announcementTitle || notification?.title || '';
}

function getFriendMessage(notification: NotificationRow | null | undefined) {
    return (
        notification?.message ||
        notification?.details?.inviteMessage ||
        notification?.details?.requestMessage ||
        notification?.details?.responseMessage ||
        ''
    );
}

function isGroupNotification(notification: NotificationRow | null | undefined) {
    return (
        hasGroupIdPrefix(String(notification?.senderUserId || '')) ||
        notification?.type?.startsWith('group.') ||
        notification?.type === 'groupChange'
    );
}

function isFriendNotification(
    notification: NotificationRow | null | undefined
) {
    return [
        'invite',
        'requestInvite',
        'inviteResponse',
        'requestInviteResponse',
        'friendRequest',
        'ignoredFriendRequest',
        'boop'
    ].includes(String(notification?.type || ''));
}

function computeRemaining(expiresAt: unknown) {
    if (!expiresAt) {
        return null;
    }
    const ts = Date.parse(String(expiresAt));
    if (!Number.isFinite(ts)) {
        return null;
    }
    return Math.max(0, ts - Date.now());
}

function formatCountdown(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function useExpiryCountdown(expiresAt: unknown, enabled: boolean) {
    const [remainingMs, setRemainingMs] = useState<number | null>(() =>
        enabled ? computeRemaining(expiresAt) : null
    );
    useEffect(() => {
        if (!enabled || !expiresAt) {
            setRemainingMs(null);
            return;
        }
        setRemainingMs(computeRemaining(expiresAt));
        const id = window.setInterval(() => {
            setRemainingMs(computeRemaining(expiresAt));
        }, 1000);
        return () => window.clearInterval(id);
    }, [enabled, expiresAt]);
    return remainingMs;
}

function NotificationPersonAvatar({
    notification
}: {
    notification: NotificationRow;
}) {
    const imageUrl = getNotificationImageUrl(notification);
    return (
        <Avatar className="size-9 shrink-0">
            {imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
            <AvatarFallback>
                <UserIcon className="size-4" />
            </AvatarFallback>
        </Avatar>
    );
}

function NotificationIconDisc({
    notification
}: {
    notification: NotificationRow;
}) {
    const Icon = getDiscIcon(notification);
    const imageUrl = getNotificationImageUrl(notification);
    if (imageUrl) {
        return (
            <Avatar className="size-9 shrink-0 rounded-md">
                <AvatarImage src={imageUrl} alt="" className="rounded-md" />
                <AvatarFallback className="rounded-md">
                    <Icon className="size-4" />
                </AvatarFallback>
            </Avatar>
        );
    }
    return (
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" />
        </div>
    );
}

function NotificationLocationLine({
    notification
}: {
    notification: NotificationRow;
}) {
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

    if (notification?.link) {
        return (
            <Button
                type="button"
                variant="link"
                size="sm"
                className="hover:text-primary h-auto max-w-full justify-start p-0 text-left text-xs font-normal"
                onClick={() => openNotificationLink(notification.link)}
            >
                <LinkIcon data-icon="inline-start" />
                <span className="truncate">
                    {notification.linkText || notification.link}
                </span>
            </Button>
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
}: {
    absoluteTime: string;
    message: string;
    notification: NotificationRow;
    senderName: string;
    typeLabel: string;
}) {
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
                        <NotificationIconDisc notification={notification} />
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
                        <NotificationPersonAvatar notification={notification} />
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
                        <NotificationIconDisc notification={notification} />
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

function NotificationActionButton({
    label,
    onClick,
    children
}: {
    children: ReactNode;
    label: string;
    onClick: () => void;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={label}
                        onClick={onClick}
                    >
                        {children}
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function buildOrderedActions({
    notification,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    t
}: {
    canInviteFromCurrentLocation: boolean;
    currentUserId?: string;
    handlers: NotificationDrawerHandlers;
    notification: NotificationRow;
    t: TFunction;
}): NotificationDrawerAction[] {
    const remoteActionsVisible =
        notification?.senderUserId !== currentUserId &&
        !isNotificationExpired(notification);
    if (!remoteActionsVisible) {
        return [];
    }
    const type = notification?.type;
    const responses = Array.isArray(notification?.responses)
        ? notification.responses
        : [];
    const actions: NotificationDrawerAction[] = [];
    if (type === 'friendRequest') {
        actions.push({
            key: 'accept',
            label: t('view.notification.actions.accept'),
            Icon: CheckIcon,
            onClick: () => handlers.onAcceptFriendRequest(notification)
        });
    }
    if (type === 'requestInvite' && canInviteFromCurrentLocation) {
        actions.push({
            key: 'invite',
            label: t('view.notification.actions.invite'),
            Icon: SendIcon,
            onClick: () => handlers.onAcceptRequestInvite(notification)
        });
    }
    if (type === 'invite') {
        actions.push({
            key: 'decline-with-message',
            label: t('view.notification.actions.decline_with_message'),
            Icon: MessageCircleIcon,
            onClick: () =>
                handlers.onSendInviteResponseWithMessage(
                    notification,
                    'response'
                )
        });
    }
    if (type === 'requestInvite') {
        actions.push({
            key: 'decline-with-message-request',
            label: t('view.notification.actions.decline_with_message'),
            Icon: MessageCircleIcon,
            onClick: () =>
                handlers.onSendInviteResponseWithMessage(
                    notification,
                    'requestResponse'
                )
        });
    }
    for (const response of responses) {
        actions.push({
            key: `response:${response?.type}:${response?.text || response?.data || ''}`,
            label: getResponseLabel(response),
            Icon: getResponseIcon(response, type),
            onClick: () =>
                handlers.onSendNotificationResponse(notification, response)
        });
    }
    if (canDeclineNotification(notification)) {
        actions.push({
            key: 'decline',
            label: t('view.notification.actions.decline'),
            Icon: XIcon,
            onClick: () => handlers.onHideNotification(notification)
        });
    }
    return actions;
}

export function NotificationDrawerRow({
    notification,
    isUnseen,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers
}: {
    canInviteFromCurrentLocation: boolean;
    currentUserId?: string;
    handlers: NotificationDrawerHandlers;
    isUnseen: boolean;
    notification: NotificationRow;
}) {
    const { t } = useTranslation();
    const message = String(getNotificationMessage(notification) || '');
    const senderName =
        String(getSenderName(notification) || '') ||
        notification?.type ||
        t('nav_tooltip.notification');
    const typeLabel = getNotificationTypeLabel(notification, t);
    const relativeTime = getNotificationRelativeTime(notification);
    const absoluteTime =
        getNotificationAbsoluteTime(notification) ||
        formatNotificationTime(notification);
    const expired = Boolean(isNotificationExpired(notification));
    const isAction =
        getNotificationLifecycleBucket(notification?.type) === 'action';
    const isQueueReady = notification?.type === 'group.queueReady';
    const showAvatar = usesAvatar(notification);

    const orderedActions = buildOrderedActions({
        notification,
        currentUserId,
        canInviteFromCurrentLocation,
        handlers,
        t
    });
    const inlineActions = orderedActions.slice(0, 2);
    const overflowActions = orderedActions.slice(2);
    const showMarkRead = isUnseen && canMarkNotificationSeen(notification);
    const showDelete = Boolean(shouldShowDeleteLog(notification));
    const hasMenu = showMarkRead || overflowActions.length > 0 || showDelete;

    const countdownMs = useExpiryCountdown(
        notification?.expiresAt,
        isQueueReady
    );
    const countdownLabel =
        isQueueReady && countdownMs != null ? formatCountdown(countdownMs) : '';

    const rowStyle =
        isUnseen && !expired
            ? { backgroundColor: STATUS_JOINME_UNSEEN }
            : undefined;

    return (
        <HoverCard>
            <HoverCardTrigger
                delay={400}
                closeDelay={100}
                render={
                    <div
                        className="bg-card text-card-foreground mb-1.5 flex gap-3 rounded-md border p-2"
                        style={rowStyle}
                    >
                        <button
                            type="button"
                            className="shrink-0"
                            aria-label={senderName}
                            onClick={() => openSender(notification, t)}
                        >
                            {showAvatar ? (
                                <NotificationPersonAvatar
                                    notification={notification}
                                />
                            ) : (
                                <NotificationIconDisc
                                    notification={notification}
                                />
                            )}
                        </button>
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <button
                                    type="button"
                                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                                    onClick={() => openSender(notification, t)}
                                >
                                    {senderName}
                                </button>
                                {relativeTime ? (
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                                                    {relativeTime}
                                                </span>
                                            }
                                        />
                                        <TooltipContent>
                                            {absoluteTime}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : null}
                            </div>
                            {message ? (
                                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs break-words">
                                    {message}
                                </p>
                            ) : null}
                            <div className="mt-1.5 flex items-center gap-2">
                                <Badge
                                    className={cn(
                                        'border-0',
                                        !isAction &&
                                            'bg-muted text-muted-foreground'
                                    )}
                                    style={
                                        isAction
                                            ? {
                                                  backgroundColor:
                                                      STATUS_JOINME_TINT
                                              }
                                            : undefined
                                    }
                                >
                                    {typeLabel}
                                </Badge>
                                <div className="min-w-0 flex-1 truncate text-xs">
                                    <NotificationLocationLine
                                        notification={notification}
                                    />
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    {isQueueReady ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 gap-1 px-2 text-xs font-medium text-[var(--status-askme)] hover:text-[var(--status-askme)]"
                                            style={{
                                                backgroundColor:
                                                    STATUS_ASKME_TINT
                                            }}
                                            onClick={() =>
                                                handlers.onJoinQueueReady(
                                                    notification
                                                )
                                            }
                                        >
                                            {t(
                                                'side_panel.notification_center.join_now'
                                            )}
                                            {countdownLabel ? (
                                                <span className="tabular-nums">
                                                    {countdownLabel}
                                                </span>
                                            ) : null}
                                        </Button>
                                    ) : null}
                                    {inlineActions.map((action) => (
                                        <NotificationActionButton
                                            key={action.key}
                                            label={action.label}
                                            onClick={action.onClick}
                                        >
                                            <action.Icon data-icon="icon" />
                                        </NotificationActionButton>
                                    ))}
                                    {hasMenu ? (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                render={
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        aria-label={t(
                                                            'side_panel.notification_center.more_actions'
                                                        )}
                                                    >
                                                        <MoreHorizontalIcon data-icon="icon" />
                                                    </Button>
                                                }
                                            />
                                            <DropdownMenuContent align="end">
                                                {showMarkRead ? (
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            handlers.onMarkSeen(
                                                                notification
                                                            )
                                                        }
                                                    >
                                                        <CheckIcon data-icon="inline-start" />
                                                        {t(
                                                            'side_panel.notification_center.mark_as_read'
                                                        )}
                                                    </DropdownMenuItem>
                                                ) : null}
                                                {overflowActions.map(
                                                    (action) => (
                                                        <DropdownMenuItem
                                                            key={action.key}
                                                            onClick={
                                                                action.onClick
                                                            }
                                                        >
                                                            <action.Icon data-icon="inline-start" />
                                                            {action.label}
                                                        </DropdownMenuItem>
                                                    )
                                                )}
                                                {showDelete ? (
                                                    <>
                                                        {showMarkRead ||
                                                        overflowActions.length >
                                                            0 ? (
                                                            <DropdownMenuSeparator />
                                                        ) : null}
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            onClick={() =>
                                                                handlers.onDeleteNotification(
                                                                    notification
                                                                )
                                                            }
                                                        >
                                                            <Trash2Icon data-icon="inline-start" />
                                                            {t(
                                                                'view.notification.actions.delete_log'
                                                            )}
                                                        </DropdownMenuItem>
                                                    </>
                                                ) : null}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                }
            />
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
