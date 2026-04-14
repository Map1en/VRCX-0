import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_ROW_SIZE = 48;
const DEFAULT_OVERSCAN = 8;

export function useVirtualSidebarRows(rows, estimateSize, options = {}) {
    const viewportRef = useRef(null);
    const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
    const overscan = Number.isFinite(options.overscan) ? options.overscan : DEFAULT_OVERSCAN;

    const rowMetrics = useMemo(() => {
        let totalSize = 0;
        const offsets = [];
        const sizes = [];

        rows.forEach((row, index) => {
            const estimatedSize = Number(estimateSize?.(row, index));
            const size = Number.isFinite(estimatedSize) && estimatedSize > 0
                ? estimatedSize
                : DEFAULT_ROW_SIZE;
            offsets.push(totalSize);
            sizes.push(size);
            totalSize += size;
        });

        return { offsets, sizes, totalSize };
    }, [estimateSize, rows]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) {
            return undefined;
        }

        let frameId = 0;
        const updateViewport = () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                setViewport({
                    scrollTop: element.scrollTop,
                    height: element.clientHeight || 0
                });
            });
        };

        updateViewport();
        element.addEventListener('scroll', updateViewport, { passive: true });

        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(updateViewport);
            observer.observe(element);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', updateViewport);
        }

        return () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            element.removeEventListener('scroll', updateViewport);
            observer?.disconnect();
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', updateViewport);
            }
        };
    }, []);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) {
            return;
        }
        setViewport({
            scrollTop: element.scrollTop,
            height: element.clientHeight || 0
        });
    }, [rows.length, rowMetrics.totalSize]);

    const virtualItems = useMemo(() => {
        if (!rows.length) {
            return [];
        }

        const { offsets, sizes } = rowMetrics;
        const viewportBottom = viewport.scrollTop + Math.max(viewport.height, DEFAULT_ROW_SIZE);
        let firstIndex = 0;
        while (
            firstIndex < rows.length &&
            offsets[firstIndex] + sizes[firstIndex] < viewport.scrollTop
        ) {
            firstIndex += 1;
        }

        let lastIndex = firstIndex;
        while (lastIndex < rows.length && offsets[lastIndex] < viewportBottom) {
            lastIndex += 1;
        }

        const startIndex = Math.max(0, firstIndex - overscan);
        const endIndex = Math.min(rows.length, lastIndex + overscan);

        return rows.slice(startIndex, endIndex).map((row, offset) => {
            const index = startIndex + offset;
            return {
                index,
                key: row?.key ?? index,
                row,
                size: sizes[index],
                start: offsets[index]
            };
        });
    }, [overscan, rowMetrics, rows, viewport.height, viewport.scrollTop]);

    return {
        viewportRef,
        virtualItems,
        totalSize: rowMetrics.totalSize
    };
}
