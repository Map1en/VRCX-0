import { CalendarIcon, CalendarPlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { buildEventSeries } from '@/components/hosts/tools-dialogs/groupCalendarModel';
import { GroupEventRow } from '@/components/hosts/tools-dialogs/GroupEventRow';
import { getEventId } from '@/components/hosts/tools-dialogs/toolsDialogUtils';
import {
    ToolbarActions,
    ToolbarIconButton,
    ToolbarRefreshButton,
    ToolbarStatus
} from '@/components/layout/ToolbarControls';
import type { GroupProfileRecord } from '@/domain/entities/group';
import type { LoadStatus } from '@/domain/shared/types';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

function eventTimeMs(value: string | null | undefined) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
}

function eventEndTimeMs(event: GroupCalendarEventRecord) {
    return eventTimeMs(event?.endsAt || event?.startsAt);
}

function splitGroupEvents(events: GroupCalendarEventRecord[]) {
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
        (left, right) =>
            eventTimeMs(left?.startsAt) - eventTimeMs(right?.startsAt)
    );
    past.sort((left, right) => eventEndTimeMs(right) - eventEndTimeMs(left));

    return { upcoming, past };
}

function summaryEventRows(events: GroupCalendarEventRecord[]) {
    const { upcoming, past } = splitGroupEvents(events);
    return [...upcoming, ...past].slice(0, 3);
}

function followingEventIds(events: GroupCalendarEventRecord[]) {
    return new Set(
        events
            .filter((event) => event.userInterest?.isFollowing === true)
            .map(getEventId)
    );
}

function GroupEventsEmpty({
    title,
    description = ''
}: {
    title: ReactNode;
    description?: ReactNode;
}) {
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
    series,
    emptyTitle,
    group,
    followingIds,
    onToggleFollow,
    onEdit,
    onDelete
}: {
    title: ReactNode;
    series: GroupCalendarEventRecord[][];
    emptyTitle: ReactNode;
    group: GroupProfileRecord;
    followingIds: ReadonlySet<string>;
    onToggleFollow: (event: GroupCalendarEventRecord) => void;
    onEdit?: (event: GroupCalendarEventRecord) => void;
    onDelete?: (event: GroupCalendarEventRecord) => void;
}) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="text-sm font-medium">{title}</div>
            {series.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                    {series.map((events, index) => (
                        <GroupEventRow
                            key={`${getEventId(events[0]) || 'event'}:${index}`}
                            events={events}
                            groupName={group.name || ''}
                            groupProfile={group}
                            followingIds={followingIds}
                            variant="series"
                            onToggleFollow={onToggleFollow}
                            onEdit={onEdit}
                            onDelete={onDelete}
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
    onOpenEvents,
    onToggleFollow
}: {
    events: GroupCalendarEventRecord[];
    status: LoadStatus;
    error: string;
    group: GroupProfileRecord;
    onOpenEvents: () => void;
    onToggleFollow: (event: GroupCalendarEventRecord) => void;
}) {
    const { t } = useTranslation();
    const rows = summaryEventRows(events);
    const followingIds = followingEventIds(events);

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
        <div className="-mx-2 flex flex-col gap-1">
            {rows.map((event, index) => (
                <GroupEventRow
                    key={`${getEventId(event) || 'event'}:${index}`}
                    events={[event]}
                    groupName={group.name || ''}
                    groupProfile={group}
                    followingIds={followingIds}
                    variant="series"
                    onOpen={onOpenEvents}
                    surface="plain"
                    onToggleFollow={onToggleFollow}
                />
            ))}
        </div>
    );
}

export function GroupEventsTab({
    events,
    status,
    error,
    group,
    canManage,
    onRefresh,
    onToggleFollow,
    onCreate,
    onEdit,
    onDelete
}: {
    events: GroupCalendarEventRecord[];
    status: LoadStatus;
    error: string;
    group: GroupProfileRecord;
    canManage: boolean;
    onRefresh: () => void;
    onToggleFollow: (event: GroupCalendarEventRecord) => void;
    onCreate: () => void;
    onEdit: (event: GroupCalendarEventRecord) => void;
    onDelete: (event: GroupCalendarEventRecord) => void;
}) {
    const { t } = useTranslation();
    const rows = Array.isArray(events) ? events : [];
    const { upcoming, past } = splitGroupEvents(rows);
    const loading = status === 'running';
    const followingIds = followingEventIds(rows);

    return (
        <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <ToolbarStatus className="mr-auto tabular-nums">
                    {t('dialog.group_calendar.events_count_short', {
                        count: rows.length
                    })}
                </ToolbarStatus>
                <ToolbarActions>
                    {canManage ? (
                        <ToolbarIconButton
                            icon={CalendarPlusIcon}
                            label={t('dialog.group.actions.create_event')}
                            onClick={onCreate}
                        />
                    ) : null}
                    <ToolbarRefreshButton
                        loading={loading}
                        onRefresh={onRefresh}
                    />
                </ToolbarActions>
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
                        series={buildEventSeries(upcoming).map(
                            (entry) => entry.events
                        )}
                        emptyTitle={t('dialog.group.events.no_upcoming_events')}
                        group={group}
                        followingIds={followingIds}
                        onToggleFollow={onToggleFollow}
                        onEdit={canManage ? onEdit : undefined}
                        onDelete={canManage ? onDelete : undefined}
                    />
                    <GroupEventsSection
                        title={t('dialog.group.info.past_events')}
                        series={past.map((event) => [event])}
                        emptyTitle={t('dialog.group.events.no_past_events')}
                        group={group}
                        followingIds={followingIds}
                        onToggleFollow={onToggleFollow}
                        onEdit={canManage ? onEdit : undefined}
                        onDelete={canManage ? onDelete : undefined}
                    />
                </div>
            ) : null}
        </div>
    );
}
