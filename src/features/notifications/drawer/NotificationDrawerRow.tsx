import { CheckCheckIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { getDismissResponse } from '@/shared/utils/notificationResponse';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { HoverCard, HoverCardTrigger } from '@/ui/shadcn/hover-card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    NOTIFICATION_ROW_HOVER_REVEAL,
    NotificationEmojiPreview,
    NotificationIconDisc,
    NotificationPersonAvatar
} from '../components/NotificationRowParts';
import {
    formatNotificationTime,
    getNotificationMessage,
    getSenderName,
    isNotificationExpired,
    openSender,
    shouldShowDeleteLog
} from '../notificationCenterUtils';
import { buildOrderedActions, usesAvatar } from '../notificationRowActions';
import {
    type NotificationActor,
    toNotificationViewModel
} from '../notificationViewModel';
import { useNotificationActorImage } from '../useNotificationActorImage';
import { getNotificationLifecycleBucket } from './notificationDrawerBuckets';
import type { NotificationDrawerHandlers } from './NotificationDrawerList';
import {
    NotificationHoverContent,
    NotificationLocationLine
} from './NotificationDrawerRowParts';
import {
    computeRemaining,
    formatCountdown,
    getNotificationAbsoluteTime,
    getNotificationRelativeTime,
    getNotificationTypeLabel
} from './notificationDrawerRowUtils';

const STATUS_JOINME_TINT =
    'color-mix(in srgb, var(--status-joinme) 14%, transparent)';
const STATUS_ASKME_TINT =
    'color-mix(in srgb, var(--status-askme) 14%, transparent)';

function useExpiryCountdown(
    expiresAt: string | null | undefined,
    enabled: boolean
) {
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
    const rawMessage = String(getNotificationMessage(notification) || '');
    const typeLabel = getNotificationTypeLabel(notification, t);
    const relativeTime = getNotificationRelativeTime(notification);
    const absoluteTime =
        getNotificationAbsoluteTime(notification) ||
        formatNotificationTime(notification);
    const expired = Boolean(isNotificationExpired(notification));
    const isAction =
        getNotificationLifecycleBucket(notification?.type) === 'action';
    const isBoop = notification?.type === 'boop';
    const isQueueReady = notification?.type === 'group.queueReady';
    const showAvatar = usesAvatar(notification);
    const view = useMemo(
        () => toNotificationViewModel(notification),
        [notification]
    );
    const isBroadcast = view.template === 'broadcast';
    const senderName = isBroadcast
        ? view.actor.name || t('view.notification.feed.unknown_sender')
        : String(getSenderName(notification) || '');
    const headline = isBroadcast
        ? view.headline || String(notification.title || '').trim()
        : '';
    const message = isBoop || isBroadcast ? view.body : rawMessage;
    const previewMessage =
        message === typeLabel || (isBroadcast && message === headline)
            ? ''
            : message;
    const actor: NotificationActor =
        showAvatar || view.actor.kind === 'group'
            ? view.actor
            : { kind: 'system', name: '' };
    const actorImageUrl = useNotificationActorImage(actor);

    const orderedActions = buildOrderedActions({
        notification,
        currentUserId,
        canInviteFromCurrentLocation,
        handlers,
        t
    });
    const inlineActionCount = notification.type === 'friendRequest' ? 3 : 2;
    const inlineActions = orderedActions.slice(0, inlineActionCount);
    const overflowActions = orderedActions.slice(inlineActionCount);
    const showMenuMarkRead =
        isUnseen &&
        notification.type !== 'friendRequest' &&
        !getDismissResponse(notification.responses);
    const showDelete = Boolean(shouldShowDeleteLog(notification));
    const hasMenu =
        showMenuMarkRead || overflowActions.length > 0 || showDelete;

    const countdownMs = useExpiryCountdown(
        notification?.expiresAt,
        isQueueReady
    );
    const countdownLabel =
        isQueueReady && countdownMs != null ? formatCountdown(countdownMs) : '';

    const showUnreadDot = isUnseen && !expired;
    const hasLocation = Boolean(
        (notification.type === 'invite' && notification.details?.worldId) ||
        ((isQueueReady || notification.type === 'instance.closed') &&
            notification.location)
    );

    return (
        <HoverCard>
            <HoverCardTrigger
                delay={400}
                closeDelay={100}
                render={
                    <div className="group hover:bg-accent/50 border-border/50 relative flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0">
                        <div className="flex shrink-0 items-start gap-1.5">
                            <span className="mt-1.5 flex w-2 shrink-0 justify-center">
                                {showUnreadDot ? (
                                    <span className="bg-primary size-2 rounded-full">
                                        <span className="sr-only">
                                            {t('view.notification.feed.unread')}
                                        </span>
                                    </span>
                                ) : null}
                            </span>
                            <button
                                type="button"
                                className="shrink-0"
                                aria-label={senderName || typeLabel}
                                onClick={() => openSender(notification, t)}
                            >
                                {showAvatar ? (
                                    <NotificationPersonAvatar
                                        notification={notification}
                                        imageUrl={actorImageUrl}
                                    />
                                ) : (
                                    <NotificationIconDisc
                                        notification={notification}
                                        imageUrl={actorImageUrl}
                                    />
                                )}
                            </button>
                        </div>
                        <div className="min-w-0 flex-1">
                            <div
                                className={cn(
                                    'relative flex min-w-0 items-start gap-2',
                                    hasMenu && 'pr-8'
                                )}
                            >
                                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                                    {senderName ? (
                                        <button
                                            type="button"
                                            className={cn(
                                                'max-w-full min-w-0 truncate text-left hover:underline',
                                                isBroadcast
                                                    ? 'text-muted-foreground text-xs'
                                                    : 'text-sm',
                                                !isBroadcast &&
                                                    showUnreadDot &&
                                                    'font-medium'
                                            )}
                                            onClick={() =>
                                                openSender(notification, t)
                                            }
                                        >
                                            {senderName}
                                        </button>
                                    ) : null}
                                    {isBroadcast ? (
                                        <span className="text-muted-foreground shrink-0 text-xs">
                                            · {typeLabel}
                                        </span>
                                    ) : (
                                        <Badge
                                            className={cn(
                                                'border-0',
                                                isBoop
                                                    ? 'bg-violet-500/15 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300'
                                                    : isAction
                                                      ? 'text-[var(--status-joinme)]'
                                                      : 'bg-muted text-muted-foreground'
                                            )}
                                            style={
                                                isAction && !isBoop
                                                    ? {
                                                          backgroundColor:
                                                              STATUS_JOINME_TINT
                                                      }
                                                    : undefined
                                            }
                                        >
                                            {typeLabel}
                                        </Badge>
                                    )}
                                </div>
                                <div
                                    className={cn(
                                        'absolute -top-1 right-0',
                                        NOTIFICATION_ROW_HOVER_REVEAL
                                    )}
                                >
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
                                            <DropdownMenuContent
                                                align="end"
                                                className="w-56"
                                            >
                                                <DropdownMenuGroup>
                                                    {showMenuMarkRead ? (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                handlers.onMarkSeen(
                                                                    notification
                                                                )
                                                            }
                                                        >
                                                            <CheckCheckIcon data-icon="inline-start" />
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
                                                </DropdownMenuGroup>
                                                {showDelete ? (
                                                    <>
                                                        {showMenuMarkRead ||
                                                        overflowActions.length >
                                                            0 ? (
                                                            <DropdownMenuSeparator />
                                                        ) : null}
                                                        <DropdownMenuGroup>
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
                                                        </DropdownMenuGroup>
                                                    </>
                                                ) : null}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : null}
                                </div>
                            </div>
                            {headline ? (
                                <p
                                    className={cn(
                                        'mt-1 line-clamp-2 text-sm text-pretty break-words',
                                        showUnreadDot && 'font-medium'
                                    )}
                                >
                                    {headline}
                                </p>
                            ) : null}
                            {previewMessage || view.emoji ? (
                                <div className="mt-0.5 flex min-w-0 items-center gap-2">
                                    {previewMessage ? (
                                        <p className="text-muted-foreground line-clamp-2 min-w-0 text-xs text-pretty break-words">
                                            {previewMessage}
                                        </p>
                                    ) : null}
                                    {view.emoji ? (
                                        <NotificationEmojiPreview
                                            emoji={view.emoji}
                                            className="size-7"
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                            {relativeTime ||
                            hasLocation ||
                            isQueueReady ||
                            inlineActions.length > 0 ? (
                                <div className="mt-2 flex items-center gap-2">
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
                                    <div className="min-w-0 flex-1 truncate text-xs">
                                        <NotificationLocationLine
                                            notification={notification}
                                        />
                                    </div>
                                    {isQueueReady ||
                                    inlineActions.length > 0 ? (
                                        <div
                                            className={cn(
                                                'flex shrink-0 items-center gap-1.5',
                                                NOTIFICATION_ROW_HOVER_REVEAL
                                            )}
                                        >
                                            {isQueueReady ? (
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    className="font-medium text-[var(--status-askme)] hover:text-[var(--status-askme)]"
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
                                                <Button
                                                    key={action.key}
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    onClick={action.onClick}
                                                >
                                                    {action.label}
                                                </Button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </div>
                }
            />
            <NotificationHoverContent
                notification={notification}
                senderName={senderName || typeLabel}
                typeLabel={typeLabel}
                message={message}
                absoluteTime={absoluteTime}
                actorImageUrl={actorImageUrl}
            />
        </HoverCard>
    );
}
