// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMinuteNowMs } from './useMinuteNowMs';

function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hidden
    });
}

describe('useMinuteNowMs', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-28T10:00:30Z'));
        setHidden(false);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        setHidden(false);
    });

    it('ticks on minute boundaries', () => {
        const { result } = renderHook(() => useMinuteNowMs());
        const mountedAt = result.current;

        act(() => vi.advanceTimersByTime(29_000));
        expect(result.current).toBe(mountedAt);

        act(() => vi.advanceTimersByTime(1_000));
        expect(result.current).toBe(Date.parse('2026-10-28T10:01:00Z'));

        act(() => vi.advanceTimersByTime(60_000));
        expect(result.current).toBe(Date.parse('2026-10-28T10:02:00Z'));
    });

    it('stops while hidden and refreshes when the window becomes visible', () => {
        const { result } = renderHook(() => useMinuteNowMs());

        setHidden(true);
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        const hiddenAt = result.current;
        act(() => vi.advanceTimersByTime(180_000));
        expect(result.current).toBe(hiddenAt);

        setHidden(false);
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(result.current).toBe(Date.now());
    });
});
