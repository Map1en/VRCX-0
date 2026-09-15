import { useEffect, useMemo } from 'react';

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

export function useScreenshotGalleryGrid({
    density = DEFAULT_SCREENSHOT_GRID_DENSITY,
    initialScrollTop = 0,
    items,
    resetKey
}: {
    density?: ScreenshotGridDensity;
    initialScrollTop?: number;
    items: readonly ScreenshotLibraryImage[];
    resetKey: string;
}) {
    const { setScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();
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
