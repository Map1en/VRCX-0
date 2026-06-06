import { describe, expect, it } from 'vitest';

import {
    buildInfoChartOption,
    buildInfoChartTooltipParts
} from './previousInstancesChart';

describe('previousInstancesChart', () => {
    it('uses the category index to mark same-name players independently', () => {
        const chartPayload = buildInfoChartOption({
            hour12: false,
            rows: [
                {
                    userId: 'usr_regular',
                    displayName: 'Same Name',
                    joinMs: 0,
                    leaveMs: 1000,
                    durationMs: 1000,
                    isFriend: true,
                    isFavorite: false
                },
                {
                    userId: 'usr_favorite',
                    displayName: 'Same Name',
                    joinMs: 2000,
                    leaveMs: 3000,
                    durationMs: 1000,
                    isFriend: false,
                    isFavorite: true
                }
            ]
        });

        expect(chartPayload.option.yAxis.data).toEqual([
            'Same Name',
            'Same Name'
        ]);
        expect(
            chartPayload.option.yAxis.axisLabel.formatter('Same Name', 0)
        ).toBe('\ud83d\udc9a Same Name');
        expect(
            chartPayload.option.yAxis.axisLabel.formatter('Same Name', 1)
        ).toBe('\u2b50 Same Name');
    });

    it('builds tooltip content as pure text parts for the page adapter', () => {
        expect(
            buildInfoChartTooltipParts(
                {
                    displayName: 'Ava',
                    joinMs: Date.UTC(2026, 0, 1, 1, 0, 0),
                    leaveMs: Date.UTC(2026, 0, 1, 1, 30, 0),
                    durationMs: 30 * 60 * 1000,
                    isFavorite: true
                },
                false
            )
        ).toMatchObject({
            title: 'Ava \u2b50',
            duration: '30m 0s'
        });
    });
});
