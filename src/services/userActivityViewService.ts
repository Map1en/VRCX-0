import type { UserActivityStatusDistribution } from '@/components/dialogs/user-dialog/userActivityPanelModel';
import { commands } from '@/platform/tauri/bindings';
import gameLogRepository from '@/repositories/gameLogRepository';

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

type LoadTopWorldsViewOptions = {
    excludeWorldId?: string;
    limit?: number;
    rangeDays?: number;
    sortBy?: string;
};
type TopWorldRows = Awaited<
    ReturnType<typeof gameLogRepository.getMyTopWorlds>
>;

type UserActivityViewService = {
    loadActivityView(options: LoadActivityViewOptions): Promise<
        ActivityBuckets & {
            filteredEventCount?: number;
            hasAnyData: boolean;
            peakDay?: string;
            peakTime?: string;
            statusDistribution: UserActivityStatusDistribution;
        }
    >;
    loadOverlapView(options: LoadOverlapViewOptions): Promise<
        ActivityBuckets & {
            bestOverlapTime?: string;
            hasOverlapData: boolean;
            overlapPercent?: number;
        }
    >;
    loadTopWorldsView(options: LoadTopWorldsViewOptions): Promise<TopWorldRows>;
};

function normalizeNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNumberArray(value: unknown): number[] {
    return Array.isArray(value) ? value.map(normalizeNumber) : [];
}

function normalizeStatusDistribution(
    value: unknown
): UserActivityStatusDistribution {
    const source =
        value && typeof value === 'object'
            ? (value as Record<string, unknown>)
            : {};
    const joinMeCount = Math.max(0, normalizeNumber(source.joinMeCount));
    const activeCount = Math.max(0, normalizeNumber(source.activeCount));
    const askMeCount = Math.max(0, normalizeNumber(source.askMeCount));
    const busyCount = Math.max(0, normalizeNumber(source.busyCount));
    return {
        joinMeCount,
        activeCount,
        askMeCount,
        busyCount,
        totalCount: joinMeCount + activeCount + askMeCount + busyCount
    };
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

function optionalHour(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
        hasAnyData: Boolean(output.hasAnyData),
        filteredEventCount: normalizeNumber(output.filteredEventCount),
        peakDay,
        peakTime,
        rawBuckets: normalizeNumberArray(output.rawBuckets),
        normalizedBuckets: normalizeNumberArray(output.normalizedBuckets),
        statusDistribution: normalizeStatusDistribution(
            output.statusDistribution
        )
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
        hasOverlapData: Boolean(output.hasOverlapData),
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

async function loadTopWorldsView({
    rangeDays = 30,
    limit = 5,
    sortBy = 'time',
    excludeWorldId = ''
}: LoadTopWorldsViewOptions) {
    return gameLogRepository.getMyTopWorlds(
        rangeDays,
        limit,
        sortBy,
        excludeWorldId
    );
}

const userActivityViewService: UserActivityViewService = {
    loadActivityView,
    loadOverlapView,
    loadTopWorldsView
};

export { userActivityViewService };
