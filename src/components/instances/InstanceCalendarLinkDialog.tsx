import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    extractGroupEventRows,
    normalizeGroupEvent
} from '@/components/dialogs/group-dialog/groupDialogUtils';
import { formatEventRange } from '@/components/group-event/groupEventFormat';
import { getEventId } from '@/components/group-event/groupEventFormat';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import vrchatToolsRepository, {
    type GroupCalendarEventRecord
} from '@/repositories/vrchatToolsRepository';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';

const LINK_WINDOW_MS = 6 * 60 * 60 * 1000;

export function linkableCalendarEvents(
    events: GroupCalendarEventRecord[],
    nowMs: number
) {
    return events
        .filter((event) => {
            const startsAt = Date.parse(event.startsAt || '');
            const endsAt = Date.parse(event.endsAt || '');
            return (
                Number.isFinite(startsAt) &&
                Number.isFinite(endsAt) &&
                startsAt <= nowMs + LINK_WINDOW_MS &&
                endsAt >= nowMs - LINK_WINDOW_MS
            );
        })
        .sort(
            (left, right) =>
                Date.parse(left.startsAt || '') -
                Date.parse(right.startsAt || '')
        );
}

export function InstanceCalendarLinkDialog({
    open,
    groupId,
    currentEventId,
    busy,
    onOpenChange,
    onSubmit
}: {
    open: boolean;
    groupId: string;
    currentEventId: string;
    busy: boolean;
    onOpenChange(open: boolean): void;
    onSubmit(eventId: string | null): Promise<boolean>;
}) {
    const { t } = useTranslation();
    const [events, setEvents] = useState<GroupCalendarEventRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedEventId, setSelectedEventId] = useState('');

    useEffect(() => {
        if (!open || !groupId) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        setError('');
        setEvents([]);
        setSelectedEventId(currentEventId);
        vrchatToolsRepository
            .getGroupCalendar({ groupId }, { force: true })
            .then((response) => {
                if (!active) {
                    return;
                }
                const rows = linkableCalendarEvents(
                    extractGroupEventRows(response).map((event) =>
                        normalizeGroupEvent(event, groupId)
                    ),
                    Date.now()
                );
                setEvents(rows);
                if (!currentEventId && rows[0]) {
                    setSelectedEventId(getEventId(rows[0]));
                }
            })
            .catch((loadError: unknown) => {
                if (active) {
                    setError(
                        userFacingErrorMessage(
                            loadError,
                            t('dialog.group.events.failed_to_load')
                        )
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEventId, groupId, open, t]);

    const eventLabel = (event: GroupCalendarEventRecord) =>
        `${event.title || getEventId(event)} (${formatEventRange(event)})`;

    async function submit(eventId: string | null) {
        if (await onSubmit(eventId)) {
            onOpenChange(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'component.instance_action_bar.calendar_link.header'
                        )}
                    </DialogTitle>
                </DialogHeader>
                {loading ? (
                    <div className="flex min-h-16 items-center justify-center">
                        <Spinner aria-label={t('common.loading')} />
                    </div>
                ) : error ? (
                    <p className="text-muted-foreground text-sm">{error}</p>
                ) : events.length ? (
                    <Select
                        value={selectedEventId || null}
                        items={events.map((event) => ({
                            value: getEventId(event),
                            label: eventLabel(event)
                        }))}
                        onValueChange={(value) =>
                            setSelectedEventId(value ?? '')
                        }
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue
                                placeholder={t(
                                    'component.instance_action_bar.calendar_link.event'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {events.map((event) => (
                                    <SelectItem
                                        key={getEventId(event)}
                                        value={getEventId(event)}
                                    >
                                        {eventLabel(event)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                ) : (
                    <p className="text-muted-foreground text-sm">
                        {t(
                            'component.instance_action_bar.calendar_link.no_events'
                        )}
                    </p>
                )}
                <DialogFooter>
                    {currentEventId ? (
                        <Button
                            type="button"
                            variant="destructive"
                            className="sm:mr-auto"
                            disabled={busy}
                            onClick={() => void submit(null)}
                        >
                            {t(
                                'component.instance_action_bar.calendar_link.remove'
                            )}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={
                            busy ||
                            loading ||
                            !selectedEventId ||
                            selectedEventId === currentEventId
                        }
                        onClick={() => void submit(selectedEventId)}
                    >
                        {t(
                            'component.instance_action_bar.calendar_link.assign'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
