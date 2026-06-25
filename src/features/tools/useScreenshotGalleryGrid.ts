import { useEffect, useMemo } from 'react';

import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';

const GALLERY_GRID_HORIZONTAL_INSET = 8;
const GALLERY_GRID_OVERSCAN_MIN = 520;
const GALLERY_CARD_MIN_WIDTH = 208;
const GALLERY_CARD_HEIGHT = 196;
const GALLERY_GRID_GAP = 12;
const COMPACT_CARD_MIN_WIDTH = 150;
const COMPACT_CARD_HEIGHT = 156;
const COMPACT_GRID_GAP = 8;

function buildGalleryGridRows({
    cardHeight,
    gridColumnCount,
    gridGap,
    items
}: any) {
    const safeItems = Array.isArray(items) ? items : [];
    const rows = [];

    for (let index = 0; index < safeItems.length; index += gridColumnCount) {
        const isLastRow = index + gridColumnCount >= safeItems.length;
        rows.push({
            key: `screenshot-gallery-row:${index}`,
            height: cardHeight + (isLastRow ? 0 : gridGap),
            items: safeItems.slice(index, index + gridColumnCount)
        });
    }

    return positionKnownSizeRows(rows);
}

export function useScreenshotGalleryGrid({
    compact = false,
    initialScrollTop = 0,
    items,
    resetKey
}: any) {
    const { setScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();
    const cardHeight = compact ? COMPACT_CARD_HEIGHT : GALLERY_CARD_HEIGHT;
    const gridGap = compact ? COMPACT_GRID_GAP : GALLERY_GRID_GAP;
    const gridMinWidth = compact
        ? COMPACT_CARD_MIN_WIDTH
        : GALLERY_CARD_MIN_WIDTH;

    useEffect(() => {
        setScrollTop(initialScrollTop);
    }, [initialScrollTop, resetKey, setScrollTop]);

    const safeWidth = Math.max(
        0,
        (Number(viewportMetrics.width) || 0) - GALLERY_GRID_HORIZONTAL_INSET
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
