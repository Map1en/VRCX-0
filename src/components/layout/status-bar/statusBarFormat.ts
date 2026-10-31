import { formatDateTime } from '@/lib/dateTime';
import {
    SECOND_MS,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE
} from '@/shared/constants/time';

function durationParts(ms: number) {
    const safeSeconds = Math.max(0, Math.floor(ms / SECOND_MS));
    const hours = Math.floor(safeSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor(
        (safeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    );
    const seconds = safeSeconds % SECONDS_PER_MINUTE;
    return { hours, minutes, seconds };
}

export function formatDuration(ms: number) {
    const { hours, minutes, seconds } = durationParts(ms);
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatAppUptime(ms: number) {
    const { hours, minutes, seconds } = durationParts(ms);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatStatusDate(value: string | null | undefined) {
    return formatDateTime(value, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
