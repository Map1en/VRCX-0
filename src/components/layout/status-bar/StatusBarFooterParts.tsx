import { useStatusNowMs } from './statusBarTicker';
import type { DurationValueProps, StatusBarNowPlaying } from './statusBarTypes';

export function DurationValue({
    active,
    formatter,
    startAtMs
}: DurationValueProps) {
    const normalizedStartAt = Number(startAtMs);
    const enabled =
        Boolean(active) &&
        Number.isFinite(normalizedStartAt) &&
        normalizedStartAt > 0;
    const nowMs = useStatusNowMs(enabled);

    if (!enabled) {
        return '-';
    }

    return formatter(nowMs - normalizedStartAt);
}

export function AppUptimeValue({
    formatter,
    startedAtMs
}: {
    formatter: (ms: number) => string;
    startedAtMs: number;
}) {
    const nowMs = useStatusNowMs(true);
    return formatter(nowMs - startedAtMs);
}

export function ClockValue({
    formatter,
    offset
}: {
    formatter: (nowMs: number, offset: unknown) => string;
    offset: unknown;
}) {
    const nowMs = useStatusNowMs(true);
    return formatter(nowMs, offset);
}

export function NowPlayingProgress({
    formatter,
    nowPlaying
}: {
    formatter: (ms: unknown) => string;
    nowPlaying: StatusBarNowPlaying;
}) {
    const hasLength = Boolean(nowPlaying.length);
    const nowMs = useStatusNowMs(hasLength && Boolean(nowPlaying.startedAt));
    if (!hasLength) {
        return null;
    }

    const lengthSeconds = Math.max(0, Number(nowPlaying.length) || 0);
    const startedAtMs = nowPlaying.startedAt
        ? Date.parse(nowPlaying.startedAt)
        : Number.NaN;
    const elapsedSeconds = Math.min(
        lengthSeconds,
        Math.max(
            0,
            Number(nowPlaying.position || 0) +
                (Number.isFinite(startedAtMs)
                    ? Math.floor((nowMs - startedAtMs) / 1000)
                    : 0)
        )
    );

    return (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {`${formatter(elapsedSeconds * 1000)} / ${formatter(lengthSeconds * 1000)}`}
        </span>
    );
}
