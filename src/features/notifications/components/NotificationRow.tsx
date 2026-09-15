import { CheckCheckIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatClock, formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type { NotificationRow as NotificationRecord } from '@/repositories/notificationPersistenceRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { getDismissResponse } from '@/shared/utils/notificationResponse';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { openSender, shouldShowDeleteLog } from '../notificationCenterUtils';
import {
    buildOrderedActions,
    getNotificationLinkIcon,
    type NotificationRowActionHandlers
} from '../notificationRowActions';
import {
    NOTIFICATION_TYPE_LABEL_PREFIX,
    toNotificationViewModel
} from '../notificationViewModel';
import { useNotificationActorImage } from '../useNotificationActorImage';
import {
    NOTIFICATION_ROW_HOVER_REVEAL,
    NotificationEmojiPreview,
    NotificationIconDisc,
    NotificationPersonAvatar
} from './NotificationRowParts';

export type NotificationFeedHandlers = NotificationRowActionHandlers & {
    onDeleteNotification(
        notification: NotificationRecord,
        options?: { skipConfirm?: boolean }
    ): void | Promise<void>;
    onOpenImagePreview(notification: NotificationRecord): void;
    onOpenLink(link: unknown): void;
};

export function NotificationRow({
    notification,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers
}: {
    canInviteFromCurrentLocation: boolean;
    currentUserId?: string;
    handlers: NotificationFeedHandlers;
    notification: NotificationRecord;
}) {
    const { t } = useTranslation();
    const [mediaFailed, setMediaFailed] = useState(false);
    const unknownLabel = t('view.notification.feed.unknown');
    const view = useMemo(
        () => toNotificationViewModel(notification, { unknownLabel }),
        [notification, unknownLabel]
    );
    const typeLabel = t(view.typeLabelKey, {
        defaultValue: view.typeLabelKey.slice(
            NOTIFICATION_TYPE_LABEL_PREFIX.length
        )
    });
    const actorName =
        view.actor.kind === 'system'
            ? view.actor.name
            : view.actor.name || t('view.notification.feed.unknown_sender');
    const actorImageUrl = useNotificationActorImage(view.actor);
    const clockLabel = formatClock(view.createdAt);
    const absoluteLabel = formatDateFilter(view.createdAt, 'long');
    const LinkIcon = getNotificationLinkIcon(view.link?.href);

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
        view.unseen &&
        notification.type !== 'friendRequest' &&
        !getDismissResponse(notification.responses);
    const showDelete = Boolean(shouldShowDeleteLog(notification));
    const hasMenu =
        showMenuMarkRead || overflowActions.length > 0 || showDelete;

    const actorButton = (
        <button
            type="button"
            className="shrink-0 transition-transform ease-out active:scale-[0.97] motion-safe:duration-150"
            aria-label={actorName || typeLabel}
            onClick={() => openSender(notification, t)}
        >
            {view.actor.kind === 'user' ? (
                <NotificationPersonAvatar
                    notification={notification}
                    imageUrl={actorImageUrl}
                    className="size-9"
                />
            ) : (
                <NotificationIconDisc
                    notification={notification}
                    imageUrl={actorImageUrl}
                    className="size-9"
                />
            )}
        </button>
    );
    const locationLine = view.context ? (
        <span className="text-muted-foreground/80 min-w-0 truncate text-xs">
            <Location
                location={view.context.location}
                hint={view.context.worldName}
                grouphint={view.context.groupName}
                asButton={false}
            />
        </span>
    ) : null;
    const linkButton = view.link?.text ? (
        <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto max-w-56 justify-start p-0 text-xs font-normal no-underline transition-opacity duration-150 ease-out hover:no-underline hover:opacity-70"
            onClick={() => handlers.onOpenLink(view.link?.href)}
        >
            <LinkIcon data-icon="inline-start" />
            <span className="truncate">{view.link.text}</span>
        </Button>
    ) : null;
    const hasHeadline = Boolean(view.headline);
    const body =
        view.body === typeLabel || view.body === view.headline ? '' : view.body;

    return (
        <div className="group hover:bg-muted/40 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 ease-out">
            <span className="mt-1.5 flex w-2 shrink-0 justify-center">
                {view.unseen ? (
                    <span className="bg-primary size-2 rounded-full">
                        <span className="sr-only">
                            {t('view.notification.feed.unread')}
                        </span>
                    </span>
                ) : null}
            </span>
            {actorButton}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                    {actorName ? (
                        <button
                            type="button"
                            className={cn(
                                'max-w-56 truncate text-left font-medium transition-opacity duration-150 ease-out hover:opacity-70',
                                hasHeadline
                                    ? 'text-muted-foreground text-xs'
                                    : 'text-sm'
                            )}
                            onClick={() => openSender(notification, t)}
                        >
                            {actorName}
                        </button>
                    ) : null}
                    <span
                        className={cn(
                            'min-w-0 truncate',
                            actorName
                                ? 'text-muted-foreground/60 shrink-0 text-xs'
                                : 'text-sm font-medium'
                        )}
                    >
                        {typeLabel}
                    </span>
                </div>
                {hasHeadline ? (
                    <p className="text-foreground line-clamp-2 text-sm font-medium">
                        {view.headline}
                    </p>
                ) : null}
                {body || view.emoji ? (
                    <div className="flex min-w-0 items-center gap-2">
                        {body ? (
                            <p
                                className={cn(
                                    'line-clamp-2 min-w-0 text-xs leading-snug break-words',
                                    hasHeadline
                                        ? 'text-muted-foreground'
                                        : 'text-foreground/85'
                                )}
                            >
                                {body}
                            </p>
                        ) : null}
                        {view.emoji ? (
                            <NotificationEmojiPreview
                                emoji={view.emoji}
                                className="size-7"
                                onClick={
                                    view.emoji.kind === 'custom'
                                        ? () =>
                                              handlers.onOpenImagePreview(
                                                  notification
                                              )
                                        : undefined
                                }
                            />
                        ) : null}
                    </div>
                ) : null}
                <div className="mt-0.5 flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-x-3">
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span className="text-muted-foreground/60 shrink-0 text-xs tabular-nums">
                                        {clockLabel}
                                    </span>
                                }
                            />
                            <TooltipContent>{absoluteLabel}</TooltipContent>
                        </Tooltip>
                        {view.expired ? (
                            <span className="border-border/60 text-muted-foreground/70 shrink-0 rounded-full border px-1.5 py-px text-[11px] leading-4">
                                {t('view.notification.feed.expired')}
                            </span>
                        ) : null}
                        {locationLine}
                        {linkButton}
                    </div>
                    {inlineActions.length > 0 ? (
                        <div
                            className={cn(
                                'flex shrink-0 items-center gap-1.5',
                                NOTIFICATION_ROW_HOVER_REVEAL
                            )}
                        >
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
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                <span
                    className={cn(
                        'flex size-6 shrink-0 items-center justify-center',
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
                                            <CheckCheckIcon data-icon="inline-start" />
                                            {t(
                                                'view.notification.action.mark_seen'
                                            )}
                                        </DropdownMenuItem>
                                    ) : null}
                                    {overflowActions.map((action) => (
                                        <DropdownMenuItem
                                            key={action.key}
                                            onClick={action.onClick}
                                        >
                                            <action.Icon data-icon="inline-start" />
                                            {action.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                                {showDelete ? (
                                    <>
                                        {showMenuMarkRead ||
                                        overflowActions.length > 0 ? (
                                            <DropdownMenuSeparator />
                                        ) : null}
                                        <DropdownMenuGroup>
                                            <DropdownMenuItem
                                                variant="destructive"
                                                onClick={(event) =>
                                                    handlers.onDeleteNotification(
                                                        notification,
                                                        {
                                                            skipConfirm:
                                                                event.shiftKey
                                                        }
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
                </span>
                {view.media && !mediaFailed ? (
                    <button
                        type="button"
                        className="shrink-0 transition-transform ease-out active:scale-[0.97] motion-safe:duration-150"
                        aria-label={view.headline || typeLabel}
                        onClick={() =>
                            handlers.onOpenImagePreview(notification)
                        }
                    >
                        <FadeInImage
                            src={convertFileUrlToImageUrl(view.media, 64)}
                            alt=""
                            width={40}
                            height={40}
                            className="size-10 rounded-md object-cover"
                            onError={() => setMediaFailed(true)}
                        />
                    </button>
                ) : null}
            </div>
        </div>
    );
}
