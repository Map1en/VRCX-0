import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';

const DEFAULT_ROW_SIZE = 48;
const DEFAULT_OVERSCAN = 8;

type VirtualRowKey = string | number;

type VirtualSidebarRow = {
    key?: VirtualRowKey;
};

type VirtualSidebarViewport = {
    height: number;
    scrollTop: number;
};

type VirtualSidebarOptions = {
    overscan?: number;
    preserveScrollAnchor?: boolean;
    resetKey?: string;
};

type VirtualRowMetrics = {
    indexesByKey: Map<VirtualRowKey, number>;
    offsets: number[];
    sizes: number[];
    totalSize: number;
};

type RowRefCallback = (element: HTMLElement | null) => void;

function findFirstVisibleIndex(
    offsets: number[],
    sizes: number[],
    scrollTop: number
) {
    let start = 0;
    let end = offsets.length;
    while (start < end) {
        const index = Math.floor((start + end) / 2);
        if (offsets[index] + sizes[index] <= scrollTop) {
            start = index + 1;
        } else {
            end = index;
        }
    }
    return start;
}

function findVisibleEndIndex(offsets: number[], viewportBottom: number) {
    let start = 0;
    let end = offsets.length;
    while (start < end) {
        const index = Math.floor((start + end) / 2);
        if (offsets[index] < viewportBottom) {
            start = index + 1;
        } else {
            end = index;
        }
    }
    return start;
}

export function useVirtualSidebarRows<T extends VirtualSidebarRow>(
    rows: T[],
    estimateSize: (row: T, index: number) => number,
    options: VirtualSidebarOptions = {}
) {
    const viewportElementRef = useRef<HTMLDivElement | null>(null);
    const [viewportElement, setViewportElement] =
        useState<HTMLDivElement | null>(null);
    const viewportRef = useCallback((node: HTMLDivElement | null) => {
        viewportElementRef.current = node;
        setViewportElement(node);
    }, []);
    const [measuredSizes, setMeasuredSizes] = useState(
        () => new Map<VirtualRowKey, number>()
    );
    const rowObserversRef = useRef(new Map<VirtualRowKey, ResizeObserver>());
    const rowRefCallbacksRef = useRef(new Map<VirtualRowKey, RowRefCallback>());
    const [viewport, setViewport] = useState<VirtualSidebarViewport>({
        scrollTop: 0,
        height: 0
    });
    const overscan =
        typeof options.overscan === 'number' &&
        Number.isFinite(options.overscan)
            ? options.overscan
            : DEFAULT_OVERSCAN;
    const preserveScrollAnchor = options.preserveScrollAnchor === true;
    const resetKey = options.resetKey ?? '';

    const rowMetrics = useMemo(() => {
        let totalSize = 0;
        const indexesByKey = new Map<VirtualRowKey, number>();
        const offsets: number[] = [];
        const sizes: number[] = [];

        rows.forEach((row, index) => {
            const key = row?.key ?? index;
            indexesByKey.set(key, index);
            const measuredSize = Number(measuredSizes.get(key));
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

        return { indexesByKey, offsets, sizes, totalSize };
    }, [estimateSize, measuredSizes, rows]);
    const previousLayoutRef = useRef<{
        metrics: VirtualRowMetrics;
        resetKey: string;
        rows: T[];
    } | null>(null);

    useLayoutEffect(() => {
        const element = viewportElementRef.current;
        const previousLayout = previousLayoutRef.current;
        previousLayoutRef.current = { metrics: rowMetrics, resetKey, rows };
        if (!element || !previousLayout) {
            return;
        }
        if (previousLayout.resetKey !== resetKey) {
            element.scrollTop = 0;
            setViewport((current) =>
                current.scrollTop === 0 ? current : { ...current, scrollTop: 0 }
            );
            return;
        }
        if (
            !preserveScrollAnchor ||
            element.scrollTop <= 0 ||
            previousLayout.rows.length === 0
        ) {
            return;
        }

        const previousIndex = findFirstVisibleIndex(
            previousLayout.metrics.offsets,
            previousLayout.metrics.sizes,
            element.scrollTop
        );
        if (previousIndex >= previousLayout.rows.length) {
            return;
        }

        const previousRow = previousLayout.rows[previousIndex];
        const anchorKey = previousRow?.key ?? previousIndex;
        const nextIndex = rowMetrics.indexesByKey.get(anchorKey) ?? -1;
        if (nextIndex < 0) {
            return;
        }

        const previousStart = previousLayout.metrics.offsets[previousIndex];
        const nextStart = rowMetrics.offsets[nextIndex];
        if (
            Number.isFinite(previousStart) &&
            Number.isFinite(nextStart) &&
            previousStart !== nextStart
        ) {
            const scrollTop = element.scrollTop + nextStart - previousStart;
            element.scrollTop = scrollTop;
            setViewport((current) =>
                current.scrollTop === scrollTop
                    ? current
                    : { ...current, scrollTop }
            );
        }
    }, [preserveScrollAnchor, resetKey, rowMetrics, rows]);

    const measureElement = useCallback(
        (key: VirtualRowKey, element: HTMLElement | null) => {
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

                setMeasuredSizes((current) => {
                    if (current.get(key) === nextSize) {
                        return current;
                    }
                    const next = new Map(current);
                    next.set(key, nextSize);
                    return next;
                });
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
        (key: VirtualRowKey) => {
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
        const liveKeys = new Set<VirtualRowKey>(
            rows.map((row, index) => row?.key ?? index)
        );
        for (const key of rowObserversRef.current.keys()) {
            if (!liveKeys.has(key)) {
                rowObserversRef.current.get(key)?.disconnect();
                rowObserversRef.current.delete(key);
            }
        }

        for (const key of rowRefCallbacksRef.current.keys()) {
            if (!liveKeys.has(key)) {
                rowRefCallbacksRef.current.delete(key);
            }
        }

        setMeasuredSizes((current) => {
            const next = new Map(
                Array.from(current).filter(([key]) => liveKeys.has(key))
            );
            return next.size === current.size ? current : next;
        });
    }, [rows]);

    useEffect(() => {
        const rowObservers = rowObserversRef;
        return () => {
            for (const observer of rowObservers.current.values()) {
                observer.disconnect();
            }
            rowObservers.current.clear();
        };
    }, []);

    useEffect(() => {
        const element = viewportElement;
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
    }, [viewportElement]);

    useEffect(() => {
        const element = viewportElementRef.current;
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

    const visibleWindow = useMemo(() => {
        if (!rows.length) {
            return { firstIndex: 0, lastIndex: 0 };
        }

        const { offsets, sizes } = rowMetrics;
        const viewportBottom =
            viewport.scrollTop + Math.max(viewport.height, DEFAULT_ROW_SIZE);
        const firstIndex = findFirstVisibleIndex(
            offsets,
            sizes,
            viewport.scrollTop
        );
        const lastIndex = Math.max(
            firstIndex,
            findVisibleEndIndex(offsets, viewportBottom)
        );

        return { firstIndex, lastIndex };
    }, [rowMetrics, rows, viewport.height, viewport.scrollTop]);

    const virtualItems = useMemo(() => {
        if (!rows.length) {
            return [];
        }

        const { offsets, sizes } = rowMetrics;
        const startIndex = Math.max(0, visibleWindow.firstIndex - overscan);
        const endIndex = Math.min(
            rows.length,
            visibleWindow.lastIndex + overscan
        );

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
    }, [overscan, rowMetrics, rows, visibleWindow]);

    const scrollKeyToView = useCallback(
        (key: VirtualRowKey, topInset = 0) => {
            const element = viewportElementRef.current;
            if (!element) {
                return;
            }
            const index = rowMetrics.indexesByKey.get(key) ?? -1;
            if (index < 0) {
                return;
            }
            const offset = rowMetrics.offsets[index];
            const size = rowMetrics.sizes[index];
            if (!Number.isFinite(offset) || !Number.isFinite(size)) {
                return;
            }
            const viewTop = element.scrollTop;
            const viewBottom = viewTop + element.clientHeight;
            if (offset < viewTop + topInset) {
                element.scrollTop = Math.max(0, offset - topInset);
            } else if (offset + size > viewBottom) {
                element.scrollTop = offset + size - element.clientHeight;
            }
        },
        [rowMetrics]
    );
    const scrollToStart = useCallback(() => {
        if (viewportElementRef.current) {
            viewportElementRef.current.scrollTop = 0;
        }
    }, []);

    return {
        getRowRef,
        viewportRef,
        virtualItems,
        totalSize: rowMetrics.totalSize,
        firstVisibleIndex: visibleWindow.firstIndex,
        scrollKeyToView,
        scrollToStart,
        scrollTop: viewport.scrollTop
    };
}
