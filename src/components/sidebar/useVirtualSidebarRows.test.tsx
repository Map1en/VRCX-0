// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useVirtualSidebarRows } from './useVirtualSidebarRows';

type Row = { key: string };

describe('useVirtualSidebarRows scroll anchoring', () => {
    afterEach(cleanup);

    it('keeps the focused row mounted outside the viewport without rendering the intervening rows', () => {
        const rows = Array.from({ length: 160 }, (_, index) => ({
            key: String(index)
        }));
        const { result, rerender } = renderHook(
            ({ keepMountedKey }: { keepMountedKey: string | null }) =>
                useVirtualSidebarRows(rows, () => 40, { keepMountedKey }),
            { initialProps: { keepMountedKey: '120' as string | null } }
        );
        expect(
            result.current.virtualItems.some((item) => item.key === '120')
        ).toBe(true);
        expect(result.current.virtualItems.length).toBeLessThan(20);
        rerender({ keepMountedKey: null });
        expect(
            result.current.virtualItems.some((item) => item.key === '120')
        ).toBe(false);
    });

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

    it('anchors on the first surviving row when leading rows are dropped', () => {
        const { result, rerender } = renderHook(
            ({ resetKey, rows }: { resetKey: string; rows: Row[] }) =>
                useVirtualSidebarRows(rows, () => 40, {
                    preserveScrollAnchor: true,
                    resetKey
                }),
            {
                initialProps: {
                    resetKey: 'normal',
                    rows: [
                        { key: 'a' },
                        { key: 'b' },
                        { key: 'c' },
                        { key: 'd' },
                        { key: 'e' },
                        { key: 'f' },
                        { key: 'g' },
                        { key: 'h' }
                    ]
                }
            }
        );
        const viewport = document.createElement('div');
        Object.defineProperty(viewport, 'clientHeight', { value: 80 });
        act(() => result.current.viewportRef(viewport));
        viewport.scrollTop = 120;

        rerender({
            resetKey: 'normal',
            rows: [
                { key: 'f' },
                { key: 'g' },
                { key: 'h' },
                { key: 'i' },
                { key: 'j' }
            ]
        });

        expect(viewport.scrollTop).toBe(0);
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
