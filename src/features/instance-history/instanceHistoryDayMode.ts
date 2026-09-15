import {
    createdTime,
    rowDurationValue,
    rowLocation
} from '@/components/dialogs/previous-instances-table/previousInstancesRows';

import { toLocalDayKey } from './instance-activity/instanceActivityDate';
import type {
    InstanceActivityChartRow,
    InstanceHistoryEntryRow
} from './instance-activity/instanceActivityTypes';

export type InstanceHistoryMode = 'search' | 'day';

export function sanitizeInstanceHistoryMode(
    value: unknown
): InstanceHistoryMode {
    return value === 'day' ? 'day' : 'search';
}

function previousInstanceLeaveMs(row: InstanceHistoryEntryRow): number {
    const groupedLeaveValue = row.last_ts ?? row.lastTs ?? 0;
    const groupedLeaveMs =
        typeof groupedLeaveValue === 'string'
            ? Number(groupedLeaveValue) || new Date(groupedLeaveValue).getTime()
            : Number(groupedLeaveValue);
    if (Number.isFinite(groupedLeaveMs) && groupedLeaveMs > 0) {
        return groupedLeaveMs;
    }
    return createdTime(row);
}

function previousInstanceJoinMs(row: InstanceHistoryEntryRow): number {
    const leaveMs = previousInstanceLeaveMs(row);
    return leaveMs - rowDurationValue(row);
}

export function buildAvailableInstanceHistoryDays(
    rows: InstanceHistoryEntryRow[] = []
): string[] {
    return Array.from(
        new Set(
            rows
                .map((row) => toLocalDayKey(previousInstanceLeaveMs(row)))
                .filter(Boolean)
        )
    ).sort((left, right) => right.localeCompare(left));
}

export function selectDefaultInstanceHistoryDay(
    selectedDay: string,
    availableDays: string[] = []
): string {
    if (selectedDay && availableDays.includes(selectedDay)) {
        return selectedDay;
    }
    return availableDays[0] || selectedDay;
}

export function filterPreviousInstanceRowsForDay(
    rows: InstanceHistoryEntryRow[] = [],
    selectedDay: string
): InstanceHistoryEntryRow[] {
    if (!selectedDay) {
        return [];
    }
    return rows
        .filter(
            (row) => toLocalDayKey(previousInstanceLeaveMs(row)) === selectedDay
        )
        .sort(
            (left, right) =>
                previousInstanceLeaveMs(right) - previousInstanceLeaveMs(left)
        );
}

export function activityRowKey(row: InstanceActivityChartRow | null): string {
    const location = row?.location || '';
    const joinMs = Number(row?.joinMs || 0);
    return location && Number.isFinite(joinMs) && joinMs > 0
        ? `${location}:${joinMs}`
        : '';
}

function matchByLocationAndJoin<T>(
    items: T[],
    location: string,
    targetJoinMs: number,
    getLocation: (item: T) => string,
    getJoinMs: (item: T) => number
): T | null {
    if (!location || !Number.isFinite(targetJoinMs)) {
        return null;
    }
    let best: T | null = null;
    let bestDelta = Infinity;
    for (const item of items) {
        if (getLocation(item) !== location) {
            continue;
        }
        const joinMs = getJoinMs(item);
        if (!Number.isFinite(joinMs)) {
            continue;
        }
        const delta = Math.abs(joinMs - targetJoinMs);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = item;
        }
    }
    return best;
}

export function findPreviousInstanceRowForActivityRow(
    activityRow: InstanceActivityChartRow,
    rows: InstanceHistoryEntryRow[] = []
): InstanceHistoryEntryRow | null {
    return matchByLocationAndJoin(
        rows,
        String(activityRow?.location || ''),
        Number(activityRow?.joinMs || 0),
        rowLocation,
        previousInstanceJoinMs
    );
}

export function findActivityRowForPreviousInstanceRow(
    previousRow: InstanceHistoryEntryRow,
    activityRows: InstanceActivityChartRow[] = []
): InstanceActivityChartRow | null {
    return matchByLocationAndJoin(
        activityRows,
        rowLocation(previousRow),
        previousInstanceJoinMs(previousRow),
        (activityRow) => String(activityRow?.location || ''),
        (activityRow) => Number(activityRow?.joinMs || 0)
    );
}
