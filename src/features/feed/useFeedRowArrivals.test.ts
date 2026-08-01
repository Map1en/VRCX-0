// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedLoadStatus, FeedRow } from './feedTypes';
import { useFeedRowArrivals } from './useFeedRowArrivals';

function rowsOf(...ids: string[]): FeedRow[] {
    return ids.map((userId) => ({ userId }));
}

function renderArrivals(rows: FeedRow[], loadStatus: FeedLoadStatus) {
    return renderHook(
        ({ rows: nextRows, loadStatus: nextLoadStatus }) =>
            useFeedRowArrivals(nextRows, nextLoadStatus),
        { initialProps: { rows, loadStatus } }
    );
}

describe('useFeedRowArrivals', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('marks incremental rows during the same render that receives them', () => {
        const { result, rerender } = renderArrivals(rowsOf('a', 'b'), 'ready');

        expect([...result.current]).toEqual([]);

        rerender({ rows: rowsOf('c', 'a', 'b'), loadStatus: 'ready' });

        expect([...result.current]).toEqual(['::c:']);
    });

    it('only registers seen ids on full query paths', () => {
        const { result, rerender } = renderArrivals(rowsOf('a'), 'running');

        rerender({ rows: rowsOf('a', 'b'), loadStatus: 'ready' });

        expect([...result.current]).toEqual([]);

        rerender({ rows: rowsOf('a', 'b', 'c'), loadStatus: 'ready' });

        expect([...result.current]).toEqual(['::c:']);
    });

    it('keeps the same set reference when rows are unchanged', () => {
        const rows = rowsOf('a');
        const { result, rerender } = renderArrivals(rows, 'ready');
        const initial = result.current;

        rerender({ rows, loadStatus: 'ready' });

        expect(result.current).toBe(initial);

        const nextRows = rowsOf('a', 'b');
        rerender({ rows: nextRows, loadStatus: 'ready' });
        const withArrival = result.current;

        expect([...withArrival]).toEqual(['::b:']);

        rerender({ rows: nextRows, loadStatus: 'ready' });

        expect(result.current).toBe(withArrival);
    });

    it('drops expired arrivals on the next rows change', () => {
        const { result, rerender } = renderArrivals(rowsOf('a'), 'ready');

        rerender({ rows: rowsOf('a', 'b'), loadStatus: 'ready' });

        expect([...result.current]).toEqual(['::b:']);

        vi.advanceTimersByTime(5000);
        rerender({ rows: rowsOf('a', 'b', 'c'), loadStatus: 'ready' });

        expect([...result.current]).toEqual(['::c:']);
    });

    it('drops expired arrivals on re-renders without rows changes', () => {
        const { result, rerender } = renderArrivals(rowsOf('a'), 'ready');
        const rows = rowsOf('a', 'b');

        rerender({ rows, loadStatus: 'ready' });

        expect([...result.current]).toEqual(['::b:']);

        vi.advanceTimersByTime(5000);
        rerender({ rows, loadStatus: 'ready' });

        expect([...result.current]).toEqual([]);
    });
});
