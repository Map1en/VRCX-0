import { useEffect, useMemo } from 'react';

import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';

import {
    getFavoritesCardHeight,
    type FavoritesDensityConfig
} from './favoritesDensity';
import type { FavoriteItem } from './favoritesTypes';

const FAVORITES_GRID_HORIZONTAL_INSET = 8;
const FAVORITES_GRID_OVERSCAN_MIN = 420;

type FavoritesGridRowInput = {
    key: string;
    height: number;
    cardHeight: number;
    items: FavoriteItem[];
};

function buildFavoritesGridRows({
    cardHeight,
    gridColumnCount,
    gridGap,
    items
}: {
    cardHeight: number;
    gridColumnCount: number;
    gridGap: number;
    items: readonly FavoriteItem[];
}) {
    const safeItems = Array.isArray(items) ? items : [];
    const rows: FavoritesGridRowInput[] = [];

    for (let index = 0; index < safeItems.length; index += gridColumnCount) {
        const isLastRow = index + gridColumnCount >= safeItems.length;
        rows.push({
            key: `favorites-grid-row:${index}`,
            height: cardHeight + (isLastRow ? 0 : gridGap),
            cardHeight,
            items: safeItems.slice(index, index + gridColumnCount)
        });
    }

    return positionKnownSizeRows(rows);
}

type UseFavoritesVirtualGridOptions = {
    densityConfig: FavoritesDensityConfig;
    items: readonly FavoriteItem[];
    resetKey: string;
    showGroupLabel?: boolean;
};

export function useFavoritesVirtualGrid({
    densityConfig,
    items,
    resetKey,
    showGroupLabel
}: UseFavoritesVirtualGridOptions) {
    const { resetScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();

    useEffect(() => {
        resetScrollTop();
    }, [resetKey, resetScrollTop]);

    const gridGap = densityConfig.gridGap;
    const gridMinWidth = densityConfig.gridMinWidth;
    const safeWidth = Math.max(
        0,
        (Number(viewportMetrics.width) || 0) - FAVORITES_GRID_HORIZONTAL_INSET
    );
    const gridColumnCount = Math.max(
        1,
        Math.floor((safeWidth + gridGap) / (gridMinWidth + gridGap)) || 1
    );
    const columnWidth =
        (safeWidth - gridGap * (gridColumnCount - 1)) / gridColumnCount;
    const cardHeight = getFavoritesCardHeight({
        config: densityConfig,
        columnWidth,
        showGroupLabel
    });

    const positionedRows = useMemo(
        () =>
            buildFavoritesGridRows({
                cardHeight,
                gridColumnCount,
                gridGap,
                items
            }),
        [cardHeight, gridColumnCount, gridGap, items]
    );

    const visibleRows = useMemo(() => {
        const overscan = Math.max(
            FAVORITES_GRID_OVERSCAN_MIN,
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
        viewportRef,
        visibleRows
    };
}
