import {
    addYears,
    compareAsc,
    endOfYear,
    format,
    isSameMonth,
    startOfYear,
    subYears
} from 'date-fns';
import { ChevronDownIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import configRepository from '@/repositories/configRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';
import { replaceBioSymbols } from '@/shared/utils/string';
import { usePreferencesStore } from '@/state/preferencesStore';
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
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    buildEventsByDate,
    buildFollowedCountByDate,
    calendarDateKey,
    calendarLocaleForLanguage,
    dateKeyToLocalDate,
    formatCalendarRequestDate,
    monthDateFromKey
} from './groupCalendarModel';
import { GroupEventCard } from './GroupEventCard';
import {
    getEndpoint,
    getEventGroupId,
    getEventId,
    selectedDateKey,
    updateArrayValue
} from './toolsDialogUtils';

function getLocalTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function GroupCalendarDayButton({
    className,
    day,
    modifiers,
    locale,
    eventsByDate,
    followedCountByDate,
    timeZone,
    ...props
}: any) {
    const { t } = useTranslation();
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
                'text-foreground hover:bg-accent/40 hover:text-foreground data-[selected-single=true]:bg-accent/30! data-[selected-single=true]:text-foreground! data-[selected-single=true]:ring-muted-foreground/60 h-(--cell-size) min-h-(--cell-size) items-center justify-between gap-0.5 rounded-md bg-transparent p-1.5 transition-colors data-[selected-single=true]:ring-1 sm:gap-1 sm:p-2'
            )}
            aria-label={`${dateKey}, ${eventText}, ${followedText}`}
        >
            <div
                className={cn(
                    'flex h-5 w-full items-center justify-center text-sm leading-none font-semibold tabular-nums sm:h-6 sm:text-[17px]',
                    isOutsideDay && 'text-muted-foreground/50'
                )}
            >
                {format(dateKeyToLocalDate(dateKey), 'd')}
            </div>
            <div className="grid h-3.5 w-full grid-cols-2 items-center gap-1.5 text-[10px] leading-none tabular-nums sm:gap-2 sm:text-[11px]">
                {visibleEventCount ? (
                    <span className="text-platform-pc min-w-3 text-center font-semibold">
                        {visibleEventCount}
                    </span>
                ) : (
                    <span aria-hidden="true" />
                )}
                {visibleFollowedCount ? (
                    <span className="min-w-3 text-center font-semibold text-[var(--status-askme)]">
                        {visibleFollowedCount}
                    </span>
                ) : (
                    <span aria-hidden="true" />
                )}
            </div>
        </CalendarDayButton>
    );
}

export function GroupCalendarDialog({ open, onOpenChange }: any) {
    const { t, i18n } = useTranslation();
    const weekStartsOn = usePreferencesStore(
        (state: any) => state.weekStartsOn
    );
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
    const [viewMode, setViewMode] = useState('timeline');
    const [search, setSearch] = useState('');
    const [events, setEvents] = useState<any[]>([]);
    const [followingIds, setFollowingIds] = useState<any[]>([]);
    const [groupNames, setGroupNames] = useState<any>({});
    const [groupProfiles, setGroupProfiles] = useState<any>({});
    const [collapsedGroups, setCollapsedGroups] = useState<any>({});
    const [loading, setLoading] = useState(false);
    const loadRequestRef = useRef(0);

    const calendarNavigationRange = useMemo(() => {
        return {
            startMonth: startOfYear(subYears(visibleMonthDate, 100)),
            endMonth: endOfYear(addYears(visibleMonthDate, 10))
        };
    }, [visibleMonthDate]);
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
    const selectedDayEvents = useMemo(
        () => eventsByDate[selectedDate] || [],
        [eventsByDate, selectedDate]
    );
    const eventsByGroup = useMemo(() => {
        const query = search.trim().toLowerCase();
        const groups = new Map();
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
            groups.get(groupId).push(event);
        }
        return Array.from(groups.entries())
            .map(([groupId, groupEvents]: any) => ({
                groupId,
                groupName: groupNames[groupId] || groupId,
                events: groupEvents.sort((left: any, right: any) =>
                    compareAsc(
                        new Date(left.startsAt),
                        new Date(right.startsAt)
                    )
                )
            }))
            .sort((left: any, right: any) =>
                left.groupName.localeCompare(right.groupName)
            );
    }, [events, groupNames, search]);

    async function resolveGroupNames(rows: any, requestId: any) {
        const ids = Array.from(
            new Set(rows.map(getEventGroupId).filter(Boolean))
        );
        const nextNames: any = {};
        const nextProfiles: any = {};
        await Promise.all(
            ids.map(async (groupId: any) => {
                if (groupNames[groupId]) {
                    nextNames[groupId] = groupNames[groupId];
                    if (groupProfiles[groupId]) {
                        nextProfiles[groupId] = groupProfiles[groupId];
                    }
                    return;
                }
                try {
                    const group = await groupProfileRepository.getGroupProfile({
                        groupId,
                        endpoint: getEndpoint(),
                        includeRoles: false
                    });
                    nextNames[groupId] = group.name || groupId;
                    nextProfiles[groupId] = group;
                } catch {
                    nextNames[groupId] = groupId;
                }
            })
        );
        if (requestId !== loadRequestRef.current) {
            return;
        }
        setGroupNames((current: any) => ({ ...current, ...nextNames }));
        if (Object.keys(nextProfiles).length) {
            setGroupProfiles((current: any) => ({
                ...current,
                ...nextProfiles
            }));
        }
    }

    async function loadCalendar({ force = false }: any = {}) {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        try {
            const params: any = {
                n: 100,
                offset: 0,
                date: formatCalendarRequestDate(visibleMonthDate)
            };
            const [calendarRows, followingRows, featuredRows] =
                await Promise.all([
                    vrchatToolsRepository.getAllGroupCalendars(params, {
                        endpoint: getEndpoint(),
                        force
                    }),
                    vrchatToolsRepository.getAllFollowingGroupCalendars(
                        params,
                        {
                            endpoint: getEndpoint(),
                            force
                        }
                    ),
                    showFeaturedEvents
                        ? vrchatToolsRepository.getAllFeaturedGroupCalendars(
                              params,
                              {
                                  endpoint: getEndpoint(),
                                  force
                              }
                          )
                        : Promise.resolve([])
                ]);
            const normalizedRows = [...calendarRows, ...featuredRows].map(
                (event: any) => ({
                    ...event,
                    title: replaceBioSymbols(event.title || ''),
                    description: replaceBioSymbols(event.description || '')
                })
            );
            if (requestId !== loadRequestRef.current) {
                return;
            }
            setEvents(normalizedRows);
            setFollowingIds(followingRows.map(getEventId).filter(Boolean));
            await resolveGroupNames(
                [...normalizedRows, ...followingRows],
                requestId
            );
        } catch (error) {
            if (requestId !== loadRequestRef.current) {
                return;
            }
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.tools_dialogs.toast.failed_to_load_group_events')
                )
            );
        } finally {
            if (requestId === loadRequestRef.current) {
                setLoading(false);
            }
        }
    }

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
        loadCalendar();
    }, [open, visibleMonthDate, showFeaturedEvents]);

    async function toggleFeatured(nextValue: any) {
        setShowFeaturedEvents(nextValue);
        await configRepository
            .setBool('groupCalendarShowFeaturedEvents', nextValue)
            .catch(() => {});
    }

    async function toggleFollow(event: any) {
        const groupId = getEventGroupId(event);
        const eventId = getEventId(event);
        if (!groupId || !eventId) {
            return;
        }
        const nextFollowing = !followingIds.includes(eventId);
        try {
            await vrchatToolsRepository.followGroupEvent(
                { groupId, eventId, isFollowing: nextFollowing },
                { endpoint: getEndpoint() }
            );
            setFollowingIds((current: any) =>
                updateArrayValue(current, eventId, nextFollowing)
            );
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t(
                        'host.tools_dialogs.toast.failed_to_update_group_event_follow_state'
                    )
                )
            );
        }
    }

    function selectDateKey(nextDateKey: any) {
        setSelectedDate(nextDateKey);
        setVisibleMonthDate((current: any) => {
            const nextMonthDate = monthDateFromKey(nextDateKey);
            return isSameMonth(current, nextMonthDate)
                ? current
                : nextMonthDate;
        });
    }

    function handleCalendarSelect(nextDate: any) {
        if (!nextDate) {
            return;
        }
        selectDateKey(calendarDateKey(nextDate, calendarTimeZone));
    }

    function handleCalendarMonthChange(nextMonth: any) {
        const nextDateKey = calendarDateKey(nextMonth, calendarTimeZone);
        setVisibleMonthDate(monthDateFromKey(nextDateKey));
        setSelectedDate((current: any) =>
            isSameMonth(
                dateKeyToLocalDate(current),
                monthDateFromKey(nextDateKey)
            )
                ? current
                : nextDateKey
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
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
                    <Input
                        type="date"
                        value={selectedDate}
                        className="w-auto"
                        onChange={(event: any) =>
                            selectDateKey(
                                event.target.value ||
                                    selectedDateKey(new Date())
                            )
                        }
                    />
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="group-calendar-featured-events"
                            checked={showFeaturedEvents}
                            onCheckedChange={(checked: any) => {
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
                            loadCalendar({ force: true });
                        }}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('common.actions.refresh')}
                    </Button>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={viewMode}
                        onValueChange={(nextValue: any) => {
                            if (nextValue) {
                                setViewMode(nextValue);
                            }
                        }}
                    >
                        <ToggleGroupItem value="timeline">
                            {t('dialog.group_calendar.list_view')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="grid">
                            {t('dialog.group_calendar.calendar_view')}
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                {viewMode === 'timeline' ? (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_32rem]">
                        <ScrollArea className="h-[52vh] rounded-md border p-4">
                            {selectedDayEvents.length ? (
                                selectedDayEvents.map((event: any) => (
                                    <GroupEventCard
                                        key={getEventId(event)}
                                        event={event}
                                        mode="timeline"
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
                                        isFollowing={followingIds.includes(
                                            getEventId(event)
                                        )}
                                        onToggleFollow={() => {
                                            toggleFollow(event);
                                        }}
                                    />
                                ))
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
                        <Calendar
                            mode="single"
                            required
                            selected={selectedDateValue}
                            month={visibleMonthDate}
                            onSelect={handleCalendarSelect}
                            onMonthChange={handleCalendarMonthChange}
                            captionLayout="dropdown"
                            navLayout="after"
                            startMonth={calendarNavigationRange.startMonth}
                            endMonth={calendarNavigationRange.endMonth}
                            timeZone={calendarTimeZone}
                            locale={calendarLocale}
                            weekStartsOn={weekStartsOn}
                            className="mx-auto rounded-lg border p-2 [--cell-size:--spacing(10)] sm:p-3 sm:[--cell-size:--spacing(12)] lg:[--cell-size:--spacing(15)] xl:[--cell-size:--spacing(16)]"
                            classNames={{
                                month: 'flex w-full flex-col gap-3',
                                dropdowns:
                                    'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-semibold sm:text-base',
                                caption_label:
                                    '[&>svg]:text-muted-foreground flex items-center gap-1 rounded-(--cell-radius) text-sm font-semibold select-none [&>svg]:size-3.5 sm:text-base',
                                weekdays: 'flex gap-0.5 sm:gap-1',
                                weekday:
                                    'text-muted-foreground/70 flex-1 rounded-md text-xs font-medium select-none',
                                week: 'mt-1 flex w-full gap-0.5 sm:gap-1',
                                today: 'rounded-(--cell-radius) bg-accent/30 text-foreground data-[selected=true]:bg-transparent'
                            }}
                            components={{
                                DayButton: (props: any) => (
                                    <GroupCalendarDayButton
                                        {...props}
                                        eventsByDate={eventsByDate}
                                        followedCountByDate={
                                            followedCountByDate
                                        }
                                        locale={calendarLocale}
                                        timeZone={calendarTimeZone}
                                    />
                                )
                            }}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <Input
                            value={search}
                            placeholder={t(
                                'dialog.group_calendar.search_placeholder'
                            )}
                            onChange={(event: any) =>
                                setSearch(event.target.value)
                            }
                        />
                        <ScrollArea className="h-[55vh] rounded-md border p-4">
                            {eventsByGroup.length ? (
                                eventsByGroup.map((group: any) => (
                                    <div
                                        key={group.groupId}
                                        className="mb-4 flex flex-col gap-2"
                                    >
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="justify-start px-0"
                                            onClick={() =>
                                                setCollapsedGroups(
                                                    (current: any) => ({
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
                                            {group.groupName}
                                        </Button>
                                        {!collapsedGroups[group.groupId] ? (
                                            <div className="grid gap-3 md:grid-cols-2">
                                                {group.events.map(
                                                    (event: any) => (
                                                        <GroupEventCard
                                                            key={getEventId(
                                                                event
                                                            )}
                                                            event={event}
                                                            mode="grid"
                                                            groupName={
                                                                group.groupName
                                                            }
                                                            groupProfile={
                                                                groupProfiles[
                                                                    getEventGroupId(
                                                                        event
                                                                    )
                                                                ]
                                                            }
                                                            isFollowing={followingIds.includes(
                                                                getEventId(
                                                                    event
                                                                )
                                                            )}
                                                            onToggleFollow={() => {
                                                                toggleFollow(
                                                                    event
                                                                );
                                                            }}
                                                        />
                                                    )
                                                )}
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
