import { SECOND_MS } from '@/shared/constants/time';

const RETRY_SOON_SECONDS = 5;

export type RealtimeRecoveryLabel =
    | { key: 'status_bar.realtime_retry_in'; seconds: number }
    | { key: 'status_bar.realtime_retry_soon' }
    | { key: 'status_bar.realtime_reconnecting' }
    | { key: 'status_bar.realtime_connecting' };

export function realtimeRecoveryLabel({
    retryWaiting,
    retryAtMs,
    nowMs,
    reconnecting
}: {
    retryWaiting: boolean;
    retryAtMs: number;
    nowMs: number;
    reconnecting: boolean;
}): RealtimeRecoveryLabel {
    if (retryWaiting && Number.isFinite(retryAtMs)) {
        const seconds = Math.ceil((retryAtMs - nowMs) / SECOND_MS);
        return seconds > RETRY_SOON_SECONDS
            ? { key: 'status_bar.realtime_retry_in', seconds }
            : { key: 'status_bar.realtime_retry_soon' };
    }
    return reconnecting
        ? { key: 'status_bar.realtime_reconnecting' }
        : { key: 'status_bar.realtime_connecting' };
}
