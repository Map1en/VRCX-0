import { afterEach, describe, expect, it, vi } from 'vitest';

describe('waitForInitialTelemetryContext', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('clears its startup wait timer and subscription when aborted', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('window', {
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout
        });

        const unsubscribe = vi.fn();
        const subscribe = vi.fn(() => unsubscribe);
        vi.doMock('@/state/runtimeStore', () => ({
            useRuntimeStore: {
                getState: () => ({
                    hostCapabilities: { platform: 'unknown' },
                    backendRuntime: {},
                    gameState: {}
                }),
                subscribe
            }
        }));
        vi.doMock('@/state/shellStore', () => ({
            useShellStore: {
                getState: () => ({ locale: 'en' })
            }
        }));

        const { waitForInitialTelemetryContext } =
            await import('./telemetryPayload');
        const controller = new AbortController();
        const wait = waitForInitialTelemetryContext({
            timeoutMs: 5_000,
            signal: controller.signal
        });

        expect(subscribe).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        controller.abort();

        await expect(wait).resolves.toBeUndefined();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
