import { ChevronDownIcon } from 'lucide-react';
import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClock } from '@/lib/dateTime';
import { useMinuteNowMs } from '@/lib/useMinuteNowMs';
import { cn } from '@/lib/utils';

import { getNotificationRelativeTime } from '../drawer/notificationDrawerRowUtils';
import type { NotificationRow } from '../notificationPageTypes';
import { NotificationSessionUnreadContext } from '../notificationSessionUnread';
import {
    type NotificationActor,
    toNotificationViewModel
} from '../notificationViewModel';
import { useNotificationActorImage } from '../useNotificationActorImage';
import {
    NotificationIconDisc,
    NotificationPersonAvatar
} from './NotificationRowParts';

const MAX_STACKED_AVATARS = 3;

type StackedActor = {
    key: string;
    actor: NotificationActor;
    notification: NotificationRow;
};

function actorKey(actor: NotificationActor): string {
    return actor.kind === 'system'
        ? `system:${actor.name}`
        : `${actor.kind}:${actor.id || actor.name}`;
}

function StackedAvatar({
    actor,
    notification,
    className
}: {
    actor: NotificationActor;
    className: string;
    notification: NotificationRow;
}) {
    const imageUrl = useNotificationActorImage(actor);
    return actor.kind === 'user' ? (
        <NotificationPersonAvatar
            notification={notification}
            imageUrl={imageUrl}
            className={className}
        />
    ) : (
        <NotificationIconDisc
            notification={notification}
            imageUrl={imageUrl}
            className={className}
        />
    );
}

export function NotificationGroupSummary({
    rows,
    expanded,
    onToggle,
    variant,
    unseen
}: {
    expanded: boolean;
    onToggle(): void;
    rows: readonly NotificationRow[];
    unseen?: boolean;
    variant: 'page' | 'drawer';
}) {
    const { t } = useTranslation();
    const sessionKeys = useContext(NotificationSessionUnreadContext);
    const nowMs = useMinuteNowMs();
    const unknownLabel = t('view.notification.feed.unknown');
    const views = useMemo(
        () =>
            rows.map((notification) =>
                toNotificationViewModel(notification, { unknownLabel, t })
            ),
        [rows, unknownLabel, t]
    );
    const actors = useMemo(() => {
        const seen = new Map<string, StackedActor>();
        views.forEach((view, index) => {
            const key = actorKey(view.actor);
            if (!seen.has(key)) {
                seen.set(key, {
                    key,
                    actor: view.actor,
                    notification: rows[index]
                });
            }
        });
        return [...seen.values()];
    }, [rows, views]);
    const newest = views[0];
    const firstActor = actors[0]?.actor;
    const name = firstActor?.name || t('view.notification.feed.unknown_sender');
    const title = t(
        actors.length > 1
            ? 'view.notification.feed.group.from_people'
            : 'view.notification.feed.group.from_actor',
        { name, count: rows.length }
    );
    const typeLabel = t(newest.typeLabelKey, {
        defaultValue: rows[0].type || 'unknown'
    });
    const hasUnseen = unseen ?? views.some((view) => view.unseen);
    const newThisSession = rows.some(
        (row) => typeof row.id === 'string' && sessionKeys.has(row.id)
    );
    const timeLabel =
        variant === 'page'
            ? formatClock(newest.createdAt)
            : getNotificationRelativeTime(rows[0], nowMs);
    return (
        <button
            type="button"
            aria-expanded={expanded}
            className={cn(
                'flex w-full items-center gap-3 text-left transition-colors duration-150 ease-out',
                variant === 'page'
                    ? 'rounded-lg px-2 py-2.5'
                    : cn('px-4 py-3', !expanded && 'border-border/50 border-b'),
                newThisSession
                    ? 'bg-(--state-selected-surface) hover:bg-(--state-selected-hover-surface)'
                    : 'hover:bg-(--state-hover-surface)'
            )}
            onClick={onToggle}
        >
            <span className="flex w-2 shrink-0 justify-center self-start pt-1.5">
                {hasUnseen ? (
                    <span className="bg-primary size-2 rounded-full">
                        <span className="sr-only">
                            {t('view.notification.feed.unread')}
                        </span>
                    </span>
                ) : null}
            </span>
            <span className="flex shrink-0 -space-x-3">
                {actors.slice(0, MAX_STACKED_AVATARS).map((entry) => (
                    <StackedAvatar
                        key={entry.key}
                        actor={entry.actor}
                        notification={entry.notification}
                        className="ring-background size-9 ring-2"
                    />
                ))}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                        {title}
                    </span>
                    <span className="text-muted-foreground/60 shrink-0 text-xs">
                        {typeLabel}
                    </span>
                </span>
                <span className="text-muted-foreground/60 text-xs tabular-nums">
                    {timeLabel}
                </span>
            </span>
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                {t(
                    expanded
                        ? 'view.notification.feed.group.collapse'
                        : 'view.notification.feed.group.expand'
                )}
                <ChevronDownIcon
                    aria-hidden
                    className={cn(
                        'size-3.5 motion-safe:transition-transform motion-safe:duration-150',
                        expanded && 'rotate-180'
                    )}
                />
            </span>
        </button>
    );
}
