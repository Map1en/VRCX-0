const DEV_PERFORMANCE_GUARD_KEY = Symbol.for(
    'vrcx-0.devPerformanceTimelineGuard'
);

export function installDevPerformanceTimelineGuard() {
    if (!import.meta.env.DEV) {
        return;
    }

    const performanceApi = globalThis.performance as Performance &
        Record<symbol, unknown>;
    if (
        !performanceApi ||
        performanceApi[DEV_PERFORMANCE_GUARD_KEY] ||
        typeof performanceApi.measure !== 'function' ||
        typeof performanceApi.clearMeasures !== 'function'
    ) {
        return;
    }

    const measure = performanceApi.measure.bind(performanceApi);
    const clearMeasures = performanceApi.clearMeasures.bind(performanceApi);

    clearMeasures();

    // React dev builds emit User Timing measures for renders and components.
    // Chrome keeps those entries until cleared, so active dev sessions can OOM.
    function measureAndClear(
        ...args: Parameters<Performance['measure']>
    ): ReturnType<Performance['measure']> {
        const entry = measure(...args);
        const name = typeof args[0] === 'string' ? args[0] : undefined;

        try {
            clearMeasures(name);
        } catch (error) {
            console.warn(
                '[devPerformanceTimelineGuard] Failed to clear performance measures:',
                error
            );
        }

        return entry;
    }

    performanceApi.measure = measureAndClear;
    Object.defineProperty(performanceApi, DEV_PERFORMANCE_GUARD_KEY, {
        value: true
    });
}
