// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useScrollViewportMetrics } from './useScrollViewportMetrics';

afterEach(cleanup);

describe('useScrollViewportMetrics', () => {
    it('ignores scrolling while disabled and resumes measurement when enabled', () => {
        const viewport = document.createElement('div');
        Object.defineProperties(viewport, {
            clientWidth: { value: 800 },
            clientHeight: { value: 600 }
        });
        const { result, rerender } = renderHook(
            ({ enabled }) => useScrollViewportMetrics({ enabled }),
            { initialProps: { enabled: true } }
        );
        act(() => result.current.viewportRef(viewport));
        act(() => {
            viewport.scrollTop = 120;
            viewport.dispatchEvent(new Event('scroll'));
        });
        expect(result.current.viewportMetrics).toEqual({
            scrollTop: 120,
            viewportHeight: 600,
            width: 800
        });

        rerender({ enabled: false });
        const disabledMetrics = result.current.viewportMetrics;
        act(() => {
            viewport.scrollTop = 300;
            viewport.dispatchEvent(new Event('scroll'));
        });
        expect(result.current.viewportMetrics).toBe(disabledMetrics);

        act(() => result.current.resetScrollTop());
        expect(viewport.scrollTop).toBe(0);
        rerender({ enabled: true });
        act(() => {
            viewport.scrollTop = 240;
            viewport.dispatchEvent(new Event('scroll'));
        });
        expect(result.current.viewportMetrics).toEqual({
            scrollTop: 240,
            viewportHeight: 600,
            width: 800
        });
    });
});
