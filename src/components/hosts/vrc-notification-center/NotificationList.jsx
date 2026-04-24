import {
    CheckIcon,
    ExternalLinkIcon,
    MessageCircleIcon,
    SendIcon,
    Trash2Icon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';

import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';

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
} from './notificationCenterUtils.js';

function NotificationAvatar({ notification }) {
    const imageUrl = getNotificationImageUrl(notification);
    const isGroup =
        String(notification?.senderUserId || '').startsWith('grp_') ||
        notification?.type?.startsWith('group.');
    const Icon = isGroup ? UsersIcon : UserIcon;

    if (imageUrl) {
        return (
            <img
                src={imageUrl}
                alt=""
                className="size-9 shrink-0 rounded-md object-cover"
            />
        );
    }

    return (
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
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
    onMarkSeen,
    t
}) {
    const message = getNotificationMessage(notification);
    const senderName =
        getSenderName(notification) ||
        notification?.type ||
        t('nav_tooltip.notification');
    const timeLabel = formatNotificationTime(notification);
    const hasLink = Boolean(notification?.link);
    const responses = Array.isArray(notification?.responses)
        ? notification.responses
        : [];
    const remoteActionsVisible =
        notification?.senderUserId !== currentUserId &&
        !isNotificationExpired(notification);

    return (
        <div className="bg-card text-card-foreground mb-1.5 flex gap-2 rounded-md border p-2">
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 p-0"
                aria-label={senderName}
                title={senderName}
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
                        <span className="truncate">
                            {senderName}
                        </span>
                    </Button>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                        {notification?.type || 'unknown'}
                    </Badge>
                    {isUnseen ? (
                        <span className="bg-primary size-2 shrink-0 rounded-full" />
                    ) : null}
                </div>
                {message ? (
                    <div className="text-muted-foreground mt-1 truncate text-xs">
                        {message}
                    </div>
                ) : null}
                {notification?.details?.worldName ? (
                    <div className="text-muted-foreground truncate text-xs">
                        {notification.details.worldName}
                    </div>
                ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                {timeLabel ? (
                    <span className="text-muted-foreground text-xs">
                        {timeLabel}
                    </span>
                ) : null}
                <div className="flex items-center gap-1">
                    {remoteActionsVisible &&
                    notification.type === 'friendRequest' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('view.notification.actions.accept')}
                            title={t('view.notification.actions.accept')}
                            onClick={() =>
                                void onAcceptFriendRequest(notification)
                            }
                        >
                            <CheckIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible &&
                    notification.type === 'requestInvite' &&
                    canInviteFromCurrentLocation ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('view.notification.actions.invite')}
                            title={t('view.notification.actions.invite')}
                            onClick={() =>
                                void onAcceptRequestInvite(notification)
                            }
                        >
                            <SendIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible && notification.type === 'invite' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t(
                                'view.notification.actions.decline_with_message'
                            )}
                            title={t(
                                'view.notification.actions.decline_with_message'
                            )}
                            onClick={() =>
                                void onSendInviteResponseWithMessage(
                                    notification,
                                    'response'
                                )
                            }
                        >
                            <MessageCircleIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible &&
                    notification.type === 'requestInvite' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t(
                                'view.notification.actions.decline_with_message'
                            )}
                            title={t(
                                'view.notification.actions.decline_with_message'
                            )}
                            onClick={() =>
                                void onSendInviteResponseWithMessage(
                                    notification,
                                    'requestResponse'
                                )
                            }
                        >
                            <MessageCircleIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {remoteActionsVisible
                        ? responses.map((response) => (
                              <Button
                                  key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={getResponseLabel(response)}
                                  title={getResponseLabel(response)}
                                  onClick={() =>
                                      void onSendNotificationResponse(
                                          notification,
                                          response
                                      )
                                  }
                              >
                                  {response?.type === 'link' ? (
                                      <ExternalLinkIcon data-icon="inline-start" />
                                  ) : (
                                      <CheckIcon data-icon="inline-start" />
                                  )}
                              </Button>
                          ))
                        : null}
                    {remoteActionsVisible &&
                    canDeclineNotification(notification) ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('view.notification.actions.decline')}
                            title={t('view.notification.actions.decline')}
                            onClick={() => void onHideNotification(notification)}
                        >
                            <XIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {hasLink ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t(
                                'view.notification.generated.open_notification_link'
                            )}
                            title={t(
                                'view.notification.generated.open_notification_link'
                            )}
                            onClick={() =>
                                openNotificationLink(notification.link)
                            }
                        >
                            <ExternalLinkIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {isUnseen ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('view.notification.generated.mark_seen')}
                            title={t('view.notification.generated.mark_seen')}
                            onClick={() => {
                                void onMarkSeen(notification);
                            }}
                        >
                            <CheckIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    {shouldShowDeleteLog(notification) ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('view.notification.actions.delete_log')}
                            title={t('view.notification.actions.delete_log')}
                            onClick={() =>
                                void onDeleteNotification(notification)
                            }
                        >
                            <Trash2Icon data-icon="inline-start" />
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
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
    onNavigateToTable,
    t
}) {
    const rows = [
        ...unseen.map((notification) => ({
            key: `unseen:${notification.id}`,
            notification,
            isUnseen: true
        })),
        ...(recent.length ? [{ key: 'recent-header', section: true }] : []),
        ...recent.map((notification) => ({
            key: `recent:${notification.id}`,
            notification,
            isUnseen: false
        }))
    ];

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {rows.length ? (
                    rows.map((row) =>
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
                                t={t}
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
