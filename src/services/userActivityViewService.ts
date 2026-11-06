import { commands } from '@/platform/tauri/bindings';

type ActivityBuckets = {
    rawBuckets: number[];
    normalizedBuckets: number[];
};

type ExcludeHours = {
    enabled?: boolean;
    startHour: number;
    endHour: number;
};

type LoadActivityViewOptions = {
    dayLabels: string[];
    forceRefresh?: boolean;
    isSelf?: boolean;
    ownerUserId?: string;
    rangeDays?: number;
    userId: string;
};

type LoadOverlapViewOptions = {
    currentUserId: string;
    dayLabels: string[];
    excludeHours?: ExcludeHours | null;
    forceRefresh?: boolean;
    ownerUserId?: string;
    rangeDays?: number;
    targetUserId: string;
};

type UserActivityViewService = {
    loadActivityView(options: LoadActivityViewOptions): Promise<
        ActivityBuckets & {
            filteredEventCount?: number;
            hasAnyData: boolean;
            peakDay?: string;
            peakTime?: string;
        }
    >;
    loadOverlapView(options: LoadOverlapViewOptions): Promise<
        ActivityBuckets & {
            bestOverlapTime?: string;
            hasOverlapData: boolean;
            overlapPercent?: number;
        }
    >;
};

function normalizeNumber(value: number | null): number {
    return value !== null && Number.isFinite(value) ? value : 0;
}

function normalizeNumberArray(value: readonly (number | null)[]): number[] {
    return value.map(normalizeNumber);
}

function utcOffsetMinutes() {
    return -new Date().getTimezoneOffset();
}

function dayLabel(dayLabels: string[], index: number): string {
    return index >= 0 && index < dayLabels.length ? dayLabels[index] : '';
}

function hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
}

function formatPeakTime(startHour: number, endHour: number): string {
    if (startHour < 0 || endHour <= startHour) {
        return '';
    }
    if (endHour - startHour === 1) {
        return hourLabel(startHour);
    }
    return `${hourLabel(startHour)}-${hourLabel(endHour)}`;
}

function formatBestOverlapTime(
    dayLabels: string[],
    dayIndex: number,
    startHour: number,
    endHour: number
): string {
    const label = dayLabel(dayLabels, dayIndex);
    if (!label || startHour < 0 || endHour <= startHour) {
        return '';
    }
    return `${label}, ${hourLabel(startHour)}-${hourLabel(endHour)}`;
}

function optionalHour(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function loadActivityView({
    userId,
    ownerUserId = '',
    isSelf = false,
    rangeDays = 30,
    dayLabels,
    forceRefresh = false
}: LoadActivityViewOptions) {
    const nowMs = Date.now();
    const output = await commands.appActivityView({
        ownerUserId: ownerUserId || userId,
        targetUserId: userId,
        isSelf,
        rangeDays,
        utcOffsetMinutes: utcOffsetMinutes(),
        nowMs,
        forceRefresh
    });

    const peakDay = dayLabel(dayLabels, output.peakDayIndex);
    const peakTime = formatPeakTime(output.peakHourStart, output.peakHourEnd);

    return {
        hasAnyData: output.hasAnyData,
        filteredEventCount: normalizeNumber(output.filteredEventCount),
        peakDay,
        peakTime,
        rawBuckets: normalizeNumberArray(output.rawBuckets),
        normalizedBuckets: normalizeNumberArray(output.normalizedBuckets)
    };
}

async function loadOverlapView({
    currentUserId,
    targetUserId,
    ownerUserId = currentUserId,
    rangeDays = 30,
    dayLabels,
    excludeHours,
    forceRefresh = false
}: LoadOverlapViewOptions) {
    const excludeEnabled = excludeHours?.enabled === true;
    const nowMs = Date.now();
    const output = await commands.appActivityOverlapView({
        ownerUserId,
        currentUserId,
        targetUserId,
        rangeDays,
        utcOffsetMinutes: utcOffsetMinutes(),
        nowMs,
        forceRefresh,
        excludeStartHour: excludeEnabled
            ? optionalHour(excludeHours?.startHour)
            : null,
        excludeEndHour: excludeEnabled
            ? optionalHour(excludeHours?.endHour)
            : null
    });

    return {
        hasOverlapData: output.hasOverlapData,
        overlapPercent: normalizeNumber(output.overlapPercent),
        bestOverlapTime: formatBestOverlapTime(
            dayLabels,
            output.bestDayIndex,
            output.bestHourStart,
            output.bestHourEnd
        ),
        rawBuckets: normalizeNumberArray(output.rawBuckets),
        normalizedBuckets: normalizeNumberArray(output.normalizedBuckets)
    };
}

const userActivityViewService: UserActivityViewService = {
    loadActivityView,
    loadOverlapView
};

export { userActivityViewService };
