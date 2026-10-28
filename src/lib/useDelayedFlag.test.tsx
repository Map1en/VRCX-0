// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDelayedFlag } from './useDelayedFlag';

describe('useDelayedFlag', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('turns on only after the delay elapses while active', () => {
        const { result } = renderHook(() => useDelayedFlag(true, 160));

        act(() => {
            vi.advanceTimersByTime(159);
        });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(true);
    });

    it('stays off when deactivated before the delay elapses', () => {
        const { rerender, result } = renderHook(
            ({ active }) => useDelayedFlag(active, 160),
            { initialProps: { active: true } }
        );

        act(() => {
            vi.advanceTimersByTime(80);
        });
        rerender({ active: false });
        act(() => {
            vi.advanceTimersByTime(160);
        });

        expect(result.current).toBe(false);
    });

    it('restarts the delay when the reset key changes', () => {
        const { rerender, result } = renderHook(
            ({ resetKey }) => useDelayedFlag(true, 160, resetKey),
            { initialProps: { resetKey: 'a' } }
        );

        act(() => {
            vi.advanceTimersByTime(160);
        });
        expect(result.current).toBe(true);

        rerender({ resetKey: 'b' });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(160);
        });
        expect(result.current).toBe(true);
    });
});
