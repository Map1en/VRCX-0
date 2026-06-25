import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type ViewportMetrics = Readonly<{
    scrollTop: number;
    viewportHeight: number;
    width: number;
}>;

type UseScrollViewportMetricsOptions = {
    enabled?: boolean;
};

const EMPTY_VIEWPORT_METRICS = Object.freeze({
    scrollTop: 0,
    viewportHeight: 0,
    width: 0
});

function readViewportMetrics(node: HTMLElement | null): ViewportMetrics {
    if (!node) {
        return EMPTY_VIEWPORT_METRICS;
    }

    return {
        scrollTop: node.scrollTop,
        viewportHeight: node.clientHeight,
        width: node.clientWidth
    };
}

function updateMetricsIfChanged(
    setViewportMetrics: Dispatch<SetStateAction<ViewportMetrics>>,
    nextMetrics: ViewportMetrics
) {
    setViewportMetrics((current: ViewportMetrics) =>
        current.scrollTop === nextMetrics.scrollTop &&
        current.viewportHeight === nextMetrics.viewportHeight &&
        current.width === nextMetrics.width
            ? current
            : nextMetrics
    );
}

export function useScrollViewportMetrics({
    enabled = true
}: UseScrollViewportMetricsOptions = {}) {
    const viewportRef = useRef<HTMLElement | null>(null);
    const pendingScrollTopRef = useRef<number | null>(null);
    const [viewportElement, setViewportElement] = useState<HTMLElement | null>(
        null
    );
    const [viewportMetrics, setViewportMetrics] = useState<ViewportMetrics>(
        EMPTY_VIEWPORT_METRICS
    );

    const updateViewportMetrics = useCallback(() => {
        const nextMetrics = readViewportMetrics(viewportRef.current);
        pendingScrollTopRef.current = nextMetrics.scrollTop;
        updateMetricsIfChanged(setViewportMetrics, nextMetrics);
    }, []);

    const resetScrollTop = useCallback(() => {
        pendingScrollTopRef.current = 0;
        const node = viewportRef.current;
        if (node) {
            node.scrollTop = 0;
        }

        setViewportMetrics((current: ViewportMetrics) =>
            current.scrollTop === 0
                ? current
                : {
                      ...current,
                      scrollTop: 0
                  }
        );
    }, []);

    const setScrollTop = useCallback((value: unknown) => {
        const nextScrollTop = Math.max(0, Number(value) || 0);
        pendingScrollTopRef.current = nextScrollTop;
        const node = viewportRef.current;
        if (node) {
            node.scrollTop = nextScrollTop;
        }

        setViewportMetrics((current: ViewportMetrics) =>
            current.scrollTop === nextScrollTop
                ? current
                : {
                      ...current,
                      scrollTop: nextScrollTop
                  }
        );
    }, []);

    const setViewportRef = useCallback(
        (node: HTMLElement | null) => {
            viewportRef.current = node;
            setViewportElement(node);
            if (enabled && node) {
                const pendingScrollTop = pendingScrollTopRef.current;
                if (pendingScrollTop !== null) {
                    node.scrollTop = pendingScrollTop;
                }
                updateMetricsIfChanged(
                    setViewportMetrics,
                    readViewportMetrics(node)
                );
            }
        },
        [enabled]
    );

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const node = viewportElement;
        if (!node) {
            return undefined;
        }

        updateViewportMetrics();
        node.addEventListener('scroll', updateViewportMetrics, {
            passive: true
        });

        const observer =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(updateViewportMetrics)
                : null;
        observer?.observe(node);
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', updateViewportMetrics);
        }

        return () => {
            node.removeEventListener('scroll', updateViewportMetrics);
            observer?.disconnect();
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', updateViewportMetrics);
            }
        };
    }, [enabled, updateViewportMetrics, viewportElement]);

    return {
        resetScrollTop,
        setScrollTop,
        viewportMetrics,
        viewportRef: setViewportRef
    };
}
