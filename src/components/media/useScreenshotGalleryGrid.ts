import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';
import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import {
    DEFAULT_SCREENSHOT_GRID_DENSITY,
    getScreenshotGridDensityConfig,
    type ScreenshotGridDensity
} from './screenshotGridPreferences';

const GALLERY_GRID_HORIZONTAL_INSET = 8;
const GALLERY_GRID_OVERSCAN_MIN = 520;

type ScreenshotGalleryGridRow = Record<string, unknown> & {
    key: string;
    height: number;
    items: ScreenshotLibraryImage[];
};

function buildGalleryGridRows({
    cardHeight,
    gridColumnCount,
    gridGap,
    items
}: {
    cardHeight: number;
    gridColumnCount: number;
    gridGap: number;
    items: readonly ScreenshotLibraryImage[];
}) {
    const rows: ScreenshotGalleryGridRow[] = [];

    for (let index = 0; index < items.length; index += gridColumnCount) {
        const isLastRow = index + gridColumnCount >= items.length;
        rows.push({
            key: `screenshot-gallery-row:${index}`,
            height: cardHeight + (isLastRow ? 0 : gridGap),
            items: items.slice(index, index + gridColumnCount)
        });
    }

    return positionKnownSizeRows<ScreenshotGalleryGridRow>(rows);
}

export function resolveScreenshotGridRevealScrollTop({
    index,
    columnCount,
    rows,
    scrollTop,
    viewportHeight
}: {
    index: number;
    columnCount: number;
    rows: ReadonlyArray<{ top: number; height: number }>;
    scrollTop: number;
    viewportHeight: number;
}) {
    const row = index < 0 ? null : rows[Math.floor(index / columnCount)];
    if (!row) {
        return null;
    }
    if (
        row.top >= scrollTop &&
        row.top + row.height <= scrollTop + viewportHeight
    ) {
        return null;
    }
    return Math.max(0, Math.round(row.top - (viewportHeight - row.height) / 2));
}

export function useScreenshotGalleryGrid({
    density = DEFAULT_SCREENSHOT_GRID_DENSITY,
    initialScrollTop = 0,
    items,
    onRevealPathConsumed,
    resetKey,
    revealPath = ''
}: {
    density?: ScreenshotGridDensity;
    initialScrollTop?: number;
    items: readonly ScreenshotLibraryImage[];
    onRevealPathConsumed?: () => void;
    resetKey: string;
    revealPath?: string;
}) {
    const {
        setScrollTop,
        viewportMetrics,
        viewportRef: setViewportRef
    } = useScrollViewportMetrics();
    const viewportElementRef = useRef<HTMLElement | null>(null);
    const viewportRef = useCallback(
        (node: HTMLElement | null) => {
            viewportElementRef.current = node;
            setViewportRef(node);
        },
        [setViewportRef]
    );
    const densityConfig = getScreenshotGridDensityConfig(density);
    const cardHeight = densityConfig.cardHeight;
    const gridGap = densityConfig.gridGap;
    const gridMinWidth = densityConfig.cardMinWidth;

    useEffect(() => {
        setScrollTop(initialScrollTop);
    }, [initialScrollTop, resetKey, setScrollTop]);

    const safeWidth = Math.max(
        0,
        viewportMetrics.width - GALLERY_GRID_HORIZONTAL_INSET
    );
    const gridColumnCount = Math.max(
        1,
        Math.floor((safeWidth + gridGap) / (gridMinWidth + gridGap)) || 1
    );

    const positionedRows = useMemo(
        () =>
            buildGalleryGridRows({
                cardHeight,
                gridColumnCount,
                gridGap,
                items
            }),
        [cardHeight, gridColumnCount, gridGap, items]
    );

    const visibleRows = useMemo(() => {
        const overscan = Math.max(
            GALLERY_GRID_OVERSCAN_MIN,
            viewportMetrics.viewportHeight
        );
        return getVisibleKnownSizeRows({
            rows: positionedRows.rows,
            scrollTop: viewportMetrics.scrollTop,
            viewportHeight: viewportMetrics.viewportHeight,
            overscan
        });
    }, [
        positionedRows.rows,
        viewportMetrics.scrollTop,
        viewportMetrics.viewportHeight
    ]);

    useEffect(() => {
        if (
            !revealPath ||
            !items.length ||
            viewportMetrics.width <= 0 ||
            viewportMetrics.viewportHeight <= 0
        ) {
            return;
        }
        const index = items.findIndex((item) => item.path === revealPath);
        onRevealPathConsumed?.();
        if (index === -1) {
            return;
        }
        const nextScrollTop = resolveScreenshotGridRevealScrollTop({
            index,
            columnCount: gridColumnCount,
            rows: positionedRows.rows,
            scrollTop: viewportMetrics.scrollTop,
            viewportHeight: viewportMetrics.viewportHeight
        });
        if (nextScrollTop !== null) {
            setScrollTop(nextScrollTop);
        }
        viewportElementRef.current?.focus({ preventScroll: true });
    }, [
        gridColumnCount,
        items,
        onRevealPathConsumed,
        positionedRows.rows,
        revealPath,
        setScrollTop,
        viewportMetrics.scrollTop,
        viewportMetrics.viewportHeight,
        viewportMetrics.width
    ]);

    return {
        cardHeight,
        gridColumnCount,
        gridGap,
        gridMinWidth,
        totalHeight: positionedRows.totalHeight,
        viewportMetrics,
        viewportRef,
        visibleRows
    };
}
