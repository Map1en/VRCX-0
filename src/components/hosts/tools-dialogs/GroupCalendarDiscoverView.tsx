import { RefreshCwIcon } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import {
    commands,
    type CalendarDiscoverParams,
    type CalendarDiscoverScope,
    type CalendarDiscoverSort
} from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import type {
    GroupCalendarEventRecord,
    GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { openGroupDialog } from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { isRecord } from '@/shared/utils/record';
import { replaceBioSymbols } from '@/shared/utils/string';
import { Button } from '@/ui/shadcn/button';
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/shadcn/empty';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { GroupEventRow } from './GroupEventRow';
import { getEventGroupId, getEventId } from './toolsDialogUtils';

const DISCOVER_PAGE_SIZE = 30;

type DiscoverPage = {
    nextCursor?: unknown;
    results?: unknown;
};

function normalizeDiscoverEvent(
    event: Record<string, unknown>
): GroupCalendarEventRecord {
    return {
        ...event,
        title: replaceBioSymbols(
            typeof event.title === 'string' ? event.title : ''
        ),
        description: replaceBioSymbols(
            typeof event.description === 'string' ? event.description : ''
        )
    };
}

function isFollowedByCurrentUser(event: GroupCalendarEventRecord) {
    return (
        isRecord(event.userInterest) && event.userInterest.isFollowing === true
    );
}

function ownerGroupProfile(
    event: GroupCalendarEventRecord,
    groupId: string
): GroupCalendarGroupRecord {
    return {
        id: groupId,
        name: typeof event.ownerName === 'string' ? event.ownerName : '',
        iconUrl:
            typeof event.ownerIconUrl === 'string' ? event.ownerIconUrl : ''
    };
}

export function GroupCalendarDiscoverView({
    followingIds,
    groupNames,
    groupProfiles,
    onFollowedEvents,
    onToggleFollow
}: {
    followingIds: ReadonlySet<string>;
    groupNames: Record<string, string>;
    groupProfiles: Record<string, GroupCalendarGroupRecord>;
    onFollowedEvents(eventIds: string[]): void;
    onToggleFollow(event: GroupCalendarEventRecord): void;
}) {
    const { t } = useTranslation();
    const [scope, setScope] = useState<CalendarDiscoverScope>('upcoming');
    const [sort, setSort] = useState<CalendarDiscoverSort>(
        'startTime_ascending'
    );
    const [linkedInstanceOnly, setLinkedInstanceOnly] = useState(false);
    const [events, setEvents] = useState<GroupCalendarEventRecord[]>([]);
    const [nextCursor, setNextCursor] = useState('');
    const [loading, setLoading] = useState(false);
    const requestRef = useRef(0);

    async function loadEvents(append: boolean) {
        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        setLoading(true);
        const params: CalendarDiscoverParams = {
            scope,
            n: DISCOVER_PAGE_SIZE,
            upcomingSort: scope === 'upcoming' ? sort : null,
            requireLinkedInstance: linkedInstanceOnly || null,
            nextCursor: append ? nextCursor : null
        };
        try {
            const page = unwrapVrchatResponse<DiscoverPage>(
                await commands.appVrchatToolsCalendarDiscoverGet({ params }),
                'calendar/discover',
                { fallbackMessage: 'VRChat tool request failed' }
            ).json;
            if (requestId !== requestRef.current) {
                return;
            }
            const rows = (Array.isArray(page.results) ? page.results : [])
                .filter(isRecord)
                .map(normalizeDiscoverEvent);
            setEvents((current) => (append ? [...current, ...rows] : rows));
            setNextCursor(
                typeof page.nextCursor === 'string' ? page.nextCursor : ''
            );
            onFollowedEvents(
                rows.filter(isFollowedByCurrentUser).map(getEventId)
            );
        } catch (error) {
            if (requestId !== requestRef.current) {
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
            if (requestId === requestRef.current) {
                setLoading(false);
            }
        }
    }

    const reloadEvents = useEffectEvent(() => loadEvents(false));

    useEffect(() => {
        reloadEvents();
    }, [scope, sort, linkedInstanceOnly]);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup
                    variant="outline"
                    size="sm"
                    value={[scope]}
                    onValueChange={(nextValue) => {
                        if (
                            nextValue[0] === 'live' ||
                            nextValue[0] === 'upcoming'
                        ) {
                            setScope(nextValue[0]);
                        }
                    }}
                >
                    <ToggleGroupItem value="live">
                        {t('dialog.group_calendar.discover.live')}
                    </ToggleGroupItem>
                    <ToggleGroupSeparator />
                    <ToggleGroupItem value="upcoming">
                        {t('dialog.group_calendar.discover.upcoming')}
                    </ToggleGroupItem>
                </ToggleGroup>
                {scope === 'upcoming' ? (
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={[sort]}
                        onValueChange={(nextValue) => {
                            if (
                                nextValue[0] === 'startTime_ascending' ||
                                nextValue[0] === 'follows_descending'
                            ) {
                                setSort(nextValue[0]);
                            }
                        }}
                    >
                        <ToggleGroupItem value="startTime_ascending">
                            {t(
                                'dialog.group_calendar.discover.sort_start_time'
                            )}
                        </ToggleGroupItem>
                        <ToggleGroupSeparator />
                        <ToggleGroupItem value="follows_descending">
                            {t('dialog.group_calendar.discover.sort_follows')}
                        </ToggleGroupItem>
                    </ToggleGroup>
                ) : null}
                <Field orientation="horizontal" className="w-auto">
                    <Switch
                        id="group-calendar-discover-linked-instance"
                        checked={linkedInstanceOnly}
                        onCheckedChange={setLinkedInstanceOnly}
                    />
                    <FieldLabel htmlFor="group-calendar-discover-linked-instance">
                        {t(
                            'dialog.group_calendar.discover.linked_instance_only'
                        )}
                    </FieldLabel>
                </Field>
                <Button
                    type="button"
                    variant="outline"
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => {
                        loadEvents(false);
                    }}
                >
                    <RefreshCwIcon data-icon="inline-start" />
                    {t('common.actions.refresh')}
                </Button>
            </div>
            <ScrollArea className="h-[55vh]">
                {events.length ? (
                    <div className="flex flex-col gap-3 pr-3">
                        <div className="grid gap-2 md:grid-cols-2">
                            {events.map((event) => {
                                const groupId = getEventGroupId(event);
                                const profile =
                                    groupProfiles[groupId] ??
                                    ownerGroupProfile(event, groupId);
                                return (
                                    <GroupEventRow
                                        key={getEventId(event)}
                                        events={[event]}
                                        groupName={
                                            groupNames[groupId] ||
                                            profile.name ||
                                            groupId
                                        }
                                        groupProfile={profile}
                                        followingIds={followingIds}
                                        variant="series"
                                        onOpen={
                                            groupId
                                                ? () =>
                                                      openGroupDialog({
                                                          groupId
                                                      })
                                                : undefined
                                        }
                                        onToggleFollow={onToggleFollow}
                                    />
                                );
                            })}
                        </div>
                        {nextCursor ? (
                            <Button
                                type="button"
                                variant="outline"
                                className="self-center"
                                disabled={loading}
                                onClick={() => {
                                    loadEvents(true);
                                }}
                            >
                                {t('common.load_more')}
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <Empty className="h-40 border-0 p-4">
                        <EmptyHeader>
                            <EmptyTitle>
                                {loading
                                    ? t('dialog.group_calendar.loading_events')
                                    : t('dialog.group_calendar.no_events')}
                            </EmptyTitle>
                        </EmptyHeader>
                    </Empty>
                )}
            </ScrollArea>
        </div>
    );
}
