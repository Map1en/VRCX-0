// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    PROGRESS_FINISH_MS,
    useFinishingProgress
} from './useFinishingProgress';

describe('useFinishingProgress', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('fills to 100% after the work ends and hides once the finish animation is over', () => {
        const { result, rerender } = renderHook(
            ({ done, total }: { done: number | null; total: number }) =>
                useFinishingProgress(done, total),
            { initialProps: { done: 0 as number | null, total: 4 } }
        );
        expect(result.current).toEqual({
            isVisible: true,
            isFinishing: false,
            percent: 0
        });

        rerender({ done: 2, total: 4 });
        expect(result.current.percent).toBe(50);

        rerender({ done: null, total: 0 });
        expect(result.current).toEqual({
            isVisible: true,
            isFinishing: true,
            percent: 100
        });

        act(() => {
            vi.advanceTimersByTime(PROGRESS_FINISH_MS);
        });
        expect(result.current.isVisible).toBe(false);
    });

    it('stays hidden when no work has run', () => {
        const { result } = renderHook(() => useFinishingProgress(null, 0));

        expect(result.current.isVisible).toBe(false);
    });

    it('drops the finishing state when new work starts before the bar hides', () => {
        const { result, rerender } = renderHook(
            ({ done }: { done: number | null }) =>
                useFinishingProgress(done, 2),
            { initialProps: { done: 1 as number | null } }
        );
        rerender({ done: null });
        rerender({ done: 0 });

        expect(result.current).toEqual({
            isVisible: true,
            isFinishing: false,
            percent: 0
        });
    });
});
