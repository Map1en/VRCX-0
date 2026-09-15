export interface DateTimeRangeValue {
    from: Date | null;
    to: Date | null;
}

interface DraftDateRange {
    from?: Date | null;
    to?: Date | null;
}

function normalizeMinuteStep(step: number) {
    const value = Math.floor(step);
    return Number.isFinite(value) && value >= 1 && value <= 60 ? value : 1;
}

export function buildMinuteOptions(step: number) {
    const safeStep = normalizeMinuteStep(step);
    const options: string[] = [];
    for (let minute = 0; minute < 60; minute += safeStep) {
        options.push(String(minute).padStart(2, '0'));
    }
    return options;
}

export function snapMinuteDown(time: string, step: number) {
    const safeStep = normalizeMinuteStep(step);
    const [hours = '00', minutes = '00'] = time.split(':');
    const minute = Number.parseInt(minutes, 10) || 0;
    const snapped = Math.floor(minute / safeStep) * safeStep;
    return `${hours}:${String(snapped).padStart(2, '0')}`;
}

export function slotEndTime(time: string, step: number) {
    const safeStep = normalizeMinuteStep(step);
    const [hours = '00', minutes = '00'] = snapMinuteDown(time, safeStep).split(
        ':'
    );
    const minute = Number.parseInt(minutes, 10) || 0;
    const end = Math.min(59, minute + safeStep - 1);
    return `${hours}:${String(end).padStart(2, '0')}`;
}

export function toTimeValue(date: Date | null | undefined, fallback: string) {
    if (!date) {
        return fallback;
    }
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function stripTime(date: Date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

export function combineDateTime(
    date: Date,
    time: string,
    endOfMinute: boolean
) {
    const [rawHours, rawMinutes] = time.split(':');
    const hours = Number.parseInt(rawHours, 10);
    const minutes = Number.parseInt(rawMinutes, 10);
    const next = new Date(date);
    next.setHours(
        Number.isFinite(hours) ? hours : 0,
        Number.isFinite(minutes) ? minutes : 0,
        endOfMinute ? 59 : 0,
        endOfMinute ? 999 : 0
    );
    return next;
}

export function buildDateTimeRange(
    draftRange: DraftDateRange | null | undefined,
    startTime: string,
    endTime: string
): DateTimeRangeValue {
    if (!draftRange?.from) {
        return { from: null, to: null };
    }
    return {
        from: combineDateTime(draftRange.from, startTime, false),
        to: combineDateTime(draftRange.to || draftRange.from, endTime, true)
    };
}
