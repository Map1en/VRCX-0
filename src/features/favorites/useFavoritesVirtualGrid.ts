import { useEffect, useMemo } from 'react';

import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';

const FAVORITES_GRID_HORIZONTAL_INSET = 8;
const FAVORITES_GRID_OVERSCAN_MIN = 420;

function calculateFavoriteCardHeight({
    cardScale,
    cardSpacing,
    showGroupLabel
}: any) {
    const scale = Math.max(0.5, Number(cardScale) || 1);
    const spacing = Math.max(0.5, Number(cardSpacing) || 1);
    const mediaSize = Math.max(28, Math.round(48 * scale));
    const paddingY = Math.max(4, Math.round(8 * scale * spacing));
    const textHeight = showGroupLabel ? 52 : 36;

    return Math.max(mediaSize, textHeight) + paddingY * 2 + 2;
}

function getFavoritesGridMetrics({
    cardScale,
    cardSpacing,
    showGroupLabel,
    width
}: any) {
    const safeWidth = Math.max(
        0,
        (Number(width) || 0) - FAVORITES_GRID_HORIZONTAL_INSET
    );
    const safeScale = Math.max(0.5, Number(cardScale) || 1);
    const safeSpacing = Math.max(0.5, Number(cardSpacing) || 1);
    const gridGap = Math.max(4, Math.round(8 * safeSpacing));
    const gridMinWidth = Math.max(120, Math.round(260 * safeScale));
    const gridColumnCount = Math.max(
        1,
        Math.floor((safeWidth + gridGap) / (gridMinWidth + gridGap)) || 1
    );
    const cardHeight = calculateFavoriteCardHeight({
        cardScale: safeScale,
        cardSpacing: safeSpacing,
        showGroupLabel
    });

    return {
        cardHeight,
        gridColumnCount,
        gridGap,
        gridMinWidth
    };
}

function buildFavoritesGridRows({
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
            key: `favorites-grid-row:${index}`,
            height: cardHeight + (isLastRow ? 0 : gridGap),
            cardHeight,
            items: safeItems.slice(index, index + gridColumnCount)
        });
    }

    return positionKnownSizeRows(rows);
}

export function useFavoritesVirtualGrid({
    cardScale,
    cardSpacing,
    items,
    resetKey,
    showGroupLabel
}: any) {
    const { resetScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();

    useEffect(() => {
        resetScrollTop();
    }, [resetKey, resetScrollTop]);

    const { cardHeight, gridColumnCount, gridGap, gridMinWidth } =
        getFavoritesGridMetrics({
            cardScale,
            cardSpacing,
            showGroupLabel,
            width: viewportMetrics.width
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
