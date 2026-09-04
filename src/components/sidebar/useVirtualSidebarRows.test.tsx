// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useVirtualSidebarRows } from './useVirtualSidebarRows';

type Row = { key: string };

describe('useVirtualSidebarRows scroll anchoring', () => {
    afterEach(cleanup);

    it('keeps the first visible row at the same offset when rows prepend', () => {
        const { result, rerender } = renderHook(
            ({ resetKey, rows }: { resetKey: string; rows: Row[] }) =>
                useVirtualSidebarRows(rows, () => 40, {
                    preserveScrollAnchor: true,
                    resetKey
                }),
            {
                initialProps: {
                    resetKey: 'normal',
                    rows: [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
                }
            }
        );
        const viewport = document.createElement('div');
        Object.defineProperty(viewport, 'clientHeight', { value: 80 });
        act(() => result.current.viewportRef(viewport));
        viewport.scrollTop = 80;

        rerender({
            resetKey: 'normal',
            rows: [
                { key: 'new-1' },
                { key: 'new-2' },
                { key: 'a' },
                { key: 'b' },
                { key: 'c' }
            ]
        });

        expect(viewport.scrollTop).toBe(160);
    });

    it('returns to the start when the data set changes', () => {
        const { result, rerender } = renderHook(
            ({ resetKey, rows }: { resetKey: string; rows: Row[] }) =>
                useVirtualSidebarRows(rows, () => 40, {
                    preserveScrollAnchor: true,
                    resetKey
                }),
            {
                initialProps: {
                    resetKey: 'first',
                    rows: [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
                }
            }
        );
        const viewport = document.createElement('div');
        act(() => result.current.viewportRef(viewport));
        viewport.scrollTop = 80;

        rerender({
            resetKey: 'second',
            rows: [{ key: 'x' }, { key: 'y' }]
        });

        expect(viewport.scrollTop).toBe(0);
    });
});
