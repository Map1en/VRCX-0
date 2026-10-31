import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

let minuteTimer: number | null = null;
const minuteListeners = new Set<(nowMs: number) => void>();

function clearMinuteTimer() {
    if (minuteTimer !== null) {
        window.clearTimeout(minuteTimer);
        minuteTimer = null;
    }
}

function emitMinute() {
    const nowMs = Date.now();
    for (const listener of minuteListeners) {
        listener(nowMs);
    }
}

function scheduleMinute() {
    clearMinuteTimer();
    if (document.hidden) {
        return;
    }
    minuteTimer = window.setTimeout(
        () => {
            emitMinute();
            scheduleMinute();
        },
        MINUTE_MS - (Date.now() % MINUTE_MS)
    );
}

function handleWake() {
    if (document.hidden) {
        clearMinuteTimer();
        return;
    }
    emitMinute();
    scheduleMinute();
}

function subscribeMinute(listener: (nowMs: number) => void) {
    minuteListeners.add(listener);
    if (minuteListeners.size === 1) {
        document.addEventListener('visibilitychange', handleWake);
        window.addEventListener('focus', handleWake);
        scheduleMinute();
    }

    return () => {
        minuteListeners.delete(listener);
        if (minuteListeners.size === 0) {
            clearMinuteTimer();
            document.removeEventListener('visibilitychange', handleWake);
            window.removeEventListener('focus', handleWake);
        }
    };
}

export function useMinuteNowMs() {
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        setNowMs(Date.now());
        return subscribeMinute(setNowMs);
    }, []);

    return nowMs;
}
