// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistedTableColumnSizing } from './dataTablePersistence';

const columnIds = ['name', 'time'];

describe('usePersistedTableColumnSizing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('updates the width immediately but saves it once after dragging settles', () => {
        const writePersistedState = vi.fn();
        const { result } = renderHook(() =>
            usePersistedTableColumnSizing({
                columnIds,
                initialValue: { name: 120 },
                writePersistedState
            })
        );

        act(() => {
            result.current[1]({ name: 130 });
            result.current[1]((current) => ({ ...current, name: 140 }));
            result.current[1]({ name: 150, time: 90 });
        });

        expect(result.current[0]).toEqual({ name: 150, time: 90 });
        expect(writePersistedState).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(writePersistedState).toHaveBeenCalledTimes(1);
        expect(writePersistedState).toHaveBeenCalledWith({
            columnSizing: { name: 150, time: 90 }
        });
    });

    it('saves a pending width when the table unmounts before the delay', () => {
        const writePersistedState = vi.fn();
        const { result, unmount } = renderHook(() =>
            usePersistedTableColumnSizing({
                columnIds,
                initialValue: {},
                writePersistedState
            })
        );

        act(() => {
            result.current[1]({ time: 80 });
        });
        unmount();

        expect(writePersistedState).toHaveBeenCalledTimes(1);
        expect(writePersistedState).toHaveBeenCalledWith({
            columnSizing: { time: 80 }
        });
    });
});
