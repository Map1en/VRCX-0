import { describe, expect, it } from 'vitest';

import { realtimeRecoveryLabel } from './realtimeRecovery';

const nowMs = Date.parse('2026-10-29T00:00:00.000Z');

describe('realtimeRecoveryLabel', () => {
    it('counts down to the next retry and switches to "soon" near the end', () => {
        const base = {
            retryWaiting: true,
            nowMs,
            reconnecting: true
        };

        expect(
            realtimeRecoveryLabel({ ...base, retryAtMs: nowMs + 11_200 })
        ).toEqual({ key: 'status_bar.realtime_retry_in', seconds: 12 });
        expect(
            realtimeRecoveryLabel({ ...base, retryAtMs: nowMs + 5_000 })
        ).toEqual({ key: 'status_bar.realtime_retry_soon' });
        expect(
            realtimeRecoveryLabel({ ...base, retryAtMs: nowMs - 1_000 })
        ).toEqual({ key: 'status_bar.realtime_retry_soon' });
    });

    it('tells a first connection apart from a reconnect while an attempt runs', () => {
        const base = {
            retryWaiting: false,
            retryAtMs: Number.NaN,
            nowMs
        };

        expect(realtimeRecoveryLabel({ ...base, reconnecting: true })).toEqual({
            key: 'status_bar.realtime_reconnecting'
        });
        expect(realtimeRecoveryLabel({ ...base, reconnecting: false })).toEqual(
            { key: 'status_bar.realtime_connecting' }
        );
    });
});
