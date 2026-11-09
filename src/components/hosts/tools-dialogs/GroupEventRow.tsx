import {
    CalendarIcon,
    DownloadIcon,
    EllipsisIcon,
    ImageIcon,
    PencilIcon,
    Share2Icon,
    StarIcon,
    Trash2Icon
} from 'lucide-react';
import { useState, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import {
    copyEventLink,
    downloadEventIcs,
    openCalendarEvent
} from '@/components/group-event/groupEventActions';
import {
    eventImageUrl,
    eventStatus,
    formatEventRange,
    isCancelledEvent
} from '@/components/group-event/groupEventFormat';
import { GroupEventHoverCard } from '@/components/group-event/GroupEventHoverCard';
import { GroupEventStatusLabel } from '@/components/group-event/GroupEventStatusLabel';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateTime } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type {
    GroupCalendarEventRecord,
    GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import { defaultOccurrenceIndex, weeklySlotStart } from './groupCalendarModel';
import { getEventId } from './toolsDialogUtils';

const COLLAPSED_CHIP_COUNT = 7;

export function GroupEventRow({
    events,
    groupName,
    groupProfile,
    followingIds,
    variant,
    onOpen,
    surface = 'card',
    onToggleFollow,
    onEdit,
    onDelete
}: {
    events: GroupCalendarEventRecord[];
    groupName: string;
    groupProfile?: GroupCalendarGroupRecord | null;
    followingIds: ReadonlySet<string>;
    variant: 'day' | 'series';
    onOpen?: () => void;
    surface?: 'card' | 'plain';
    onToggleFollow(event: GroupCalendarEventRecord): void;
    onEdit?(event: GroupCalendarEventRecord): void;
    onDelete?(event: GroupCalendarEventRecord): void;
}) {
    const { t } = useTranslation();
    const [nowMs] = useState(() => Date.now());
    const [selectedIndex, setSelectedIndex] = useState(() =>
        defaultOccurrenceIndex(events, nowMs)
    );
    const [thumbnailError, setThumbnailError] = useState(false);
    const [chipsExpanded, setChipsExpanded] = useState(false);
    const event = events[Math.min(selectedIndex, events.length - 1)];
    const isFollowing = followingIds.has(getEventId(event));
    const followLabel = isFollowing
        ? t('dialog.tools.label.unfollow_event')
        : t('dialog.tools.label.follow_event');
    const isSeries = events.length > 1;
    const weeklyStart = isSeries ? weeklySlotStart(events) : null;
    const timeLabel = weeklyStart
        ? t('dialog.group_calendar.series.weekly', {
              weekday: formatDateTime(weeklyStart, { weekday: 'long' }),
              time: formatEventRange(event, { withDate: false })
          })
        : formatEventRange(event, { withDate: variant === 'series' });
    const cancelled = isCancelledEvent(event);
    const thumbnailUrl = thumbnailError
        ? ''
        : eventImageUrl(event, groupProfile, 256);
    const title =
        event.title?.trim() ||
        t('dialog.group_calendar.event_card.untitled_event');

    const visibleChipCount = chipsExpanded
        ? events.length
        : Math.max(COLLAPSED_CHIP_COUNT, selectedIndex + 1);
    const linkProps: HTMLAttributes<HTMLDivElement> = onOpen
        ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': title,
              onClick: onOpen,
              onKeyDown: (keyEvent) => {
                  if (
                      keyEvent.target === keyEvent.currentTarget &&
                      (keyEvent.key === 'Enter' || keyEvent.key === ' ')
                  ) {
                      keyEvent.preventDefault();
                      onOpen();
                  }
              }
          }
        : {};

    return (
        <GroupEventHoverCard
            event={event}
            groupName={groupName}
            groupProfile={groupProfile}
            isFollowing={isFollowing}
            openDelay={500}
            side="right"
        >
            <div
                {...linkProps}
                className={cn(
                    'group/card focus-visible:ring-ring/50 relative flex min-w-0 flex-col gap-2 rounded-lg p-2 transition-colors duration-(--motion-fast) ease-(--ease-out-ui) outline-none focus-visible:ring-3 focus-visible:ring-inset motion-reduce:transition-none',
                    surface === 'card'
                        ? 'bg-object-surface border-border border hover:bg-[color-mix(in_oklch,var(--object-surface),var(--foreground)_7%)]'
                        : 'hover:bg-(--state-hover-surface)',
                    onOpen && 'cursor-pointer'
                )}
            >
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        className={cn(
                            'bg-muted after:ring-foreground/10 relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-md after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset',
                            cancelled && 'opacity-50 grayscale'
                        )}
                    >
                        {thumbnailUrl ? (
                            <FadeInImage
                                src={thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="size-full object-cover"
                                onError={() => setThumbnailError(true)}
                            />
                        ) : (
                            <ImageIcon className="text-muted-foreground size-4" />
                        )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 group-focus-within/card:pr-14 group-hover/card:pr-14">
                        {variant === 'day' ? (
                            <span className="text-muted-foreground truncate text-xs leading-4">
                                {groupName}
                            </span>
                        ) : null}
                        <span className="flex min-w-0 items-center gap-1">
                            <span
                                className={cn(
                                    'truncate text-sm font-semibold',
                                    cancelled &&
                                        'text-muted-foreground line-through'
                                )}
                            >
                                {title}
                            </span>
                            {isFollowing ? (
                                <StarIcon
                                    className="size-3 shrink-0 fill-current text-[var(--status-askme)]"
                                    aria-hidden="true"
                                />
                            ) : null}
                        </span>
                        <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs leading-4 tabular-nums">
                            <span>{timeLabel}</span>
                            {cancelled ? null : (
                                <GroupEventStatusLabel
                                    event={event}
                                    nowMs={nowMs}
                                    hideDistant={variant === 'day'}
                                />
                            )}
                        </span>
                    </span>
                </div>
                {isSeries ? (
                    <div
                        role="presentation"
                        className="flex flex-wrap gap-0.5"
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
                    >
                        {events
                            .slice(0, visibleChipCount)
                            .map((occurrence, index) => {
                                const isSelected = occurrence === event;
                                return (
                                    <button
                                        key={getEventId(occurrence) || index}
                                        type="button"
                                        aria-pressed={isSelected}
                                        className={cn(
                                            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs tabular-nums transition-colors',
                                            isSelected
                                                ? 'bg-muted text-foreground'
                                                : 'text-muted-foreground hover:text-foreground',
                                            !isSelected &&
                                                eventStatus(
                                                    occurrence,
                                                    nowMs
                                                ) === 'ended' &&
                                                'opacity-50'
                                        )}
                                        onClick={() => setSelectedIndex(index)}
                                    >
                                        {followingIds.has(
                                            getEventId(occurrence)
                                        ) ? (
                                            <StarIcon
                                                className="size-3 fill-current text-[var(--status-askme)]"
                                                aria-hidden="true"
                                            />
                                        ) : null}
                                        {formatDateTime(occurrence.startsAt, {
                                            month: '2-digit',
                                            day: '2-digit',
                                            weekday: 'short'
                                        })}
                                    </button>
                                );
                            })}
                        {visibleChipCount < events.length ? (
                            <button
                                type="button"
                                aria-label={t(
                                    'dialog.group_calendar.series.show_all_dates'
                                )}
                                className="text-muted-foreground hover:text-foreground rounded-md px-1.5 py-0.5 text-xs tabular-nums transition-colors"
                                onClick={() => setChipsExpanded(true)}
                            >
                                +{events.length - visibleChipCount}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                <div
                    role="presentation"
                    className="pointer-events-none absolute top-2 right-2 z-20 flex items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fast) ease-(--ease-out-ui) group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 motion-reduce:transition-none"
                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                    onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
                >
                    <HintTooltip label={followLabel}>
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="secondary"
                            aria-pressed={isFollowing}
                            onClick={() => onToggleFollow(event)}
                        >
                            <StarIcon
                                className={cn(
                                    isFollowing &&
                                        'fill-current text-[var(--status-askme)]'
                                )}
                            />
                        </Button>
                    </HintTooltip>
                    <DropdownMenu>
                        <HintTooltip label={t('accessibility.more')}>
                            <DropdownMenuTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="secondary"
                                    >
                                        <EllipsisIcon />
                                    </Button>
                                }
                            />
                        </HintTooltip>
                        <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                                onClick={() => {
                                    copyEventLink(event, t);
                                }}
                            >
                                <Share2Icon />
                                {t('dialog.tools.action.copy_event_link')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => {
                                    openCalendarEvent(event, t);
                                }}
                            >
                                <CalendarIcon />
                                {t(
                                    'dialog.group_calendar.event_card.export_to_calendar'
                                )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => {
                                    downloadEventIcs(event, t);
                                }}
                            >
                                <DownloadIcon />
                                {t(
                                    'dialog.group_calendar.event_card.download_ics'
                                )}
                            </DropdownMenuItem>
                            {onEdit || onDelete ? (
                                <DropdownMenuSeparator />
                            ) : null}
                            {onEdit ? (
                                <DropdownMenuItem onClick={() => onEdit(event)}>
                                    <PencilIcon />
                                    {t('dialog.group_event_edit.edit_header')}
                                </DropdownMenuItem>
                            ) : null}
                            {onDelete ? (
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => onDelete(event)}
                                >
                                    <Trash2Icon />
                                    {t('dialog.group_event_edit.delete')}
                                </DropdownMenuItem>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </GroupEventHoverCard>
    );
}
