import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';

import { userActivityViewService } from './userActivityViewService';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appActivityView: vi.fn(),
        appActivityOverlapView: vi.fn()
    }
}));

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

describe('userActivityViewService Rust activity views', () => {
    beforeEach(() => {
        vi.mocked(commands.appActivityView).mockReset();
        vi.mocked(commands.appActivityOverlapView).mockReset();
    });

    it('loads activity view from Rust and formats peak labels', async () => {
        vi.mocked(commands.appActivityView).mockResolvedValue({
            rawBuckets: [60],
            normalizedBuckets: [0.5],
            peakDayIndex: 0,
            peakHourStart: 1,
            peakHourEnd: 3,
            filteredEventCount: 1,
            hasAnyData: true,
            statusDistribution: {
                joinMeCount: 2,
                activeCount: 3,
                askMeCount: 1,
                busyCount: 0,
                totalCount: 999
            },
            builtFromCursor: 'cursor',
            builtAt: '2025-01-06T00:00:00.000Z'
        });

        const result = await userActivityViewService.loadActivityView({
            userId: 'usr_target',
            ownerUserId: 'usr_owner',
            isSelf: false,
            rangeDays: 7,
            dayLabels,
            forceRefresh: true
        });

        expect(commands.appActivityView).toHaveBeenCalledWith({
            ownerUserId: 'usr_owner',
            targetUserId: 'usr_target',
            isSelf: false,
            rangeDays: 7,
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
            nowMs: expect.any(Number),
            forceRefresh: true
        });
        expect(result).toMatchObject({
            rawBuckets: [60],
            normalizedBuckets: [0.5],
            filteredEventCount: 1,
            hasAnyData: true,
            peakDay: 'Sun',
            peakTime: '01:00-03:00',
            statusDistribution: {
                joinMeCount: 2,
                activeCount: 3,
                askMeCount: 1,
                busyCount: 0,
                totalCount: 6
            }
        });
    });

    it('formats single-hour activity peaks without a range suffix', async () => {
        vi.mocked(commands.appActivityView).mockResolvedValue({
            rawBuckets: [60],
            normalizedBuckets: [1],
            peakDayIndex: 2,
            peakHourStart: 9,
            peakHourEnd: 10,
            filteredEventCount: 1,
            hasAnyData: true,
            statusDistribution: {
                joinMeCount: 0,
                activeCount: 0,
                askMeCount: 0,
                busyCount: 0,
                totalCount: 0
            },
            builtFromCursor: 'cursor',
            builtAt: '2025-01-06T00:00:00.000Z'
        });

        const result = await userActivityViewService.loadActivityView({
            userId: 'usr_self',
            ownerUserId: '',
            isSelf: true,
            rangeDays: 30,
            dayLabels
        });

        expect(result.peakDay).toBe('Tue');
        expect(result.peakTime).toBe('09:00');
    });

    it('loads overlap view from Rust and formats best overlap labels', async () => {
        vi.mocked(commands.appActivityOverlapView).mockResolvedValue({
            rawBuckets: [0, 0, 60, 60],
            normalizedBuckets: [0, 0, 0.8, 0.8],
            overlapPercent: 100,
            bestDayIndex: 0,
            bestHourStart: 2,
            bestHourEnd: 4,
            hasOverlapData: true,
            builtFromCursor: 'self|target',
            builtAt: '2025-01-06T00:00:00.000Z'
        });

        const result = await userActivityViewService.loadOverlapView({
            currentUserId: 'usr_owner',
            targetUserId: 'usr_target',
            ownerUserId: 'usr_owner',
            rangeDays: 7,
            dayLabels,
            forceRefresh: false,
            excludeHours: {
                enabled: true,
                startHour: 22,
                endHour: 2
            }
        });

        expect(commands.appActivityOverlapView).toHaveBeenCalledWith({
            ownerUserId: 'usr_owner',
            currentUserId: 'usr_owner',
            targetUserId: 'usr_target',
            rangeDays: 7,
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
            nowMs: expect.any(Number),
            forceRefresh: false,
            excludeStartHour: 22,
            excludeEndHour: 2
        });
        expect(result).toMatchObject({
            rawBuckets: [0, 0, 60, 60],
            normalizedBuckets: [0, 0, 0.8, 0.8],
            overlapPercent: 100,
            hasOverlapData: true,
            bestOverlapTime: 'Sun, 02:00-04:00'
        });
    });
});
