import { describe, expect, it } from 'vitest';

import {
    buildChartOption,
    buildDetailChartOption
} from './instanceActivityChart.js';
import { getLocalDayBounds } from './instanceActivityRows.js';

describe('instanceActivityChart', () => {
    it('builds the main chart data series from clipped visible intervals', () => {
        const selectedDate = '2024-01-02';
        const { startMs } = getLocalDayBounds(selectedDate);
        const option = buildChartOption({
            selectedDate,
            barWidth: 25,
            hour12: false,
            t: (key) => key,
            rows: [
                {
                    worldName: 'Known World',
                    parsedLocation: {
                        instanceName: '1',
                        accessTypeName: 'friends'
                    },
                    joinMs: startMs - 60 * 60 * 1000,
                    leaveMs: startMs + 2 * 60 * 60 * 1000,
                    visibleStartMs: startMs,
                    visibleDurationMs: 2 * 60 * 60 * 1000
                }
            ]
        });

        expect(option.yAxis.data).toEqual(['Known World']);
        expect(option.series[0].data).toEqual([0]);
        expect(option.series[1].data).toEqual([2 * 60 * 60 * 1000]);
        expect(option.series[1].itemStyle).toMatchObject({
            borderRadius: 3,
            shadowBlur: 2
        });
        expect(
            option.tooltip.formatter([{ seriesName: 'Time', dataIndex: 0 }])
        ).toContain('Known World');
    });

    it('marks detail chart rows without relying on display name lookups', () => {
        const option = buildDetailChartOption({
            barWidth: 12,
            hour12: false,
            group: [
                {
                    userId: 'usr_regular',
                    displayName: 'Same Name',
                    joinMs: 0,
                    leaveMs: 1000,
                    durationMs: 1000,
                    isCurrentUser: true,
                    isFriend: false,
                    isFavorite: false
                },
                {
                    userId: 'usr_favorite',
                    displayName: 'Same Name',
                    joinMs: 100,
                    leaveMs: 900,
                    durationMs: 800,
                    isCurrentUser: false,
                    isFriend: true,
                    isFavorite: true
                }
            ]
        });

        expect(option.yAxis.data).toEqual(['Same Name', '\u2b50 Same Name']);
        expect(option.firstEntries.map((entry) => entry.userId)).toEqual([
            'usr_regular',
            'usr_favorite'
        ]);
    });
});
