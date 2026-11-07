import {
    addMonths,
    compareAsc,
    format,
    isSameMonth,
    startOfMonth,
    subMonths
} from 'date-fns';
import {
    ChevronDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    RefreshCwIcon
} from 'lucide-react';
import {
    createContext,
    useContext,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState
} from 'react';
import type { ComponentProps } from 'react';
import type { Locale } from 'react-day-picker';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateTime } from '@/lib/dateTime';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import vrchatToolsRepository, {
    type GroupCalendarEventRecord,
    type GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { openGroupDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { toast } from '@/services/toastService';
import { isRecord } from '@/shared/utils/record';
import { replaceBioSymbols } from '@/shared/utils/string';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Calendar, CalendarDayButton } from '@/ui/shadcn/calendar';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/shadcn/empty';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { GroupCalendarDiscoverView } from './GroupCalendarDiscoverView';
import {
    buildEventSeries,
    buildEventsByDate,
    buildFollowedCountByDate,
    calendarDateKey,
    calendarLocaleForLanguage,
    dateKeyToLocalDate,
    formatCalendarRequestDate,
    monthDateFromKey
} from './groupCalendarModel';
import { GroupCalendarTimeline } from './GroupCalendarTimeline';
import { GroupEventRow } from './GroupEventRow';
import {
    getEventGroupId,
    getEventId,
    selectedDateKey,
    updateArrayValue
} from './toolsDialogUtils';

type GroupCalendarEvent = GroupCalendarEventRecord;
type GroupCalendarDayButtonContextValue = {
    eventsByDate: Record<string, GroupCalendarEvent[]>;
    followedCountByDate: Record<string, number>;
    locale: Partial<Locale>;
    timeZone: string;
};

const GroupCalendarDayButtonContext =
    createContext<GroupCalendarDayButtonContextValue | null>(null);

function getLocalTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function GroupCalendarDayButton({
    className,
    day,
    modifiers,
    ...props
}: ComponentProps<typeof CalendarDayButton>) {
    const { t } = useTranslation();
    const context = useContext(GroupCalendarDayButtonContext);
    if (!context) {
        throw new Error(
            'GroupCalendarDayButton must be rendered inside its context provider'
        );
    }
    const { eventsByDate, followedCountByDate, locale, timeZone } = context;
    const dateKey = calendarDateKey(day.date, timeZone);
    const eventCount = eventsByDate[dateKey]?.length ?? 0;
    const followedCount = followedCountByDate[dateKey] ?? 0;
    const eventText = t('dialog.group_calendar.events_count_short', {
        count: eventCount
    });
    const followedText = t('dialog.group_calendar.following_count_short', {
        count: followedCount
    });
    const isOutsideDay = Boolean(modifiers.outside);
    const visibleEventCount = isOutsideDay ? 0 : eventCount;
    const visibleFollowedCount = isOutsideDay ? 0 : followedCount;

    return (
        <CalendarDayButton
            {...props}
            day={day}
            modifiers={modifiers}
            locale={locale}
            className={cn(
                className,
                'text-foreground hover:text-foreground data-[selected-single=true]:bg-accent/30! data-[selected-single=true]:text-foreground! data-[selected-single=true]:ring-muted-foreground/60 h-(--cell-size) min-h-(--cell-size) items-center justify-between gap-0.5 rounded-md bg-transparent p-1.5 transition-colors hover:bg-(--state-hover-surface) data-[selected-single=true]:ring-1 sm:gap-1 sm:p-2'
            )}
            aria-label={`${dateKey}, ${eventText}, ${followedText}`}
        >
            <div
                className={cn(
                    'flex h-5 w-full items-center justify-center text-sm leading-none font-semibold tabular-nums sm:text-[15px]',
                    isOutsideDay && 'text-muted-foreground/50'
                )}
            >
                {format(dateKeyToLocalDate(dateKey), 'd')}
            </div>
            <div
                aria-hidden="true"
                className="flex h-2 w-full items-center justify-center gap-0.5"
            >
                {Array.from(
                    { length: Math.min(visibleEventCount, MAX_DAY_DOTS) },
                    (_, index) => (
                        <span
                            key={index}
                            className={cn(
                                'size-1 rounded-full',
                                index < visibleFollowedCount
                                    ? 'bg-[var(--status-askme)]'
                                    : 'bg-muted-foreground'
                            )}
                        />
                    )
                )}
                {visibleEventCount > MAX_DAY_DOTS ? (
                    <span className="text-muted-foreground text-[10px] leading-none tabular-nums">
                        +{visibleEventCount - MAX_DAY_DOTS}
                    </span>
                ) : null}
            </div>
        </CalendarDayButton>
    );
}

const MAX_DAY_DOTS = 3;

const GROUP_CALENDAR_COMPONENTS = {
    DayButton: GroupCalendarDayButton
};

export function GroupCalendarDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
}) {
    const { t, i18n } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const weekStartsOn = usePreferencesStore((state) => state.weekStartsOn);
    const calendarTimeZone = useMemo(() => getLocalTimeZone(), []);
    const calendarLocale = useMemo(
        () => calendarLocaleForLanguage(i18n.resolvedLanguage || i18n.language),
        [i18n.language, i18n.resolvedLanguage]
    );
    const [selectedDate, setSelectedDate] = useState(() =>
        selectedDateKey(new Date())
    );
    const [visibleMonthDate, setVisibleMonthDate] = useState(() =>
        monthDateFromKey(selectedDateKey(new Date()))
    );
    const [showFeaturedEvents, setShowFeaturedEvents] = useState(false);
    const [viewMode, setViewMode] = useState<
        'calendar' | 'timeline' | 'list' | 'discover'
    >('calendar');
    const [search, setSearch] = useState('');
    const [events, setEvents] = useState<GroupCalendarEvent[]>([]);
    const [followingIds, setFollowingIds] = useState<string[]>([]);
    const [groupNames, setGroupNames] = useState<Record<string, string>>({});
    const [groupProfiles, setGroupProfiles] = useState<
        Record<string, GroupCalendarGroupRecord>
    >({});
    const [collapsedGroups, setCollapsedGroups] = useState<
        Record<string, boolean>
    >({});
    const [loading, setLoading] = useState(false);
    const loadRequestRef = useRef(0);

    const selectedDateValue = useMemo(
        () => dateKeyToLocalDate(selectedDate),
        [selectedDate]
    );
    const eventsByDate = useMemo(
        () => buildEventsByDate(events, calendarTimeZone),
        [calendarTimeZone, events]
    );
    const followedCountByDate = useMemo(
        () => buildFollowedCountByDate(events, followingIds, calendarTimeZone),
        [calendarTimeZone, events, followingIds]
    );
    const calendarDayButtonContextValue = useMemo(
        () => ({
            eventsByDate,
            followedCountByDate,
            locale: calendarLocale,
            timeZone: calendarTimeZone
        }),
        [calendarLocale, calendarTimeZone, eventsByDate, followedCountByDate]
    );
    const timelineRangeBounds = useMemo(
        () => ({
            min: visibleMonthDate,
            max: startOfMonth(addMonths(visibleMonthDate, 1))
        }),
        [visibleMonthDate]
    );
    const followingSet = useMemo(() => new Set(followingIds), [followingIds]);
    const selectedDayEvents = useMemo(
        () => eventsByDate[selectedDate] || [],
        [eventsByDate, selectedDate]
    );
    const eventsByGroup = useMemo(() => {
        const query = search.trim().toLowerCase();
        const groups = new Map<string, GroupCalendarEvent[]>();
        for (const event of events) {
            const groupId = getEventGroupId(event);
            if (!groupId) {
                continue;
            }
            const groupName = groupNames[groupId] || groupId;
            if (
                query &&
                !groupName.toLowerCase().includes(query) &&
                !String(event.title || '')
                    .toLowerCase()
                    .includes(query) &&
                !String(event.description || '')
                    .toLowerCase()
                    .includes(query)
            ) {
                continue;
            }
            if (!groups.has(groupId)) {
                groups.set(groupId, []);
            }
            groups.get(groupId)?.push(event);
        }
        return Array.from(groups.entries())
            .map(([groupId, groupEvents]) => ({
                groupId,
                groupName: groupNames[groupId] || groupId,
                series: buildEventSeries(
                    groupEvents.sort((left, right) =>
                        compareAsc(
                            new Date(left.startsAt || 0),
                            new Date(right.startsAt || 0)
                        )
                    )
                )
            }))
            .sort((left, right) =>
                left.groupName.localeCompare(right.groupName)
            );
    }, [events, groupNames, search]);

    async function loadCalendar(force = false) {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        try {
            const date = formatCalendarRequestDate(visibleMonthDate);
            const snapshot = await fetchCachedData({
                queryKey: queryKeys.groupCalendarList(
                    'aggregate',
                    {
                        date,
                        includeFeatured: showFeaturedEvents,
                        userId: currentUserId
                    },
                    currentEndpoint
                ),
                policy: entityQueryPolicies.groupCollection,
                force,
                queryFn: async () => {
                    const snapshot = await commands.appGroupCalendarSnapshotGet(
                        {
                            date,
                            includeFeatured: showFeaturedEvents
                        }
                    );
                    return {
                        ...snapshot,
                        events: snapshot.events.filter(isRecord),
                        groupNames: Object.fromEntries(
                            Object.entries(snapshot.groupNames).filter(
                                (entry): entry is [string, string] =>
                                    typeof entry[1] === 'string'
                            )
                        ),
                        groupProfiles: Object.fromEntries(
                            Object.entries(snapshot.groupProfiles).filter(
                                (
                                    entry
                                ): entry is [
                                    string,
                                    GroupCalendarGroupRecord
                                ] => isRecord(entry[1])
                            )
                        )
                    };
                }
            });
            const normalizedRows = snapshot.events.map((event) => ({
                ...event,
                title: replaceBioSymbols(event.title || ''),
                description: replaceBioSymbols(event.description || '')
            }));
            if (requestId !== loadRequestRef.current) {
                return;
            }
            setEvents(normalizedRows);
            setFollowingIds(snapshot.followingEventIds);
            setGroupNames((current) => ({
                ...current,
                ...snapshot.groupNames
            }));
            setGroupProfiles((current) => ({
                ...current,
                ...snapshot.groupProfiles
            }));
        } catch (error) {
            if (requestId !== loadRequestRef.current) {
                return;
            }
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('host.tools_dialogs.toast.failed_to_load_group_events')
                )
            });
        } finally {
            if (requestId === loadRequestRef.current) {
                setLoading(false);
            }
        }
    }

    const loadVisibleCalendar = useEffectEvent(() => loadCalendar());

    useEffect(() => {
        if (!open) {
            return;
        }
        const todayKey = selectedDateKey(new Date());
        setSelectedDate(todayKey);
        setVisibleMonthDate(monthDateFromKey(todayKey));
        configRepository
            .getBool('groupCalendarShowFeaturedEvents', false)
            .then(setShowFeaturedEvents)
            .catch(() => {});
    }, [open]);

    useEffect(() => {
        if (!open) {
            loadRequestRef.current += 1;
            return;
        }
        loadVisibleCalendar();
    }, [
        currentEndpoint,
        currentUserId,
        open,
        visibleMonthDate,
        showFeaturedEvents
    ]);

    async function toggleFeatured(nextValue: boolean) {
        setShowFeaturedEvents(nextValue);
        await configRepository
            .setBool('groupCalendarShowFeaturedEvents', nextValue)
            .catch(() => {});
    }

    function groupIconUrl(groupId: string) {
        return convertFileUrlToImageUrl(
            groupProfiles[groupId]?.iconUrl || '',
            64
        );
    }

    async function toggleFollow(event: GroupCalendarEvent) {
        const groupId = getEventGroupId(event);
        const eventId = getEventId(event);
        if (!groupId || !eventId) {
            return;
        }
        const nextFollowing = !followingIds.includes(eventId);
        try {
            await vrchatToolsRepository.followGroupEvent({
                groupId,
                eventId,
                isFollowing: nextFollowing
            });
            setFollowingIds((current) =>
                updateArrayValue(current, eventId, nextFollowing)
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(
                        'host.tools_dialogs.toast.failed_to_update_group_event_follow_state'
                    )
                )
            });
        }
    }

    function selectDateKey(nextDateKey: string) {
        setSelectedDate(nextDateKey);
        setVisibleMonthDate((current) => {
            const nextMonthDate = monthDateFromKey(nextDateKey);
            return isSameMonth(current, nextMonthDate)
                ? current
                : nextMonthDate;
        });
    }

    function handleCalendarSelect(nextDate: Date | undefined) {
        if (!nextDate) {
            return;
        }
        selectDateKey(calendarDateKey(nextDate, calendarTimeZone));
    }

    function handleCalendarMonthChange(nextMonth: Date) {
        const nextDateKey = calendarDateKey(nextMonth, calendarTimeZone);
        setVisibleMonthDate(monthDateFromKey(nextDateKey));
        setSelectedDate((current) =>
            isSameMonth(
                dateKeyToLocalDate(current),
                monthDateFromKey(nextDateKey)
            )
                ? current
                : nextDateKey
        );
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(nextOpen) => {
                if (!nextOpen && !open) {
                    setEvents([]);
                    setFollowingIds([]);
                    setGroupNames({});
                    setGroupProfiles({});
                }
            }}
        >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-7xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.group_calendar.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {loading
                            ? t('dialog.group_calendar.loading_events')
                            : t('dialog.group_calendar.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-3">
                    {viewMode === 'timeline' ||
                    viewMode === 'discover' ? null : (
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(
                                    'dialog.group_calendar.previous_month'
                                )}
                                onClick={() =>
                                    handleCalendarMonthChange(
                                        subMonths(visibleMonthDate, 1)
                                    )
                                }
                            >
                                <ChevronLeftIcon />
                            </Button>
                            <span className="min-w-24 text-center text-sm font-semibold tabular-nums">
                                {formatDateTime(visibleMonthDate, {
                                    year: 'numeric',
                                    month: 'long'
                                })}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(
                                    'dialog.group_calendar.next_month'
                                )}
                                onClick={() =>
                                    handleCalendarMonthChange(
                                        addMonths(visibleMonthDate, 1)
                                    )
                                }
                            >
                                <ChevronRightIcon />
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    selectDateKey(selectedDateKey(new Date()))
                                }
                            >
                                {t('dialog.group_calendar.today')}
                            </Button>
                        </div>
                    )}
                    {viewMode === 'discover' ? null : (
                        <>
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id="group-calendar-featured-events"
                                    checked={showFeaturedEvents}
                                    onCheckedChange={(checked) => {
                                        toggleFeatured(checked);
                                    }}
                                />
                                <FieldLabel htmlFor="group-calendar-featured-events">
                                    {t('dialog.group_calendar.featured_events')}
                                </FieldLabel>
                            </Field>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={loading}
                                onClick={() => {
                                    loadCalendar(true);
                                }}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t('common.actions.refresh')}
                            </Button>
                        </>
                    )}
                    <ToggleGroup
                        className="ml-auto"
                        variant="outline"
                        size="sm"
                        value={viewMode ? [viewMode] : []}
                        onValueChange={(nextValue) => {
                            if (nextValue[0]) {
                                if (
                                    nextValue[0] === 'calendar' ||
                                    nextValue[0] === 'timeline' ||
                                    nextValue[0] === 'list' ||
                                    nextValue[0] === 'discover'
                                ) {
                                    setViewMode(nextValue[0]);
                                }
                            }
                        }}
                    >
                        <ToggleGroupItem value="calendar">
                            {t('dialog.group_calendar.calendar_view')}
                        </ToggleGroupItem>
                        <ToggleGroupSeparator />
                        <ToggleGroupItem value="timeline">
                            {t('dialog.group_calendar.timeline_view')}
                        </ToggleGroupItem>
                        <ToggleGroupSeparator />
                        <ToggleGroupItem value="list">
                            {t('dialog.group_calendar.list_view')}
                        </ToggleGroupItem>
                        <ToggleGroupSeparator />
                        <ToggleGroupItem value="discover">
                            {t('dialog.group_calendar.discover_view')}
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                {viewMode === 'discover' ? (
                    <GroupCalendarDiscoverView
                        followingIds={followingSet}
                        groupNames={groupNames}
                        groupProfiles={groupProfiles}
                        onFollowedEvents={(eventIds) =>
                            setFollowingIds((current) =>
                                eventIds.reduce(
                                    (next, eventId) =>
                                        updateArrayValue(next, eventId, true),
                                    current
                                )
                            )
                        }
                        onToggleFollow={toggleFollow}
                    />
                ) : viewMode === 'timeline' ? (
                    <div className="min-w-0">
                        <GroupCalendarTimeline
                            events={events}
                            groupNames={groupNames}
                            groupProfiles={groupProfiles}
                            followingIds={followingIds}
                            date={selectedDateValue}
                            rangeBounds={timelineRangeBounds}
                            timeZone={calendarTimeZone}
                            locale={calendarLocale}
                            weekStartsOn={weekStartsOn}
                            loading={loading}
                            onDateChange={(nextDate) =>
                                selectDateKey(
                                    calendarDateKey(nextDate, calendarTimeZone)
                                )
                            }
                        />
                    </div>
                ) : viewMode === 'calendar' ? (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="flex min-w-0 flex-col gap-2">
                            <div className="flex items-baseline gap-2 px-1">
                                <span className="text-sm font-semibold">
                                    {formatDateTime(selectedDateValue, {
                                        month: 'long',
                                        day: 'numeric',
                                        weekday: 'long'
                                    })}
                                </span>
                                <span className="text-muted-foreground text-xs tabular-nums">
                                    {t(
                                        'dialog.group_calendar.events_count_short',
                                        { count: selectedDayEvents.length }
                                    )}
                                </span>
                            </div>
                            <ScrollArea className="h-[48vh]">
                                {selectedDayEvents.length ? (
                                    <div className="flex flex-col gap-2 pr-3">
                                        {selectedDayEvents.map((event) => (
                                            <GroupEventRow
                                                key={getEventId(event)}
                                                events={[event]}
                                                groupName={
                                                    groupNames[
                                                        getEventGroupId(event)
                                                    ] || getEventGroupId(event)
                                                }
                                                groupProfile={
                                                    groupProfiles[
                                                        getEventGroupId(event)
                                                    ]
                                                }
                                                followingIds={followingSet}
                                                variant="day"
                                                onOpen={() =>
                                                    openGroupDialog({
                                                        groupId:
                                                            getEventGroupId(
                                                                event
                                                            )
                                                    })
                                                }
                                                onToggleFollow={toggleFollow}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <Empty className="h-40 border-0 p-4">
                                        <EmptyHeader>
                                            <EmptyTitle>
                                                {t(
                                                    'dialog.group_calendar.no_events'
                                                )}
                                            </EmptyTitle>
                                        </EmptyHeader>
                                    </Empty>
                                )}
                            </ScrollArea>
                        </div>
                        <GroupCalendarDayButtonContext.Provider
                            value={calendarDayButtonContextValue}
                        >
                            <Calendar
                                mode="single"
                                required
                                selected={selectedDateValue}
                                month={visibleMonthDate}
                                onSelect={handleCalendarSelect}
                                onMonthChange={handleCalendarMonthChange}
                                hideNavigation
                                timeZone={calendarTimeZone}
                                locale={calendarLocale}
                                weekStartsOn={weekStartsOn}
                                className="mx-auto self-start rounded-lg p-2 [--cell-size:--spacing(10)] sm:p-3 sm:[--cell-size:--spacing(12)]"
                                classNames={{
                                    month: 'flex w-full flex-col gap-3',
                                    month_caption: 'hidden',
                                    weekdays: 'flex gap-0.5 sm:gap-1',
                                    weekday:
                                        'text-muted-foreground/70 flex-1 rounded-md text-xs font-medium select-none',
                                    week: 'mt-1 flex w-full gap-0.5 sm:gap-1',
                                    today: 'rounded-(--cell-radius) bg-accent/30 text-foreground data-[selected=true]:bg-transparent'
                                }}
                                components={GROUP_CALENDAR_COMPONENTS}
                            />
                        </GroupCalendarDayButtonContext.Provider>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <Input
                            value={search}
                            placeholder={t(
                                'dialog.group_calendar.search_placeholder'
                            )}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                        <ScrollArea className="h-[55vh]">
                            {eventsByGroup.length ? (
                                eventsByGroup.map((group) => (
                                    <div
                                        key={group.groupId}
                                        className="mb-6 flex flex-col gap-2 pr-3"
                                    >
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="justify-start gap-2 px-1"
                                            onClick={() =>
                                                setCollapsedGroups(
                                                    (current) => ({
                                                        ...current,
                                                        [group.groupId]:
                                                            !current[
                                                                group.groupId
                                                            ]
                                                    })
                                                )
                                            }
                                        >
                                            <ChevronDownIcon
                                                data-icon="inline-start"
                                                className={cn(
                                                    'transition-transform',
                                                    collapsedGroups[
                                                        group.groupId
                                                    ] && '-rotate-90'
                                                )}
                                            />
                                            {groupIconUrl(group.groupId) ? (
                                                <FadeInImage
                                                    src={groupIconUrl(
                                                        group.groupId
                                                    )}
                                                    alt=""
                                                    loading="lazy"
                                                    className="size-5 rounded-sm object-cover"
                                                />
                                            ) : null}
                                            <span className="truncate">
                                                {group.groupName}
                                            </span>
                                        </Button>
                                        {!collapsedGroups[group.groupId] ? (
                                            <div className="grid gap-2 md:grid-cols-2">
                                                {group.series.map((series) => (
                                                    <GroupEventRow
                                                        key={series.key}
                                                        events={series.events}
                                                        groupName={
                                                            group.groupName
                                                        }
                                                        groupProfile={
                                                            groupProfiles[
                                                                group.groupId
                                                            ]
                                                        }
                                                        followingIds={
                                                            followingSet
                                                        }
                                                        variant="series"
                                                        onOpen={() =>
                                                            openGroupDialog({
                                                                groupId:
                                                                    group.groupId
                                                            })
                                                        }
                                                        onToggleFollow={
                                                            toggleFollow
                                                        }
                                                    />
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ))
                            ) : (
                                <Empty className="h-40 border-0 p-4">
                                    <EmptyHeader>
                                        <EmptyTitle>
                                            {search
                                                ? t(
                                                      'dialog.group_calendar.search_no_matching'
                                                  )
                                                : t(
                                                      'dialog.group_calendar.search_no_this_month'
                                                  )}
                                        </EmptyTitle>
                                    </EmptyHeader>
                                </Empty>
                            )}
                        </ScrollArea>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
