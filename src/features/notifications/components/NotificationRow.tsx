import { CheckCheckIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatClock, formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type { NotificationRow as NotificationRecord } from '@/repositories/notificationPersistenceRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
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
    PRIMARY_ACTION_KEYS,
    type NotificationRowActionHandlers
} from '../notificationRowActions';
import {
    NOTIFICATION_TYPE_LABEL_PREFIX,
    toNotificationViewModel
} from '../notificationViewModel';
import { useNotificationActorImage } from '../useNotificationActorImage';
import {
    NotificationActionButton,
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
        view.actor.name || t('view.notification.feed.unknown_sender');
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
        view.unseen && notification.type !== 'friendRequest';
    const showDelete = Boolean(shouldShowDeleteLog(notification));
    const hasMenu =
        showMenuMarkRead || overflowActions.length > 0 || showDelete;

    const actorButton = (
        <button
            type="button"
            className="shrink-0 transition-transform ease-out active:scale-[0.97] motion-safe:duration-150"
            aria-label={actorName}
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

    return (
        <div
            className={cn(
                'group flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 ease-out',
                view.unseen
                    ? 'bg-[color-mix(in_srgb,var(--status-joinme)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-joinme)_14%,transparent)]'
                    : 'hover:bg-muted/40'
            )}
        >
            {actorButton}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
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
                    <span className="text-muted-foreground/60 shrink-0 truncate text-xs">
                        {typeLabel}
                    </span>
                </div>
                {hasHeadline ? (
                    <p className="text-foreground truncate text-sm font-medium">
                        {view.headline}
                    </p>
                ) : null}
                {view.body || view.emoji ? (
                    <div className="flex min-w-0 items-center gap-2">
                        {view.body ? (
                            <p
                                className={cn(
                                    'line-clamp-2 min-w-0 text-sm leading-snug break-words',
                                    hasHeadline
                                        ? 'text-muted-foreground'
                                        : 'text-foreground/85'
                                )}
                            >
                                {view.body}
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
                {locationLine || linkButton ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                        {locationLine}
                        {linkButton}
                    </div>
                ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                <div className="flex items-center gap-2">
                    {inlineActions.length > 0 ? (
                        <div className="flex items-center gap-1">
                            {inlineActions.map((action) => (
                                <span
                                    key={action.key}
                                    className={cn(
                                        'transition-opacity duration-150 ease-out',
                                        !PRIMARY_ACTION_KEYS.has(action.key) &&
                                            'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                                    )}
                                >
                                    <NotificationActionButton
                                        label={action.label}
                                        onClick={action.onClick}
                                    >
                                        <action.Icon data-icon="icon" />
                                    </NotificationActionButton>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {view.expired ? (
                        <span className="border-border/60 text-muted-foreground/70 rounded-full border px-1.5 py-px text-[11px] leading-4">
                            {t('view.notification.feed.expired')}
                        </span>
                    ) : null}
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <span className="text-muted-foreground/60 text-xs tabular-nums">
                                    {clockLabel}
                                </span>
                            }
                        />
                        <TooltipContent>{absoluteLabel}</TooltipContent>
                    </Tooltip>
                    <span className="flex size-6 shrink-0 items-center justify-center">
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
                </div>
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
