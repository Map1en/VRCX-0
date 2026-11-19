import { useEffect, useMemo } from 'react';

import {
    GALLERY_GRID_SECTION_HEADER_HEIGHT,
    type ScreenshotGallerySection
} from '@/components/media/useScreenshotGalleryGrid';
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
    section?: ScreenshotGallerySection;
};

export type TileGridSection<T> = {
    key: string;
    label: string;
    items: readonly T[];
};

function measureTileGrid({
    width,
    minTileWidth,
    gap,
    aspectRatio,
    extraHeight
}: {
    width: number;
    minTileWidth: number;
    gap: number;
    aspectRatio: number;
    extraHeight: number;
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
            TILE_BORDER_HEIGHT +
            extraHeight
    );
    return { columnCount, tileHeight };
}

function buildTileGridRows<T>({
    sections,
    columnCount,
    tileHeight,
    gap
}: {
    sections: readonly TileGridSection<T>[];
    columnCount: number;
    tileHeight: number;
    gap: number;
}) {
    const rows: TileGridRow<T>[] = [];
    for (const section of sections) {
        if (section.label) {
            rows.push({
                key: `tile-section:${section.key}`,
                height: GALLERY_GRID_SECTION_HEADER_HEIGHT,
                items: [],
                section: {
                    key: section.key,
                    label: section.label,
                    count: section.items.length
                }
            });
        }
        const { items } = section;
        for (let index = 0; index < items.length; index += columnCount) {
            const isLastRow = index + columnCount >= items.length;
            rows.push({
                key: `tile-row:${section.key}:${index}`,
                height: tileHeight + (isLastRow ? 0 : gap),
                items: items.slice(index, index + columnCount)
            });
        }
    }
    return positionKnownSizeRows(rows);
}

type TileGridSource<T> =
    | { items: readonly T[]; sections?: never }
    | { items?: never; sections: readonly TileGridSection<T>[] };

export function useVirtualTileGrid<T>({
    items,
    sections,
    minTileWidth,
    gap,
    aspectRatio,
    extraHeight = 0,
    resetKey
}: TileGridSource<T> & {
    minTileWidth: number;
    gap: number;
    aspectRatio: number;
    extraHeight?: number;
    resetKey: string;
}) {
    const { resetScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();
    const { columnCount, tileHeight } = measureTileGrid({
        width: viewportMetrics.width - TILE_GRID_HORIZONTAL_INSET,
        minTileWidth,
        gap,
        aspectRatio,
        extraHeight
    });

    useEffect(() => {
        resetScrollTop();
    }, [resetKey, resetScrollTop]);

    const positionedRows = useMemo(
        () =>
            buildTileGridRows({
                sections: sections ?? [{ key: '', label: '', items }],
                columnCount,
                tileHeight,
                gap
            }),
        [columnCount, gap, items, sections, tileHeight]
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
