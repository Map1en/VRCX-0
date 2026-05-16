// @ts-nocheck
import { useEffect, useMemo } from 'react';

import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics.js';

import {
    buildMyAvatarsGridRows,
    getMyAvatarsGridMetrics,
    getVisibleMyAvatarsGridRows
} from './myAvatarsGrid.js';

const MY_AVATARS_GRID_HORIZONTAL_INSET = 12;

export function useMyAvatarsGridVirtualization({
    deferredSearchQuery,
    filteredAvatars,
    gridDensity,
    platformFilter,
    releaseStatusFilter,
    tagFilters,
    viewMode
}) {
    const {
        resetScrollTop,
        viewportMetrics: gridScrollMetrics,
        viewportRef: gridScrollRef
    } = useScrollViewportMetrics({ enabled: viewMode === 'grid' });

    useEffect(() => {
        if (viewMode !== 'grid') {
            return;
        }

        resetScrollTop();
    }, [
        deferredSearchQuery,
        filteredAvatars.length,
        gridDensity,
        platformFilter,
        resetScrollTop,
        releaseStatusFilter,
        tagFilters,
        viewMode
    ]);

    const {
        densityConfig,
        gridGap,
        gridMinWidth,
        gridColumnCount,
        gridRowHeight
    } = getMyAvatarsGridMetrics({
        gridDensity,
        width: Math.max(
            0,
            gridScrollMetrics.width - MY_AVATARS_GRID_HORIZONTAL_INSET
        )
    });
    const gridRows = useMemo(
        () =>
            buildMyAvatarsGridRows({
                avatars: filteredAvatars,
                gridColumnCount,
                gridRowHeight
            }),
        [filteredAvatars, gridColumnCount, gridRowHeight]
    );
    const visibleGridRows = useMemo(
        () =>
            getVisibleMyAvatarsGridRows({
                gridRows,
                scrollTop: gridScrollMetrics.scrollTop,
                viewportHeight: gridScrollMetrics.viewportHeight
            }),
        [
            gridRows,
            gridScrollMetrics.scrollTop,
            gridScrollMetrics.viewportHeight
        ]
    );

    return {
        densityConfig,
        gridGap,
        gridColumnCount,
        gridMinWidth,
        gridScrollRef,
        gridTotalHeight: gridRows.length * gridRowHeight,
        visibleGridRows
    };
}
