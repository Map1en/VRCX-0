import { useEffect, useMemo, useRef, useState } from 'react';

import {
    buildMyAvatarsGridRows,
    getMyAvatarsGridMetrics,
    getVisibleMyAvatarsGridRows
} from './myAvatarsGrid.js';

export function useMyAvatarsGridVirtualization({
    cardScale,
    cardSpacing,
    deferredSearchQuery,
    filteredAvatars,
    platformFilter,
    releaseStatusFilter,
    tagFilters,
    viewMode
}) {
    const gridScrollRef = useRef(null);
    const [gridScrollMetrics, setGridScrollMetrics] = useState({
        scrollTop: 0,
        viewportHeight: 0,
        width: 0
    });

    useEffect(() => {
        if (viewMode !== 'grid') {
            return undefined;
        }

        function updateGridScrollMetrics() {
            const node = gridScrollRef.current;
            if (!node) {
                return;
            }

            const nextMetrics = {
                scrollTop: node.scrollTop,
                viewportHeight: node.clientHeight,
                width: node.clientWidth
            };

            setGridScrollMetrics((current) =>
                current.scrollTop === nextMetrics.scrollTop &&
                current.viewportHeight === nextMetrics.viewportHeight &&
                current.width === nextMetrics.width
                    ? current
                    : nextMetrics
            );
        }

        const node = gridScrollRef.current;
        if (!node) {
            return undefined;
        }

        updateGridScrollMetrics();
        node.addEventListener('scroll', updateGridScrollMetrics, {
            passive: true
        });

        const observer =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(updateGridScrollMetrics)
                : null;
        observer?.observe(node);
        window.addEventListener('resize', updateGridScrollMetrics);

        return () => {
            node.removeEventListener('scroll', updateGridScrollMetrics);
            observer?.disconnect();
            window.removeEventListener('resize', updateGridScrollMetrics);
        };
    }, [filteredAvatars.length, viewMode]);

    useEffect(() => {
        if (viewMode !== 'grid') {
            return;
        }

        const node = gridScrollRef.current;
        if (node) {
            node.scrollTop = 0;
        }

        setGridScrollMetrics((current) => ({
            ...current,
            scrollTop: 0
        }));
    }, [
        cardScale,
        cardSpacing,
        deferredSearchQuery,
        filteredAvatars.length,
        platformFilter,
        releaseStatusFilter,
        tagFilters,
        viewMode
    ]);

    const { gridGap, gridMinWidth, gridColumnCount, gridRowHeight } =
        getMyAvatarsGridMetrics({
            cardScale,
            cardSpacing,
            width: gridScrollMetrics.width
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
        gridGap,
        gridColumnCount,
        gridMinWidth,
        gridScrollRef,
        gridTotalHeight: gridRows.length * gridRowHeight,
        visibleGridRows
    };
}
