import { describe, expect, it } from 'vitest';

import {
    buildDefaultSelfInstanceHistoryDateRange,
    buildLocalDayInstanceHistoryDateRange,
    refreshDefaultSelfInstanceHistoryDateRange,
    resolveClearedInstanceHistoryDateRange,
    resolveScopedInstanceHistoryDateRange
} from './instanceHistoryDateRange';

describe('instanceHistoryDateRange', () => {
    it('builds the self default window from the current system time', () => {
        const now = new Date('2026-07-03T12:00:00.000Z');

        expect(buildDefaultSelfInstanceHistoryDateRange(now)).toEqual({
            from: new Date('2026-06-03T12:00:00.000Z'),
            to: now
        });
    });

    it('builds an inclusive local-day window for day mode queries', () => {
        const range = buildLocalDayInstanceHistoryDateRange('2026-07-03');

        expect(range.from).toEqual(new Date(2026, 6, 3, 0, 0, 0, 0));
        expect(range.to).toEqual(new Date(2026, 6, 3, 23, 59, 59, 999));
    });

    it('resets cleared self search dates to the 30 day default', () => {
        const now = new Date('2026-07-03T12:00:00.000Z');

        expect(
            resolveClearedInstanceHistoryDateRange({
                isDayMode: false,
                isSelfScope: true,
                now
            })
        ).toEqual({
            from: new Date('2026-06-03T12:00:00.000Z'),
            to: now
        });
    });

    it('clears non-self and day-mode date ranges to an unbounded value', () => {
        const now = new Date('2026-07-03T12:00:00.000Z');

        expect(
            resolveClearedInstanceHistoryDateRange({
                isDayMode: false,
                isSelfScope: false,
                now
            })
        ).toEqual({ from: null, to: null });
        expect(
            resolveClearedInstanceHistoryDateRange({
                isDayMode: true,
                isSelfScope: true,
                now
            })
        ).toEqual({ from: null, to: null });
    });

    it('adds the self default only in search mode when no user date is active', () => {
        const now = new Date('2026-07-03T12:00:00.000Z');

        expect(
            resolveScopedInstanceHistoryDateRange({
                isDayMode: false,
                isSelfScope: true,
                state: {
                    range: { from: null, to: null },
                    source: 'none'
                },
                now
            })
        ).toEqual({
            range: {
                from: new Date('2026-06-03T12:00:00.000Z'),
                to: now
            },
            source: 'defaultSelf'
        });
        expect(
            resolveScopedInstanceHistoryDateRange({
                isDayMode: true,
                isSelfScope: true,
                state: {
                    range: { from: null, to: null },
                    source: 'none'
                },
                now
            })
        ).toEqual({
            range: { from: null, to: null },
            source: 'none'
        });
    });

    it('drops the self default when switching to another user but preserves user-selected dates', () => {
        const userRange = {
            from: new Date('2026-01-01T00:00:00.000Z'),
            to: new Date('2026-01-02T00:00:00.000Z')
        };

        expect(
            resolveScopedInstanceHistoryDateRange({
                isDayMode: false,
                isSelfScope: false,
                state: {
                    range: userRange,
                    source: 'defaultSelf'
                }
            })
        ).toEqual({
            range: { from: null, to: null },
            source: 'none'
        });
        expect(
            resolveScopedInstanceHistoryDateRange({
                isDayMode: false,
                isSelfScope: false,
                state: {
                    range: userRange,
                    source: 'user'
                }
            })
        ).toEqual({
            range: userRange,
            source: 'user'
        });
    });

    it('refreshes only the self default window', () => {
        const oldDefaultRange = {
            from: new Date('2026-06-01T12:00:00.000Z'),
            to: new Date('2026-07-01T12:00:00.000Z')
        };
        const userRange = {
            from: new Date('2026-01-01T00:00:00.000Z'),
            to: new Date('2026-01-02T00:00:00.000Z')
        };
        const now = new Date('2026-07-03T12:00:00.000Z');

        expect(
            refreshDefaultSelfInstanceHistoryDateRange(
                {
                    range: oldDefaultRange,
                    source: 'defaultSelf'
                },
                now
            )
        ).toEqual({
            range: {
                from: new Date('2026-06-03T12:00:00.000Z'),
                to: now
            },
            source: 'defaultSelf'
        });
        expect(
            refreshDefaultSelfInstanceHistoryDateRange(
                {
                    range: userRange,
                    source: 'user'
                },
                now
            )
        ).toEqual({
            range: userRange,
            source: 'user'
        });
    });
});
