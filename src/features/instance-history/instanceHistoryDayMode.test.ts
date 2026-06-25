import { describe, expect, it } from 'vitest';

import { parseLocation } from '@/shared/utils/location';

import type { InstanceActivityChartRow } from './instance-activity/instanceActivityTypes';
import {
    buildAvailableInstanceHistoryDays,
    filterPreviousInstanceRowsForDay,
    findActivityRowForPreviousInstanceRow,
    findPreviousInstanceRowForActivityRow,
    sanitizeInstanceHistoryMode,
    selectDefaultInstanceHistoryDay
} from './instanceHistoryDayMode';

function iso(value: number) {
    return new Date(value).toISOString();
}

function localIso(year: number, month: number, day: number, hour: number) {
    return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

function chartRow(
    row: Partial<InstanceActivityChartRow>
): InstanceActivityChartRow {
    return {
        id: row.id || 'chart',
        currentUserId: row.currentUserId || 'usr_self',
        displayName: row.displayName || 'Self',
        location: row.location || 'wrld_target:123',
        userId: row.userId || 'usr_self',
        parsedLocation: row.parsedLocation || parseLocation('wrld_target:123'),
        worldId: row.worldId || 'wrld_target',
        worldName: row.worldName || '',
        worldResolvedFromCache: row.worldResolvedFromCache || false,
        joinMs: row.joinMs || 0,
        leaveMs: row.leaveMs || 0,
        visibleStartMs: row.visibleStartMs || row.joinMs || 0,
        visibleDurationMs: row.visibleDurationMs || 0,
        activityKey: row.activityKey || 'wrld_target:123:0'
    };
}

describe('instanceHistoryDayMode', () => {
    it('sanitizes route mode values', () => {
        expect(sanitizeInstanceHistoryMode('day')).toBe('day');
        expect(sanitizeInstanceHistoryMode('search')).toBe('search');
        expect(sanitizeInstanceHistoryMode('timeline')).toBe('search');
        expect(sanitizeInstanceHistoryMode(null)).toBe('search');
    });

    it('builds available days from previous-instance rows newest first', () => {
        expect(
            buildAvailableInstanceHistoryDays([
                { created_at: localIso(2024, 1, 1, 18) },
                { created_at: localIso(2024, 1, 3, 18) },
                { created_at: localIso(2024, 1, 1, 20) },
                { created_at: '' }
            ])
        ).toEqual(['2024-01-03', '2024-01-01']);
    });

    it('selects the latest available activity day unless current selection is still available', () => {
        const days = ['2024-01-03', '2024-01-02'];

        expect(selectDefaultInstanceHistoryDay('', days)).toBe('2024-01-03');
        expect(selectDefaultInstanceHistoryDay('2024-01-02', days)).toBe(
            '2024-01-02'
        );
        expect(selectDefaultInstanceHistoryDay('2023-12-31', days)).toBe(
            '2024-01-03'
        );
    });

    it('filters previous-instance rows to the selected local day and sorts newest first', () => {
        const crossMidnightLeaveMs = new Date(2024, 0, 2, 1, 0, 0, 0).getTime();
        const rows = [
            { id: 'old', created_at: localIso(2024, 1, 1, 23) },
            { id: 'late', created_at: localIso(2024, 1, 2, 22) },
            { id: 'early', created_at: localIso(2024, 1, 2, 1) },
            {
                id: 'cross-midnight',
                created_at: localIso(2024, 1, 1, 23),
                last_ts: crossMidnightLeaveMs,
                time: 2 * 60 * 60 * 1000
            }
        ];

        expect(
            filterPreviousInstanceRowsForDay(rows, '2024-01-02').map(
                (row) => row.id
            )
        ).toEqual(['late', 'early', 'cross-midnight']);

        expect(
            filterPreviousInstanceRowsForDay(rows, '2024-01-01').map(
                (row) => row.id
            )
        ).toEqual(['old']);
    });

    it('matches activity rows to previous-instance rows by nearest join in same location', () => {
        const leaveMs = Date.parse('2024-01-02T03:00:00.000Z');
        const durationMs = 60 * 60 * 1000;
        const previousRows = [
            {
                id: 'target',
                location: 'wrld_target:123',
                created_at: iso(leaveMs - durationMs),
                last_ts: leaveMs + 750,
                time: durationMs
            },
            {
                id: 'other',
                location: 'wrld_other:123',
                created_at: iso(leaveMs - durationMs),
                last_ts: leaveMs,
                time: durationMs
            }
        ];

        expect(
            findPreviousInstanceRowForActivityRow(
                chartRow({
                    location: 'wrld_target:123',
                    joinMs: leaveMs - durationMs,
                    leaveMs
                }),
                previousRows
            )?.id
        ).toBe('target');
        expect(
            findActivityRowForPreviousInstanceRow(previousRows[0], [
                chartRow({
                    activityKey: 'chart-row',
                    location: 'wrld_target:123',
                    joinMs: leaveMs - durationMs,
                    leaveMs
                })
            ])?.activityKey
        ).toBe('chart-row');
    });
});
