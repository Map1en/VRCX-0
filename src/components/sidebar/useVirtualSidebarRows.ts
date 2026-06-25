import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_ROW_SIZE = 48;
const DEFAULT_OVERSCAN = 8;

type VirtualSidebarRow = {
    key?: unknown;
};

type VirtualSidebarViewport = {
    height: number;
    scrollTop: number;
};

type VirtualSidebarOptions = {
    overscan?: number;
};

type RowRefCallback = (element: HTMLElement | null) => void;

export function useVirtualSidebarRows<T extends VirtualSidebarRow>(
    rows: T[],
    estimateSize: (row: T, index: number) => unknown,
    options: VirtualSidebarOptions = {}
) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const measuredSizesRef = useRef(new Map<unknown, number>());
    const rowObserversRef = useRef(new Map<unknown, ResizeObserver>());
    const rowRefCallbacksRef = useRef(new Map<unknown, RowRefCallback>());
    const [viewport, setViewport] = useState<VirtualSidebarViewport>({
        scrollTop: 0,
        height: 0
    });
    const [measureVersion, setMeasureVersion] = useState(0);
    const overscan =
        typeof options.overscan === 'number' &&
        Number.isFinite(options.overscan)
            ? options.overscan
            : DEFAULT_OVERSCAN;

    const rowMetrics = useMemo(() => {
        let totalSize = 0;
        const offsets: number[] = [];
        const sizes: number[] = [];

        rows.forEach((row, index) => {
            const key = row?.key ?? index;
            const measuredSize = Number(measuredSizesRef.current.get(key));
            const estimatedSize = Number(estimateSize?.(row, index));
            const size =
                Number.isFinite(measuredSize) && measuredSize > 0
                    ? measuredSize
                    : Number.isFinite(estimatedSize) && estimatedSize > 0
                      ? estimatedSize
                      : DEFAULT_ROW_SIZE;
            offsets.push(totalSize);
            sizes.push(size);
            totalSize += size;
        });

        return { offsets, sizes, totalSize };
    }, [estimateSize, measureVersion, rows]);

    const measureElement = useCallback(
        (key: unknown, element: HTMLElement | null) => {
            const previousObserver = rowObserversRef.current.get(key);
            if (previousObserver) {
                previousObserver.disconnect();
                rowObserversRef.current.delete(key);
            }

            if (!element) {
                return;
            }

            const updateSize = () => {
                const nextSize = element.offsetHeight;
                if (!Number.isFinite(nextSize) || nextSize <= 0) {
                    return;
                }

                if (measuredSizesRef.current.get(key) === nextSize) {
                    return;
                }

                measuredSizesRef.current.set(key, nextSize);
                setMeasureVersion((version) => version + 1);
            };

            updateSize();

            if (typeof ResizeObserver !== 'undefined') {
                const observer = new ResizeObserver(updateSize);
                observer.observe(element);
                rowObserversRef.current.set(key, observer);
            }
        },
        []
    );

    const getRowRef = useCallback(
        (key: unknown) => {
            const cache = rowRefCallbacksRef.current;
            let callback = cache.get(key);
            if (!callback) {
                callback = (element) => measureElement(key, element);
                cache.set(key, callback);
            }
            return callback;
        },
        [measureElement]
    );

    useEffect(() => {
        const liveKeys = new Set<unknown>(
            rows.map((row, index) => row?.key ?? index)
        );
        let changed = false;

        for (const key of measuredSizesRef.current.keys()) {
            if (!liveKeys.has(key)) {
                measuredSizesRef.current.delete(key);
                rowObserversRef.current.get(key)?.disconnect();
                rowObserversRef.current.delete(key);
                rowRefCallbacksRef.current.delete(key);
                changed = true;
            }
        }

        for (const key of rowRefCallbacksRef.current.keys()) {
            if (!liveKeys.has(key)) {
                rowRefCallbacksRef.current.delete(key);
            }
        }

        if (changed) {
            setMeasureVersion((version) => version + 1);
        }
    }, [rows]);

    useEffect(() => {
        return () => {
            for (const observer of rowObserversRef.current.values()) {
                observer.disconnect();
            }
            rowObserversRef.current.clear();
        };
    }, []);

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
                const nextTop = element.scrollTop;
                const nextHeight = element.clientHeight || 0;
                setViewport((prev) =>
                    prev.scrollTop === nextTop && prev.height === nextHeight
                        ? prev
                        : { scrollTop: nextTop, height: nextHeight }
                );
            });
        };

        updateViewport();
        element.addEventListener('scroll', updateViewport, { passive: true });

        let observer: ResizeObserver | null = null;
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
        const nextTop = element.scrollTop;
        const nextHeight = element.clientHeight || 0;
        setViewport((prev) =>
            prev.scrollTop === nextTop && prev.height === nextHeight
                ? prev
                : { scrollTop: nextTop, height: nextHeight }
        );
    }, [rows.length, rowMetrics.totalSize]);

    const virtualItems = useMemo(() => {
        if (!rows.length) {
            return [];
        }

        const { offsets, sizes } = rowMetrics;
        const viewportBottom =
            viewport.scrollTop + Math.max(viewport.height, DEFAULT_ROW_SIZE);
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
        getRowRef,
        viewportRef,
        virtualItems,
        totalSize: rowMetrics.totalSize
    };
}
