import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDelayedVisibleController } from './groupQuickModerationLoading';

describe('createDelayedVisibleController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('delays showing loading until the threshold elapses', () => {
        const visibleStates: boolean[] = [];
        const controller = createDelayedVisibleController(
            (visible) => visibleStates.push(visible),
            160
        );

        controller.start();
        vi.advanceTimersByTime(159);

        expect(visibleStates).toEqual([false]);

        vi.advanceTimersByTime(1);

        expect(visibleStates).toEqual([false, true]);
    });

    it('cancels pending loading when stopped before the threshold', () => {
        const visibleStates: boolean[] = [];
        const controller = createDelayedVisibleController(
            (visible) => visibleStates.push(visible),
            160
        );

        controller.start();
        vi.advanceTimersByTime(80);
        controller.stop();
        vi.advanceTimersByTime(160);

        expect(visibleStates).toEqual([false, false]);
    });
});
