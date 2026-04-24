export function createRateLimiter({ limitPerInterval, intervalMs }) {
    const stamps = [];

    async function throttle() {
        let now = Date.now();
        while (stamps.length && now - stamps[0] >= intervalMs) {
            stamps.shift();
        }
        if (stamps.length >= limitPerInterval) {
            const wait = intervalMs - (now - stamps[0]);
            await new Promise((resolve) => setTimeout(resolve, wait));
            now = Date.now();
            while (stamps.length && now - stamps[0] >= intervalMs) {
                stamps.shift();
            }
        }
        stamps.push(now);
    }

    return {
        async schedule(fn) {
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
