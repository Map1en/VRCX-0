// @ts-nocheck
import { ChevronDownIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enUS } from 'react-day-picker/locale/en-US';
import { ja } from 'react-day-picker/locale/ja';
import { zhCN } from 'react-day-picker/locale/zh-CN';
import { toast } from 'sonner';

import dayjs from '@/lib/dayjs.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import {
    configRepository,
    groupProfileRepository,
    toolsRepository
} from '@/repositories/index.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
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

import { GroupEventCard } from './GroupEventCard';
import {
    getEndpoint,
    getEventGroupId,
    getEventId,
    selectedDateKey,
    updateArrayValue
} from './toolsDialogUtils.js';

function getLocalTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function dateKeyToLocalDate(dateKey) {
    const parsed = dayjs(dateKey, 'YYYY-MM-DD', true);
    return (parsed.isValid() ? parsed : dayjs()).startOf('day').toDate();
}

function monthDateFromKey(dateKey) {
    return dayjs(dateKeyToLocalDate(dateKey)).startOf('month').toDate();
}

function calendarDateKey(value, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(value || new Date());
        const values = Object.fromEntries(
            parts
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, part.value])
        );
        if (values.year && values.month && values.day) {
            return `${values.year}-${values.month}-${values.day}`;
        }
    } catch {
        // Fall back to dayjs local formatting if Intl cannot resolve the zone.
    }
    return selectedDateKey(value || new Date());
}

function formatCalendarRequestDate(value) {
    return dayjs(value).format('YYYY-MM-DDTHH:mm:ss[Z]');
}

function calendarLocaleForLanguage(language) {
    const normalized = String(language || '')
        .replace('_', '-')
        .toLowerCase();
    if (normalized.startsWith('zh')) {
        return zhCN;
    }
    if (normalized.startsWith('ja')) {
        return ja;
    }
    return enUS;
}

function GroupCalendarDayButton({
    className,
    day,
    modifiers,
    locale,
    eventsByDate,
    followedCountByDate,
    timeZone,
    t,
    ...props
}) {
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
                'h-(--cell-size) min-h-(--cell-size) items-center justify-between gap-0.5 rounded-md bg-transparent p-1.5 text-foreground transition-colors hover:bg-accent/40 hover:text-foreground data-[selected-single=true]:bg-accent/30! data-[selected-single=true]:text-foreground! data-[selected-single=true]:ring-1 data-[selected-single=true]:ring-muted-foreground/60 sm:gap-1 sm:p-2'
            )}
            aria-label={`${dateKey}, ${eventText}, ${followedText}`}
        >
            <div
                className={cn(
                    'flex h-5 w-full items-center justify-center text-sm leading-none font-semibold tabular-nums sm:h-6 sm:text-[17px]',
                    isOutsideDay && 'text-muted-foreground/50'
                )}
            >
                {dayjs(dateKeyToLocalDate(dateKey)).format('D')}
            </div>
            <div className="grid h-3.5 w-full grid-cols-2 items-center gap-1.5 text-[10px] leading-none tabular-nums sm:gap-2 sm:text-[11px]">
                {visibleEventCount ? (
                    <span className="min-w-3 text-center font-semibold text-platform-pc">
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

export function GroupCalendarDialog({ open, onOpenChange }) {
    const { t, i18n } = useTranslation();
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
    const [viewMode, setViewMode] = useState('timeline');
    const [search, setSearch] = useState('');
    const [events, setEvents] = useState([]);
    const [followingIds, setFollowingIds] = useState([]);
    const [groupNames, setGroupNames] = useState({});
    const [groupProfiles, setGroupProfiles] = useState({});
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const [loading, setLoading] = useState(false);
    const loadRequestRef = useRef(0);

    const calendarNavigationRange = useMemo(() => {
        const anchor = dayjs(visibleMonthDate);
        return {
            startMonth: anchor.subtract(100, 'year').startOf('year').toDate(),
            endMonth: anchor.add(10, 'year').endOf('year').toDate()
        };
    }, [visibleMonthDate]);
    const selectedDateValue = useMemo(
        () => dateKeyToLocalDate(selectedDate),
        [selectedDate]
    );
    const eventsByDate = useMemo(() => {
        const result = {};
        for (const event of events) {
            const dateKey = selectedDateKey(event.startsAt);
            if (!Array.isArray(result[dateKey])) {
                result[dateKey] = [];
            }
            result[dateKey].push(event);
        }
        for (const rows of Object.values(result)) {
            rows.sort((left, right) =>
                dayjs(left.startsAt).diff(dayjs(right.startsAt))
            );
        }
        return result;
    }, [events]);
    const followedCountByDate = useMemo(() => {
        const followedSet = new Set(followingIds);
        const result = {};
        for (const event of events) {
            const eventId = getEventId(event);
            if (!eventId || !followedSet.has(eventId)) {
                continue;
            }
            const dateKey = selectedDateKey(event.startsAt);
            result[dateKey] = (result[dateKey] ?? 0) + 1;
        }
        return result;
    }, [events, followingIds]);
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
            .map(([groupId, groupEvents]) => ({
                groupId,
                groupName: groupNames[groupId] || groupId,
                events: groupEvents.sort((left, right) =>
                    dayjs(left.startsAt).diff(dayjs(right.startsAt))
                )
            }))
            .sort((left, right) =>
                left.groupName.localeCompare(right.groupName)
            );
    }, [events, groupNames, search]);

    async function resolveGroupNames(rows, requestId) {
        const ids = Array.from(
            new Set(rows.map(getEventGroupId).filter(Boolean))
        );
        const nextNames = {};
        const nextProfiles = {};
        await Promise.all(
            ids.map(async (groupId) => {
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
        setGroupNames((current) => ({ ...current, ...nextNames }));
        if (Object.keys(nextProfiles).length) {
            setGroupProfiles((current) => ({ ...current, ...nextProfiles }));
        }
    }

    async function loadCalendar({ force = false } = {}) {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        try {
            const params = {
                n: 100,
                offset: 0,
                date: formatCalendarRequestDate(visibleMonthDate)
            };
            const [calendarRows, followingRows, featuredRows] =
                await Promise.all([
                    toolsRepository.getAllGroupCalendars(params, {
                        endpoint: getEndpoint(),
                        force
                    }),
                    toolsRepository.getAllFollowingGroupCalendars(params, {
                        endpoint: getEndpoint(),
                        force
                    }),
                    showFeaturedEvents
                        ? toolsRepository.getAllFeaturedGroupCalendars(params, {
                              endpoint: getEndpoint(),
                              force
                          })
                        : Promise.resolve([])
                ]);
            const normalizedRows = [...calendarRows, ...featuredRows].map(
                (event) => ({
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
                    t(
                        'host.tools_dialogs.toast.failed_to_load_group_events'
                    )
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
        void loadCalendar();
    }, [open, visibleMonthDate, showFeaturedEvents]);

    async function toggleFeatured(nextValue) {
        setShowFeaturedEvents(nextValue);
        await configRepository
            .setBool('groupCalendarShowFeaturedEvents', nextValue)
            .catch(() => {});
    }

    async function toggleFollow(event) {
        const groupId = getEventGroupId(event);
        const eventId = getEventId(event);
        if (!groupId || !eventId) {
            return;
        }
        const nextFollowing = !followingIds.includes(eventId);
        try {
            await toolsRepository.followGroupEvent(
                { groupId, eventId, isFollowing: nextFollowing },
                { endpoint: getEndpoint() }
            );
            setFollowingIds((current) =>
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

    function selectDateKey(nextDateKey) {
        setSelectedDate(nextDateKey);
        setVisibleMonthDate((current) => {
            const nextMonthDate = monthDateFromKey(nextDateKey);
            return dayjs(current).isSame(nextMonthDate, 'month')
                ? current
                : nextMonthDate;
        });
    }

    function handleCalendarSelect(nextDate) {
        if (!nextDate) {
            return;
        }
        selectDateKey(calendarDateKey(nextDate, calendarTimeZone));
    }

    function handleCalendarMonthChange(nextMonth) {
        const nextDateKey = calendarDateKey(nextMonth, calendarTimeZone);
        setVisibleMonthDate(monthDateFromKey(nextDateKey));
        setSelectedDate((current) =>
            dayjs(current).isSame(nextDateKey, 'month') ? current : nextDateKey
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
                            ? 'Loading group events.'
                            : 'Group calendar events for the selected date and month.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-3">
                    <Input
                        type="date"
                        value={selectedDate}
                        className="w-auto"
                        onChange={(event) =>
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
                            onCheckedChange={(checked) =>
                                void toggleFeatured(checked)
                            }
                        />
                        <FieldLabel htmlFor="group-calendar-featured-events">
                            {t('dialog.group_calendar.featured_events')}
                        </FieldLabel>
                    </Field>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void loadCalendar({ force: true })}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('common.actions.refresh')}
                    </Button>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={viewMode}
                        onValueChange={(nextValue) => {
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
                                selectedDayEvents.map((event) => (
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
                                        onToggleFollow={() =>
                                            void toggleFollow(event)
                                        }
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
                                DayButton: (props) => (
                                    <GroupCalendarDayButton
                                        {...props}
                                        eventsByDate={eventsByDate}
                                        followedCountByDate={
                                            followedCountByDate
                                        }
                                        locale={calendarLocale}
                                        timeZone={calendarTimeZone}
                                        t={t}
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
                            onChange={(event) => setSearch(event.target.value)}
                        />
                        <ScrollArea className="h-[55vh] rounded-md border p-4">
                            {eventsByGroup.length ? (
                                eventsByGroup.map((group) => (
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
                                            {group.groupName}
                                        </Button>
                                        {!collapsedGroups[group.groupId] ? (
                                            <div className="grid gap-3 md:grid-cols-2">
                                                {group.events.map((event) => (
                                                    <GroupEventCard
                                                        key={getEventId(event)}
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
                                                            getEventId(event)
                                                        )}
                                                        onToggleFollow={() =>
                                                            void toggleFollow(
                                                                event
                                                            )
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
