import { useEffect, useMemo } from 'react';

import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';

const TILE_GRID_HORIZONTAL_INSET = 12;
const TILE_GRID_OVERSCAN_MIN = 480;
const TILE_BORDER_HEIGHT = 2;

type TileGridRow<T> = {
    key: string;
    height: number;
    items: T[];
};

function measureTileGrid({
    width,
    minTileWidth,
    gap,
    aspectRatio
}: {
    width: number;
    minTileWidth: number;
    gap: number;
    aspectRatio: number;
}) {
    const safeWidth = Math.max(0, width);
    const columnCount = Math.max(
        1,
        Math.floor((safeWidth + gap) / (minTileWidth + gap)) || 1
    );
    const tileWidth = Math.max(
        0,
        (safeWidth - gap * (columnCount - 1)) / columnCount
    );
    const tileHeight = Math.ceil(
        Math.max(0, tileWidth - TILE_BORDER_HEIGHT) / aspectRatio +
            TILE_BORDER_HEIGHT
    );
    return { columnCount, tileHeight };
}

function buildTileGridRows<T>({
    items,
    columnCount,
    tileHeight,
    gap
}: {
    items: readonly T[];
    columnCount: number;
    tileHeight: number;
    gap: number;
}) {
    const rows: TileGridRow<T>[] = [];
    for (let index = 0; index < items.length; index += columnCount) {
        const rowItems = items.slice(index, index + columnCount);
        const isLastRow = index + columnCount >= items.length;
        rows.push({
            key: `tile-row:${index}`,
            height: tileHeight + (isLastRow ? 0 : gap),
            items: rowItems
        });
    }
    return positionKnownSizeRows(rows);
}

export function useVirtualTileGrid<T>({
    items,
    minTileWidth,
    gap,
    aspectRatio,
    resetKey
}: {
    items: readonly T[];
    minTileWidth: number;
    gap: number;
    aspectRatio: number;
    resetKey: string;
}) {
    const { resetScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();
    const { columnCount, tileHeight } = measureTileGrid({
        width: viewportMetrics.width - TILE_GRID_HORIZONTAL_INSET,
        minTileWidth,
        gap,
        aspectRatio
    });

    useEffect(() => {
        resetScrollTop();
    }, [resetKey, resetScrollTop]);

    const positionedRows = useMemo(
        () =>
            buildTileGridRows({
                items,
                columnCount,
                tileHeight,
                gap
            }),
        [columnCount, gap, items, tileHeight]
    );

    const visibleRows = useMemo(
        () =>
            getVisibleKnownSizeRows({
                rows: positionedRows.rows,
                scrollTop: viewportMetrics.scrollTop,
                viewportHeight: viewportMetrics.viewportHeight,
                overscan: Math.max(
                    TILE_GRID_OVERSCAN_MIN,
                    viewportMetrics.viewportHeight
                )
            }),
        [
            positionedRows.rows,
            viewportMetrics.scrollTop,
            viewportMetrics.viewportHeight
        ]
    );

    return {
        columnCount,
        totalHeight: positionedRows.totalHeight,
        viewportRef,
        visibleRows
    };
}
