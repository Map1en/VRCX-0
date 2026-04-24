import { ChevronDownIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import dayjs from '@/lib/dayjs.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import {
    configRepository,
    groupProfileRepository,
    toolsRepository
} from '@/repositories/index.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { Button } from '@/ui/shadcn/button';
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

import { GroupEventCard } from './GroupEventCard.jsx';
import {
    getEndpoint,
    getEventGroupId,
    getEventId,
    selectedDateKey,
    updateArrayValue
} from './toolsDialogUtils.js';

export function GroupCalendarDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const [selectedDate, setSelectedDate] = useState(() =>
        selectedDateKey(new Date())
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

    const selectedDayEvents = useMemo(
        () =>
            events
                .filter(
                    (event) => selectedDateKey(event.startsAt) === selectedDate
                )
                .sort((left, right) =>
                    dayjs(left.startsAt).diff(dayjs(right.startsAt))
                ),
        [events, selectedDate]
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
                date: dayjs(selectedDate).format('YYYY-MM-DDTHH:mm:ss[Z]')
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
                    t('host.tools_dialogs.generated_toast.failed_to_load_group_events')
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
    }, [open, selectedDate, showFeaturedEvents]);

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
                    t('host.tools_dialogs.generated_toast.failed_to_update_group_event_follow_state')
                )
            );
        }
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
                            setSelectedDate(
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
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            setViewMode((current) =>
                                current === 'timeline' ? 'grid' : 'timeline'
                            )
                        }
                    >
                        {viewMode === 'timeline'
                            ? t('dialog.group_calendar.list_view')
                            : t('dialog.group_calendar.calendar_view')}
                    </Button>
                </div>
                {viewMode === 'timeline' ? (
                    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
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
                        <div className="rounded-md border p-4">
                            <div className="text-sm font-medium">
                                {dayjs(selectedDate).format('MMMM YYYY')}
                            </div>
                            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
                                {Array.from(
                                    {
                                        length: dayjs(
                                            selectedDate
                                        ).daysInMonth()
                                    },
                                    (_, index) => {
                                        const dateKey = dayjs(selectedDate)
                                            .date(index + 1)
                                            .format('YYYY-MM-DD');
                                        const dayEvents = events.filter(
                                            (event) =>
                                                selectedDateKey(
                                                    event.startsAt
                                                ) === dateKey
                                        );
                                        const count = dayEvents.length;
                                        const hasFollowing = dayEvents.some(
                                            (event) =>
                                                followingIds.includes(
                                                    getEventId(event)
                                                )
                                        );
                                        return (
                                            <Button
                                                key={dateKey}
                                                type="button"
                                                variant={
                                                    dateKey === selectedDate
                                                        ? 'default'
                                                        : 'outline'
                                                }
                                                size="sm"
                                                className={cn(
                                                    'relative h-12 flex-col gap-0',
                                                    hasFollowing &&
                                                        'ring-primary ring-1'
                                                )}
                                                onClick={() =>
                                                    setSelectedDate(dateKey)
                                                }
                                            >
                                                <span>{index + 1}</span>
                                                {count ? (
                                                    <span className="text-xs">
                                                        {count}
                                                    </span>
                                                ) : null}
                                                {hasFollowing ? (
                                                    <span className="bg-primary absolute top-1 right-1 size-1.5 rounded-full" />
                                                ) : null}
                                            </Button>
                                        );
                                    }
                                )}
                            </div>
                        </div>
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
