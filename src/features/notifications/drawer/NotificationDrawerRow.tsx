import { CheckIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    formatNotificationTime,
    getNotificationMessage,
    getSenderName,
    isNotificationExpired,
    openSender,
    shouldShowDeleteLog
} from '@/components/hosts/vrc-notification-center/notificationCenterUtils';
import { cn } from '@/lib/utils';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
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
    NotificationActionButton,
    NotificationEmojiPreview,
    NotificationIconDisc,
    NotificationPersonAvatar
} from '../components/NotificationRowParts';
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
const STATUS_JOINME_UNSEEN =
    'color-mix(in srgb, var(--status-joinme) 8%, transparent)';
const STATUS_ASKME_TINT =
    'color-mix(in srgb, var(--status-askme) 14%, transparent)';

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
    const view = useMemo(
        () => toNotificationViewModel(notification),
        [notification]
    );
    const message = notification.type === 'boop' ? view.body : rawMessage;
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
    const showMenuMarkRead = isUnseen && notification.type !== 'friendRequest';
    const showDelete = Boolean(shouldShowDeleteLog(notification));
    const hasMenu =
        showMenuMarkRead || overflowActions.length > 0 || showDelete;

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
                                    imageUrl={actorImageUrl}
                                />
                            ) : (
                                <NotificationIconDisc
                                    notification={notification}
                                    imageUrl={actorImageUrl}
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
                            {message || view.emoji ? (
                                <div className="mt-0.5 flex min-w-0 items-center gap-2">
                                    {message ? (
                                        <p className="text-muted-foreground line-clamp-2 min-w-0 text-xs break-words">
                                            {message}
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
                                                <DropdownMenuGroup>
                                                    {showMenuMarkRead ? (
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
                actorImageUrl={actorImageUrl}
            />
        </HoverCard>
    );
}
