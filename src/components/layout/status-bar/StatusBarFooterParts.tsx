import { useStatusNowMs } from './statusBarTicker';
import type { DurationValueProps, StatusBarNowPlaying } from './statusBarTypes';

export function DurationValue({
    active,
    formatter,
    startAtMs
}: DurationValueProps) {
    const enabled =
        active === true && Number.isFinite(startAtMs) && startAtMs > 0;
    const nowMs = useStatusNowMs(enabled);

    if (!enabled) {
        return '-';
    }

    return formatter(nowMs - startAtMs);
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
    formatter: (nowMs: number, offset: number) => string;
    offset: number;
}) {
    const nowMs = useStatusNowMs(true);
    return formatter(nowMs, offset);
}

export function NowPlayingProgress({
    formatter,
    nowPlaying
}: {
    formatter: (ms: number) => string;
    nowPlaying: StatusBarNowPlaying;
}) {
    const lengthSeconds = nowPlaying.length ?? 0;
    const hasLength = lengthSeconds > 0;
    const running = !nowPlaying.paused && Boolean(nowPlaying.startedAt);
    const nowMs = useStatusNowMs(hasLength && running);
    if (!hasLength) {
        return null;
    }

    const startedAtMs =
        running && nowPlaying.startedAt
            ? Date.parse(nowPlaying.startedAt)
            : Number.NaN;
    const elapsedSeconds = Math.min(
        lengthSeconds,
        Math.max(
            0,
            (nowPlaying.position ?? 0) +
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
