import type { ColumnDef } from '@tanstack/react-table';
import { CheckIcon, SendIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    canDeclineNotification,
    getNotificationCreatedAt,
    getNotificationGroupColumnLabel,
    getNotificationMessage,
    getNotificationSenderLabel,
    getResponseLabel
} from '../notificationRows';
import {
    NotificationLocationLink,
    SortButton,
    getNotificationLinkIcon,
    getResponseIcon,
    notificationLinkIsInternal
} from './NotificationViewParts';

export function useNotificationColumns({
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
}: any) {
    const { t } = useTranslation();

    return useMemo<ColumnDef<unknown>[]>(
        () => [
            {
                id: 'created_at',
                accessorFn: (row: any) =>
                    new Date(getNotificationCreatedAt(row) || 0).valueOf() || 0,
                meta: { label: t('table.notification.date') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.notification.date')}
                    />
                ),
                cell: ({ row }: any) => {
                    const createdAt = getNotificationCreatedAt(row.original);
                    const shortText = formatDateFilter(createdAt, 'short');
                    const longText = formatDateFilter(createdAt, 'long');
                    return (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-muted-foreground min-w-32 text-sm">
                                    {shortText}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>{longText}</TooltipContent>
                        </Tooltip>
                    );
                }
            },
            {
                id: 'type',
                accessorFn: (row: any) => String(row?.type || ''),
                meta: { label: t('table.notification.type') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.notification.type')}
                    />
                ),
                cell: ({ row }: any) => {
                    const notification = row.original;
                    const label = notificationTypeLabel(notification.type);
                    const badge = (
                        <Badge
                            variant={
                                notification.expired ? 'secondary' : 'outline'
                            }
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
                accessorFn: (row: any) => getNotificationSenderLabel(row),
                meta: { label: t('table.notification.user') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.notification.user')}
                    />
                ),
                cell: ({ row }: any) => {
                    const notification = row.original;
                    const senderLabel =
                        getNotificationSenderLabel(notification);
                    if (
                        notification.senderUserId &&
                        !notification.senderUserId.startsWith('grp_')
                    ) {
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="hover:text-primary h-auto max-w-48 justify-start p-0 text-left font-normal"
                                onClick={() =>
                                    onOpenUser({
                                        userId: notification.senderUserId,
                                        title: senderLabel || undefined
                                    })
                                }
                            >
                                <span className="truncate">
                                    {senderLabel || 'User'}
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
                                className="hover:text-primary h-auto max-w-48 justify-start p-0 text-left font-normal"
                                onClick={() =>
                                    onOpenUser({
                                        userId,
                                        title:
                                            notification.linkText ||
                                            senderLabel ||
                                            undefined
                                    })
                                }
                            >
                                <span className="truncate">
                                    {notification.linkText ||
                                        senderLabel ||
                                        'User'}
                                </span>
                            </Button>
                        );
                    }
                    if (
                        senderLabel &&
                        !notification.senderUserId?.startsWith('grp_')
                    ) {
                        return (
                            <div className="max-w-48 truncate text-sm">
                                {senderLabel}
                            </div>
                        );
                    }
                    return null;
                }
            },
            {
                id: 'groupName',
                accessorFn: (row: any) => getNotificationGroupColumnLabel(row),
                meta: { label: t('table.notification.group') },
                header: t('table.notification.group'),
                cell: ({ row }: any) => {
                    const notification = row.original;
                    const label = getNotificationGroupColumnLabel(notification);
                    const groupId = notification.senderUserId?.startsWith(
                        'grp_'
                    )
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
                            className="hover:text-primary h-auto max-w-48 justify-start p-0 text-left font-normal"
                            onClick={() =>
                                onOpenGroup({ groupId, title: label })
                            }
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
                cell: ({ row }: any) => {
                    const imageUrl =
                        row.original.details?.imageUrl ||
                        row.original.imageUrl ||
                        '';
                    if (!imageUrl || imageUrl.startsWith('default_')) {
                        return null;
                    }
                    const previewLabel =
                        getNotificationMessage(row.original) ||
                        t('table.notification.photo');
                    return (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto p-1"
                                    aria-label={previewLabel}
                                    onClick={() =>
                                        onOpenNotificationImagePreview(
                                            row.original
                                        )
                                    }
                                >
                                    <img
                                        src={convertFileUrlToImageUrl(
                                            imageUrl,
                                            64
                                        )}
                                        alt={previewLabel}
                                        width={40}
                                        height={40}
                                        className="size-10 rounded-md object-cover"
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{previewLabel}</TooltipContent>
                        </Tooltip>
                    );
                }
            },
            {
                id: 'message',
                accessorFn: (row: any) => getNotificationMessage(row),
                enableSorting: false,
                meta: { label: t('table.notification.message') },
                header: t('table.notification.message'),
                cell: ({ row }: any) => {
                    const notification = row.original;
                    const message = getNotificationMessage(notification);
                    const worldId =
                        notification.details?.worldId ||
                        notification.data?.worldId ||
                        notification.location ||
                        '';
                    const notificationLink = notification.link || '';
                    const internalLink =
                        notificationLinkIsInternal(notificationLink);
                    const LinkIcon = getNotificationLinkIcon(notificationLink);
                    return (
                        <div className="flex min-w-0 flex-col gap-1">
                            {message ? (
                                <div className="max-w-xl truncate text-sm">
                                    {message}
                                </div>
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
                                        {notification.linkText ||
                                            notificationLink}
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
                cell: ({ row }: any) => {
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
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.actions.accept'
                                            )}
                                            onClick={() => {
                                                onAcceptFriendRequest(
                                                    notification
                                                );
                                            }}
                                        >
                                            <CheckIcon data-icon="inline-start" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t('view.notification.actions.accept')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'requestInvite' &&
                            canInviteFromCurrentLocation ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.actions.invite'
                                            )}
                                            onClick={() => {
                                                onAcceptRequestInvite(
                                                    notification
                                                );
                                            }}
                                        >
                                            <SendIcon data-icon="inline-start" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t('view.notification.actions.invite')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'invite' ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.actions.decline_with_message'
                                            )}
                                            onClick={() => {
                                                onSendInviteResponseWithMessage(
                                                    notification,
                                                    'response'
                                                );
                                            }}
                                        >
                                            <SendIcon data-icon="inline-start" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t(
                                            'view.notification.actions.decline_with_message'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'requestInvite' ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.actions.decline_with_message'
                                            )}
                                            onClick={() => {
                                                onSendInviteResponseWithMessage(
                                                    notification,
                                                    'requestResponse'
                                                );
                                            }}
                                        >
                                            <SendIcon data-icon="inline-start" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t(
                                            'view.notification.actions.decline_with_message'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {remoteActionsVisible
                                ? responses.map((response: any) => {
                                      const label = getResponseLabel(response);
                                      const ResponseIcon = getResponseIcon(
                                          response,
                                          notification.type
                                      );
                                      return (
                                          <Tooltip
                                              key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                          >
                                              <TooltipTrigger asChild>
                                                  <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="icon-xs"
                                                      aria-label={label}
                                                      onClick={() => {
                                                          onSendNotificationResponse(
                                                              notification,
                                                              response
                                                          );
                                                      }}
                                                  >
                                                      <ResponseIcon data-icon="inline-start" />
                                                  </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                  {label}
                                              </TooltipContent>
                                          </Tooltip>
                                      );
                                  })
                                : null}
                            {remoteActionsVisible &&
                            canDeclineNotification(notification) ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.actions.decline'
                                            )}
                                            onClick={(event: any) => {
                                                onHideNotification(
                                                    notification,
                                                    {
                                                        skipConfirm:
                                                            shiftHeld ||
                                                            event.shiftKey
                                                    }
                                                );
                                            }}
                                        >
                                            <XIcon
                                                data-icon="inline-start"
                                                className={cn(
                                                    shiftHeld &&
                                                        'text-destructive'
                                                )}
                                            />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t('view.notification.actions.decline')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {notification.version === 2 &&
                            !notification.seen ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.action.mark_seen'
                                            )}
                                            onClick={() => {
                                                onMarkSeen(notification);
                                            }}
                                        >
                                            <CheckIcon data-icon="inline-start" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t(
                                            'view.notification.action.mark_seen'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {localDeleteVisible ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t(
                                                'view.notification.actions.delete_log'
                                            )}
                                            onClick={(event: any) => {
                                                onDeleteNotification(
                                                    notification,
                                                    {
                                                        skipConfirm:
                                                            shiftHeld ||
                                                            event.shiftKey
                                                    }
                                                );
                                            }}
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
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t(
                                            'view.notification.actions.delete_log'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
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
        ],
        [
            canInviteFromCurrentLocation,
            currentUserId,
            isTypeClickable,
            notificationTypeLabel,
            onAcceptFriendRequest,
            onAcceptRequestInvite,
            onDeleteNotification,
            onHideNotification,
            onMarkSeen,
            onOpenGroup,
            onOpenNotificationImagePreview,
            onOpenNotificationLink,
            onOpenTypeTarget,
            onOpenUser,
            onSendInviteResponseWithMessage,
            onSendNotificationResponse,
            shiftHeld,
            t
        ]
    );
}
