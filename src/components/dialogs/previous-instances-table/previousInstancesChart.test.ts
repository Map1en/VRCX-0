import { describe, expect, it } from 'vitest';

import {
    buildInfoChartOption,
    buildInfoTimelineRows,
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

        if (chartPayload === null) {
            throw new Error('expected chart payload to be present');
        }

        expect(chartPayload.option.yAxis.data).toEqual([
            'Same Name',
            'Same Name'
        ]);
        expect(
            chartPayload.option.yAxis.axisLabel.formatter('Same Name', 0)
        ).toBe('{friend|\u2661} Same Name');
        expect(
            chartPayload.option.yAxis.axisLabel.formatter('Same Name', 1)
        ).toBe('{favorite|\u2606} Same Name');
    });

    it('anchors the timeline to the selected closed self interval and clips peers', () => {
        const rows = buildInfoTimelineRows({
            visitWindow: { startMs: 1000, endMs: 5000 },
            rows: [
                {
                    userId: 'usr_self',
                    displayName: 'Self',
                    joinMs: -1_005_000,
                    leaveMs: -1_000_000,
                    durationMs: 5000,
                    isSelf: true
                },
                {
                    userId: 'usr_self',
                    displayName: 'Self',
                    joinMs: 1000,
                    leaveMs: 5000,
                    durationMs: 4000,
                    isSelf: true
                },
                {
                    userId: 'usr_peer',
                    displayName: 'Peer',
                    joinMs: 0,
                    leaveMs: 6000,
                    durationMs: 6000
                },
                {
                    userId: 'usr_later',
                    displayName: 'Later',
                    joinMs: 6000,
                    leaveMs: 7000,
                    durationMs: 1000
                }
            ]
        });

        expect(rows).toEqual([
            expect.objectContaining({
                userId: 'usr_self',
                joinMs: 1000,
                leaveMs: 5000,
                durationMs: 4000
            }),
            expect.objectContaining({
                userId: 'usr_peer',
                joinMs: 1000,
                leaveMs: 5000,
                durationMs: 4000
            })
        ]);
    });

    it('does not render another visit when the selected visit lacks a closed self interval', () => {
        expect(
            buildInfoTimelineRows({
                visitWindow: { startMs: 100_000, endMs: 100_000 },
                rows: [
                    {
                        userId: 'usr_peer',
                        displayName: 'Peer',
                        joinMs: 100_000,
                        leaveMs: 200_000,
                        durationMs: 100_000
                    }
                ]
            })
        ).toEqual([]);
    });

    it('keeps gaps between closed self intervals out of peer overlap time', () => {
        const rows = buildInfoTimelineRows({
            visitWindow: { startMs: 1000, endMs: 7000 },
            rows: [
                {
                    userId: 'usr_self',
                    joinMs: 1000,
                    leaveMs: 3000,
                    durationMs: 2000,
                    isSelf: true
                },
                {
                    userId: 'usr_self',
                    joinMs: 5000,
                    leaveMs: 7000,
                    durationMs: 2000,
                    isSelf: true
                },
                {
                    userId: 'usr_peer',
                    joinMs: 0,
                    leaveMs: 8000,
                    durationMs: 8000
                }
            ]
        });

        expect(
            rows
                .filter((row) => row.userId === 'usr_peer')
                .map(({ joinMs, leaveMs, durationMs }) => ({
                    joinMs,
                    leaveMs,
                    durationMs
                }))
        ).toEqual([
            { joinMs: 1000, leaveMs: 3000, durationMs: 2000 },
            { joinMs: 5000, leaveMs: 7000, durationMs: 2000 }
        ]);
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
            title: '\u2606 Ava',
            duration: '30m 0s'
        });
    });
});
