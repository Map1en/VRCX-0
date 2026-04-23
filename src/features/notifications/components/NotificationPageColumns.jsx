import { CheckIcon, SendIcon, Trash2Icon, XIcon } from 'lucide-react';

import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { formatDateFilter } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    canDeclineNotification,
    getNotificationCreatedAt,
    getNotificationGroupColumnLabel,
    getNotificationMessage,
    getResponseLabel
} from '../notificationRows.js';
import {
    NotificationLocationLink,
    SortButton,
    getNotificationLinkIcon,
    getResponseIcon,
    notificationLinkIsInternal
} from './NotificationViewParts.jsx';

export function buildNotificationColumns({
    t,
    currentUserId,
    canInviteFromCurrentLocation,
    notificationTypeLabel,
    shiftHeld,
    onOpenTypeTarget,
    isTypeClickable,
    onOpenUser,
    onOpenGroup,
    onOpenNotificationLink,
    onOpenNotificationImagePreview,
    onAcceptFriendRequest,
    onAcceptRequestInvite,
    onSendInviteResponseWithMessage,
    onSendNotificationResponse,
    onHideNotification,
    onMarkSeen,
    onDeleteNotification
}) {
    return [
        {
            id: 'created_at',
            accessorFn: (row) =>
                new Date(getNotificationCreatedAt(row) || 0).valueOf() || 0,
            meta: { label: t('table.notification.date') },
            header: ({ column }) => (
                <SortButton column={column} label={t('table.notification.date')} />
            ),
            cell: ({ row }) => {
                const createdAt = getNotificationCreatedAt(row.original);
                const shortText = formatDateFilter(createdAt, 'short');
                const longText = formatDateFilter(createdAt, 'long');
                return (
                    <div
                        className="text-muted-foreground min-w-32 text-sm"
                        title={longText}
                    >
                        {shortText}
                    </div>
                );
            }
        },
        {
            id: 'type',
            accessorFn: (row) => String(row?.type || ''),
            meta: { label: t('table.notification.type') },
            header: ({ column }) => (
                <SortButton column={column} label={t('table.notification.type')} />
            ),
            cell: ({ row }) => {
                const notification = row.original;
                const label = notificationTypeLabel(notification.type);
                const badge = (
                    <Badge
                        variant={notification.expired ? 'secondary' : 'outline'}
                    >
                        {label}
                    </Badge>
                );
                return isTypeClickable(notification) ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => onOpenTypeTarget(notification)}
                    >
                        {badge}
                    </Button>
                ) : (
                    badge
                );
            }
        },
        {
            id: 'senderUsername',
            accessorFn: (row) =>
                String(row?.senderUsername || row?.senderUserId || ''),
            meta: { label: t('table.notification.user') },
            header: ({ column }) => (
                <SortButton column={column} label={t('table.notification.user')} />
            ),
            cell: ({ row }) => {
                const notification = row.original;
                if (
                    notification.senderUserId &&
                    !notification.senderUserId.startsWith('grp_')
                ) {
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto max-w-48 justify-start p-0 text-left font-normal hover:text-primary"
                            onClick={() =>
                                onOpenUser({
                                    userId: notification.senderUserId,
                                    title: notification.senderUsername || undefined
                                })
                            }
                        >
                            <span className="truncate">
                                {notification.senderUsername || 'User'}
                            </span>
                        </Button>
                    );
                }
                if (notification.link?.startsWith('user:')) {
                    const userId = notification.link.slice('user:'.length);
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto max-w-48 justify-start p-0 text-left font-normal hover:text-primary"
                            onClick={() =>
                                onOpenUser({
                                    userId,
                                    title:
                                        notification.linkText ||
                                        notification.senderUsername ||
                                        undefined
                                })
                            }
                        >
                            <span className="truncate">
                                {notification.linkText ||
                                    notification.senderUsername ||
                                    'User'}
                            </span>
                        </Button>
                    );
                }
                if (
                    notification.senderUsername &&
                    !notification.senderUserId?.startsWith('grp_')
                ) {
                    return (
                        <div className="max-w-48 truncate text-sm">
                            {notification.senderUsername}
                        </div>
                    );
                }
                return null;
            }
        },
        {
            id: 'groupName',
            accessorFn: (row) => getNotificationGroupColumnLabel(row),
            meta: { label: t('table.notification.group') },
            header: t('table.notification.group'),
            cell: ({ row }) => {
                const notification = row.original;
                const label = getNotificationGroupColumnLabel(notification);
                const groupId = notification.senderUserId?.startsWith('grp_')
                    ? notification.senderUserId
                    : notification.link?.startsWith('group:')
                      ? notification.link.slice('group:'.length)
                      : notification.link?.startsWith('event:')
                        ? notification.link.slice('event:').split(',')[0]
                        : '';
                if (!label) {
                    return null;
                }
                return groupId ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto max-w-48 justify-start p-0 text-left font-normal hover:text-primary"
                        onClick={() => onOpenGroup({ groupId, title: label })}
                    >
                        <span className="truncate">{label}</span>
                    </Button>
                ) : (
                    <div className="max-w-48 truncate text-sm">{label}</div>
                );
            }
        },
        {
            id: 'photo',
            enableSorting: false,
            meta: { label: t('table.notification.photo') },
            header: t('table.notification.photo'),
            cell: ({ row }) => {
                const imageUrl =
                    row.original.details?.imageUrl || row.original.imageUrl || '';
                if (!imageUrl || imageUrl.startsWith('default_')) {
                    return null;
                }
                const previewLabel =
                    getNotificationMessage(row.original) || t('table.notification.photo');
                return (
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto p-1"
                        aria-label={previewLabel}
                        title={previewLabel}
                        onClick={() => onOpenNotificationImagePreview(row.original)}
                    >
                        <img
                            src={convertFileUrlToImageUrl(imageUrl, 64)}
                            alt={previewLabel}
                            width={40}
                            height={40}
                            className="size-10 rounded-md object-cover"
                        />
                    </Button>
                );
            }
        },
        {
            id: 'message',
            accessorFn: (row) => getNotificationMessage(row),
            enableSorting: false,
            meta: { label: t('table.notification.message') },
            header: t('table.notification.message'),
            cell: ({ row }) => {
                const notification = row.original;
                const message = getNotificationMessage(notification);
                const worldId =
                    notification.details?.worldId ||
                    notification.data?.worldId ||
                    notification.location ||
                    '';
                const notificationLink = notification.link || '';
                const internalLink = notificationLinkIsInternal(notificationLink);
                const LinkIcon = getNotificationLinkIcon(notificationLink);
                return (
                    <div className="flex min-w-0 flex-col gap-1">
                        {message ? (
                            <div className="max-w-xl truncate text-sm">{message}</div>
                        ) : null}
                        {worldId ? (
                            <NotificationLocationLink
                                location={worldId}
                                worldName={
                                    notification.details?.worldName ||
                                    notification.worldName ||
                                    ''
                                }
                                groupName={
                                    notification.details?.groupName ||
                                    notification.groupName ||
                                    notification.data?.groupName ||
                                    ''
                                }
                            />
                        ) : null}
                        {notificationLink ? (
                            <Button
                                type="button"
                                variant={internalLink ? 'ghost' : 'link'}
                                size="sm"
                                className={cn(
                                    'h-auto max-w-xl justify-start p-0 text-left font-normal',
                                    internalLink && 'hover:text-primary'
                                )}
                                onClick={() =>
                                    onOpenNotificationLink(notificationLink)
                                }
                            >
                                <LinkIcon data-icon="inline-start" />
                                <span className="truncate">
                                    {notification.linkText || notificationLink}
                                </span>
                            </Button>
                        ) : null}
                    </div>
                );
            }
        },
        {
            id: 'action',
            enableSorting: false,
            meta: { label: t('table.notification.action') },
            header: t('table.notification.action'),
            cell: ({ row }) => {
                const notification = row.original;
                const remoteActionsVisible =
                    notification.senderUserId !== currentUserId &&
                    !notification.expired;
                const responses = Array.isArray(notification.responses)
                    ? notification.responses
                    : [];
                const localDeleteVisible =
                    notification.type !== 'friendRequest' &&
                    notification.type !== 'ignoredFriendRequest';
                return (
                    <div className="flex flex-wrap items-center justify-end gap-2">
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
                                <SendIcon data-icon="inline-start" />
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
                                <SendIcon data-icon="inline-start" />
                            </Button>
                        ) : null}
                        {remoteActionsVisible
                            ? responses.map((response) => {
                                  const label = getResponseLabel(response);
                                  const ResponseIcon = getResponseIcon(
                                      response,
                                      notification.type
                                  );
                                  return (
                                      <Button
                                          key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          aria-label={label}
                                          title={label}
                                          onClick={() =>
                                              void onSendNotificationResponse(
                                                  notification,
                                                  response
                                              )
                                          }
                                      >
                                          <ResponseIcon data-icon="inline-start" />
                                      </Button>
                                  );
                              })
                            : null}
                        {remoteActionsVisible &&
                        canDeclineNotification(notification) ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t('view.notification.actions.decline')}
                                title={t('view.notification.actions.decline')}
                                onClick={(event) =>
                                    void onHideNotification(notification, {
                                        skipConfirm: shiftHeld || event.shiftKey
                                    })
                                }
                            >
                                <XIcon
                                    data-icon="inline-start"
                                    className={cn(
                                        shiftHeld && 'text-destructive'
                                    )}
                                />
                            </Button>
                        ) : null}
                        {notification.version === 2 && !notification.seen ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t('view.notification.generated.mark_seen')}
                                title={t('view.notification.generated.mark_seen')}
                                onClick={() => void onMarkSeen(notification)}
                            >
                                <CheckIcon data-icon="inline-start" />
                            </Button>
                        ) : null}
                        {localDeleteVisible ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t('view.notification.actions.delete_log')}
                                title={t('view.notification.actions.delete_log')}
                                onClick={(event) =>
                                    void onDeleteNotification(notification, {
                                        skipConfirm: shiftHeld || event.shiftKey
                                    })
                                }
                            >
                                {shiftHeld ? (
                                    <XIcon
                                        data-icon="inline-start"
                                        className="text-destructive"
                                    />
                                ) : (
                                    <Trash2Icon data-icon="inline-start" />
                                )}
                            </Button>
                        ) : null}
                    </div>
                );
            }
        },
        {
            id: 'trailing',
            enableSorting: false,
            enableResizing: false,
            header: () => null,
            cell: () => null,
            size: 5
        }
    ];
}
