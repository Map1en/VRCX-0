import type { Locale } from 'date-fns';
import { StarIcon, UsersRoundIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildTimelineData } from '@/components/group-event/groupCalendarModel';
import { getEventGroupId } from '@/components/group-event/groupEventFormat';
import { GroupEventHoverCard } from '@/components/group-event/GroupEventHoverCard';
import {
    Gantt,
    type GanttColumnContext,
    type GanttRenderEventProps
} from '@/components/reui/gantt/gantt';
import {
    GanttNav,
    GanttNavNext,
    GanttNavPrev,
    GanttNavToday,
    GanttTitle
} from '@/components/reui/gantt/gantt-nav';
import { GanttView } from '@/components/reui/gantt/gantt-view';
import type {
    GroupCalendarEventRecord,
    GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import {
    usePreferencesStore,
    type WeekStartsOnPreference
} from '@/state/preferencesStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

const READ_ONLY_INTERACTIONS = {
    drag: false,
    resize: false,
    selectSlot: false
};
const TIMELINE_METRICS = { unitWidths: { day: 2.5 } };
const TIMELINE_TREE_PANEL = {
    width: 76,
    minWidth: 76,
    nameColumnWidth: 76,
    resizable: false
};
const TIMELINE_LINES = { vertical: false, horizontal: true };
const TIMELINE_CLASS_NAMES = {
    event: 'bg-(--gantt-event-color) text-white hover:bg-(--gantt-event-color) hover:brightness-110 data-selected:bg-(--gantt-event-color) data-past:opacity-45 [text-shadow:0_1px_1px_rgb(0_0_0/0.3)]'
};

export function GroupCalendarTimeline({
    events,
    groupNames,
    groupProfiles,
    followingIds,
    date,
    rangeBounds,
    timeZone,
    locale,
    weekStartsOn,
    loading,
    onDateChange
}: {
    events: GroupCalendarEventRecord[];
    groupNames: Record<string, string>;
    groupProfiles: Record<string, GroupCalendarGroupRecord>;
    followingIds: string[];
    date: Date;
    rangeBounds: { min: Date; max: Date };
    timeZone: string;
    locale: Locale;
    weekStartsOn: WeekStartsOnPreference;
    loading: boolean;
    onDateChange(date: Date): void;
}) {
    const { t } = useTranslation();
    const dtHour12 = usePreferencesStore((state) => state.dtHour12);
    const timeline = useMemo(
        () => buildTimelineData(events, groupNames, followingIds),
        [events, followingIds, groupNames]
    );
    const followedSet = useMemo(() => new Set(followingIds), [followingIds]);
    const i18n = useMemo(
        () => ({
            labels: {
                today: t('dialog.group_calendar.today'),
                previous: t('dialog.group_calendar.timeline.previous_day'),
                next: t('dialog.group_calendar.timeline.next_day'),
                loading: t('dialog.group_calendar.loading_events'),
                events: (count: number) =>
                    t('dialog.group_calendar.events_count_short', { count }),
                resources: '',
                zoomIn: t('dialog.group_calendar.timeline.zoom_in'),
                zoomOut: t('dialog.group_calendar.timeline.zoom_out'),
                jumpToBar: (title: string) =>
                    t('dialog.group_calendar.timeline.jump_to_event', {
                        title
                    }),
                continues: t('dialog.group_calendar.timeline.continues')
            },
            formats: {
                dayTitle: 'PPPP',
                timeGutter: dtHour12 ? 'h a' : 'HH:mm',
                eventTime: dtHour12 ? 'h:mm a' : 'HH:mm'
            }
        }),
        [dtHour12, t]
    );

    function renderEvent({
        occurrence
    }: GanttRenderEventProps<GroupCalendarEventRecord>) {
        const event = occurrence.event.data;
        if (!event) {
            return null;
        }
        const groupId = getEventGroupId(event);
        const isFollowing = followedSet.has(occurrence.eventId);
        return (
            <GroupEventHoverCard
                event={event}
                groupName={groupNames[groupId] || groupId}
                groupProfile={groupProfiles[groupId]}
                isFollowing={isFollowing}
            >
                <span className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
                    {isFollowing ? (
                        <StarIcon
                            className="size-3 shrink-0 fill-current"
                            aria-hidden="true"
                        />
                    ) : null}
                    <span className="truncate font-medium">
                        {occurrence.event.title}
                    </span>
                </span>
            </GroupEventHoverCard>
        );
    }

    function renderResourceLabel({ resource }: GanttColumnContext) {
        const iconUrl = convertFileUrlToImageUrl(
            groupProfiles[resource.id]?.iconUrl || '',
            64
        );
        return (
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Avatar className="size-6 rounded-md after:rounded-md">
                            {iconUrl ? (
                                <AvatarImage
                                    src={iconUrl}
                                    alt={resource.title}
                                    loading="lazy"
                                    className="rounded-md"
                                />
                            ) : null}
                            <AvatarFallback className="rounded-md [&>svg]:size-3.5">
                                <UsersRoundIcon aria-hidden="true" />
                            </AvatarFallback>
                        </Avatar>
                    }
                />
                <TooltipContent side="right">{resource.title}</TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Gantt<GroupCalendarEventRecord>
            events={timeline.events}
            resources={timeline.resources}
            defaultScale="day"
            date={date}
            onDateChange={onDateChange}
            rangeBounds={rangeBounds}
            timeZone={timeZone}
            locale={locale}
            weekStartsOn={weekStartsOn}
            loading={loading}
            i18n={i18n}
            defaultInteractions={READ_ONLY_INTERACTIONS}
            rowCheckboxes={false}
            summaryBars={false}
            baselineBars={false}
            dependencyLines={false}
            metrics={TIMELINE_METRICS}
            treePanel={TIMELINE_TREE_PANEL}
            offDays={false}
            timelineLines={TIMELINE_LINES}
            classNames={TIMELINE_CLASS_NAMES}
            renderEvent={renderEvent}
            renderResourceLabel={renderResourceLabel}
            className="h-[55vh] overflow-hidden rounded-md border"
        >
            <GanttNav>
                <GanttNavToday />
                <div className="flex items-center">
                    <GanttNavPrev />
                    <GanttNavNext />
                </div>
                <GanttTitle />
            </GanttNav>
            <GanttView />
        </Gantt>
    );
}
