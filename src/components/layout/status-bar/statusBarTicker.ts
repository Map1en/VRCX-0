import { useEffect, useState } from 'react';

let tickerNowMs = Date.now();
let tickerTimer: number | null = null;
const tickerListeners = new Set<(nowMs: number) => void>();

function emitTicker() {
    tickerNowMs = Date.now();
    for (const listener of tickerListeners) {
        listener(tickerNowMs);
    }
}

function subscribeStatusTicker(listener: (nowMs: number) => void) {
    tickerListeners.add(listener);
    if (tickerTimer === null) {
        tickerTimer = window.setInterval(emitTicker, 1000);
    }

    return () => {
        tickerListeners.delete(listener);
        if (tickerListeners.size === 0 && tickerTimer !== null) {
            window.clearInterval(tickerTimer);
            tickerTimer = null;
        }
    };
}

export function useStatusNowMs(active: boolean = true) {
    const [nowMs, setNowMs] = useState(() => tickerNowMs);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        setNowMs(tickerNowMs);
        return subscribeStatusTicker(setNowMs);
    }, [active]);

    return nowMs;
}
