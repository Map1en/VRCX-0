import { delay } from './delays';

type RateLimiterOptions = {
    limitPerInterval: number;
    intervalMs: number;
};

export function createRateLimiter({
    limitPerInterval,
    intervalMs
}: RateLimiterOptions) {
    const stamps: number[] = [];

    async function throttle(): Promise<void> {
        let now = Date.now();
        while (stamps.length && now - stamps[0] >= intervalMs) {
            stamps.shift();
        }
        if (stamps.length >= limitPerInterval) {
            const wait = intervalMs - (now - stamps[0]);
            await delay(wait);
            now = Date.now();
            while (stamps.length && now - stamps[0] >= intervalMs) {
                stamps.shift();
            }
        }
        stamps.push(now);
    }

    return {
        async schedule<T>(fn: () => T | Promise<T>): Promise<T> {
            await throttle();
            return fn();
        },
        async wait() {
            await throttle();
        },
        clear() {
            stamps.length = 0;
        }
    };
}
