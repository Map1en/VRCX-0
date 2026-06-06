import { CalendarIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GroupEventCard } from '@/components/hosts/tools-dialogs/GroupEventCard';
import {
    getEventGroupId,
    getEventId
} from '@/components/hosts/tools-dialogs/toolsDialogUtils';
import { formatDateTime } from '@/lib/dateTime';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

function eventTimeMs(value: any) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
}

function eventEndTimeMs(event: any) {
    return eventTimeMs(event?.endsAt || event?.startsAt);
}

function splitGroupEvents(events: any) {
    const now = Date.now();
    const rows = Array.isArray(events) ? events : [];
    const upcoming = [];
    const past = [];

    for (const event of rows) {
        if (eventEndTimeMs(event) >= now) {
            upcoming.push(event);
        } else {
            past.push(event);
        }
    }

    upcoming.sort(
        (left: any, right: any) =>
            eventTimeMs(left?.startsAt) - eventTimeMs(right?.startsAt)
    );
    past.sort((left: any, right: any) => eventEndTimeMs(right) - eventEndTimeMs(left));

    return { upcoming, past };
}

function summaryEventRows(events: any) {
    const { upcoming, past } = splitGroupEvents(events);
    return [...upcoming, ...past].slice(0, 3);
}

function eventBannerUrl(event: any, group: any) {
    return convertFileUrlToImageUrl(
        event?.imageUrl ||
            event?.thumbnailImageUrl ||
            group?.bannerUrl ||
            group?.iconUrl ||
            '',
        128
    );
}

function eventTimeLabel(event: any) {
    if (!event?.startsAt) {
        return '';
    }
    const start = formatDateTime(
        event.startsAt,
        {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        },
        { fallback: '' }
    );
    const end = event.endsAt
        ? formatDateTime(
              event.endsAt,
              {
                  hour: '2-digit',
                  minute: '2-digit'
              },
              { fallback: '' }
          )
        : '';
    return end ? `${start} - ${end}` : start;
}

function GroupEventsEmpty({ title, description = '' }: any) {
    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <CalendarIcon />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}

function GroupEventsSection({
    title,
    events,
    emptyTitle,
    group,
    onToggleFollow
}: any) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="text-sm font-medium">{title}</div>
            {events.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {events.map((event: any, index: any) => (
                        <GroupEventCard
                            key={`${getEventId(event) || 'event'}:${index}`}
                            event={event}
                            mode="grid"
                            groupName={group.name || getEventGroupId(event)}
                            groupProfile={group}
                            isFollowing={Boolean(
                                event?.userInterest?.isFollowing
                            )}
                            onToggleFollow={() => onToggleFollow?.(event)}
                        />
                    ))}
                </div>
            ) : (
                <GroupEventsEmpty title={emptyTitle} />
            )}
        </section>
    );
}

export function GroupEventSummary({
    events,
    status,
    error,
    group,
    onOpenEvents
}: any) {
    const { t } = useTranslation();
    const rows = summaryEventRows(events);

    if (status === 'running' && !rows.length) {
        return (
            <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-3 text-sm">
                <Spinner />
                {t('dialog.group.loading.loading')}
            </div>
        );
    }

    if (error && !rows.length) {
        return (
            <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                {error}
            </div>
        );
    }

    if (!rows.length) {
        return (
            <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                {t('dialog.group.overview.no_recent_events')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {rows.map((event: any, index: any) => {
                const bannerUrl = eventBannerUrl(event, group);
                return (
                    <Button
                        key={`${getEventId(event) || 'event'}:${index}`}
                        type="button"
                        variant="ghost"
                        className="bg-muted/10 hover:bg-muted/25 h-auto w-full justify-start gap-3 rounded-md border p-2 text-left"
                        onClick={onOpenEvents}
                    >
                        <span className="bg-muted flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
                            {bannerUrl ? (
                                <img
                                    src={bannerUrl}
                                    alt=""
                                    className="size-full object-cover"
                                />
                            ) : (
                                <CalendarIcon className="text-muted-foreground size-5" />
                            )}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate text-sm font-medium">
                                {event?.title ||
                                    t(
                                        'dialog.group_calendar.event_card.untitled_event'
                                    )}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                                {eventTimeLabel(event) || '\u2014'}
                            </span>
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}

export function GroupEventsTab({
    events,
    status,
    error,
    group,
    onRefresh,
    onToggleFollow
}: any) {
    const { t } = useTranslation();
    const rows = Array.isArray(events) ? events : [];
    const { upcoming, past } = splitGroupEvents(rows);
    const loading = status === 'running';

    return (
        <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground text-sm">
                    {rows.length} {t('dialog.group.events.header')}
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={onRefresh}
                >
                    {loading ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                    )}
                    {t('common.actions.refresh')}
                </Button>
            </div>

            {error ? (
                <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                    {error}
                </div>
            ) : null}

            {!rows.length && !loading && !error ? (
                <GroupEventsEmpty title={t('dialog.group.events.no_events')} />
            ) : null}

            {loading && !rows.length ? (
                <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-3 text-sm">
                    <Spinner />
                    {t('dialog.group.loading.loading')}
                </div>
            ) : null}

            {rows.length ? (
                <div className="flex min-w-0 flex-col gap-4">
                    <GroupEventsSection
                        title={t('dialog.group.info.upcoming_events')}
                        events={upcoming}
                        emptyTitle={t('dialog.group.events.no_upcoming_events')}
                        group={group}
                        onToggleFollow={onToggleFollow}
                    />
                    <GroupEventsSection
                        title={t('dialog.group.info.past_events')}
                        events={past}
                        emptyTitle={t('dialog.group.events.no_past_events')}
                        group={group}
                        onToggleFollow={onToggleFollow}
                    />
                </div>
            ) : null}
        </div>
    );
}
