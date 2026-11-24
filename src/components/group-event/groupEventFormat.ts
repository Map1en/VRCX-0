import { formatDateTime } from '@/lib/dateTime';
import type {
    GroupCalendarEventRecord,
    GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
};
const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit'
};

export type GroupEventStatus = 'live' | 'upcoming' | 'ended';

export const EVENT_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

const CANCELLED_TITLE_PATTERN = /^\s*[([]?\s*cancell?ed\b/i;

export function formatEventRange(
    event: GroupCalendarEventRecord,
    { withDate = true }: { withDate?: boolean } = {}
) {
    if (!event.startsAt) {
        return '';
    }
    const start = formatDateTime(
        event.startsAt,
        withDate ? DATE_TIME_OPTIONS : TIME_OPTIONS,
        { fallback: '' }
    );
    if (!event.endsAt) {
        return start;
    }
    const sameDay =
        new Date(event.startsAt).toDateString() ===
        new Date(event.endsAt).toDateString();
    const end = formatDateTime(
        event.endsAt,
        sameDay ? TIME_OPTIONS : DATE_TIME_OPTIONS,
        { fallback: '' }
    );
    return end ? `${start} - ${end}` : start;
}

export function eventStatus(
    event: GroupCalendarEventRecord,
    nowMs: number
): GroupEventStatus | null {
    const startMs = new Date(event.startsAt || '').getTime();
    if (Number.isNaN(startMs)) {
        return null;
    }
    const endMs = new Date(event.endsAt || '').getTime();
    const finishMs = Number.isNaN(endMs) ? startMs : endMs;
    if (nowMs >= finishMs) {
        return 'ended';
    }
    return nowMs >= startMs ? 'live' : 'upcoming';
}

export function eventImageUrl(
    event: GroupCalendarEventRecord,
    groupProfile: GroupCalendarGroupRecord | null | undefined,
    resolution: number
) {
    return convertFileUrlToImageUrl(
        event.imageUrl ||
            event.thumbnailImageUrl ||
            groupProfile?.bannerUrl ||
            groupProfile?.iconUrl ||
            '',
        resolution
    );
}

export function isCancelledEvent(event: GroupCalendarEventRecord) {
    return CANCELLED_TITLE_PATTERN.test(event.title || '');
}

export function getEventGroupId(event: GroupCalendarEventRecord | null) {
    return event?.ownerId || event?.groupId || event?.group?.id || '';
}

export function getEventId(event: GroupCalendarEventRecord | null) {
    return event?.id || event?.eventId || '';
}
