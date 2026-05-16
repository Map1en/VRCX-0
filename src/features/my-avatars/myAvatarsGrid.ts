// @ts-nocheck
import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows.js';

import {
    MY_AVATARS_DEFAULT_GRID_DENSITY,
    sanitizeMyAvatarsGridDensity
} from './myAvatarsState.js';

const MY_AVATARS_GRID_DENSITY_CONFIGS = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        gridGap: 8,
        gridMinWidth: 180,
        imageHeightRatio: 0.66,
        overlayPaddingX: 8,
        overlayPaddingY: 7,
        overlayPaddingTop: 24,
        overlayNameOnlyPaddingTop: 16,
        overlayGap: 4,
        nameFontSize: 13,
        nameLineHeight: 1.15,
        tagFontSize: 9,
        maxVisibleTags: 2,
        rowPaddingY: 4
    }),
    compact: Object.freeze({
        value: 'compact',
        gridGap: 7,
        gridMinWidth: 150,
        imageHeightRatio: 0.64,
        overlayPaddingX: 7,
        overlayPaddingY: 6,
        overlayPaddingTop: 22,
        overlayNameOnlyPaddingTop: 14,
        overlayGap: 4,
        nameFontSize: 12,
        nameLineHeight: 1.12,
        tagFontSize: 8,
        maxVisibleTags: 1,
        rowPaddingY: 3
    }),
    dense: Object.freeze({
        value: 'dense',
        gridGap: 6,
        gridMinWidth: 125,
        imageHeightRatio: 0.6,
        overlayPaddingX: 6,
        overlayPaddingY: 5,
        overlayPaddingTop: 18,
        overlayNameOnlyPaddingTop: 12,
        overlayGap: 3,
        nameFontSize: 11,
        nameLineHeight: 1.1,
        tagFontSize: 8,
        maxVisibleTags: 0,
        rowPaddingY: 3
    })
});

export function getMyAvatarsGridDensityConfig(value) {
    return (
        MY_AVATARS_GRID_DENSITY_CONFIGS[sanitizeMyAvatarsGridDensity(value)] ||
        MY_AVATARS_GRID_DENSITY_CONFIGS[MY_AVATARS_DEFAULT_GRID_DENSITY]
    );
}

export function getMyAvatarsGridMetrics({
    cardScale,
    cardSpacing,
    gridDensity,
    width
}) {
    if (gridDensity) {
        const densityConfig = getMyAvatarsGridDensityConfig(gridDensity);
        const gridGap = densityConfig.gridGap;
        const gridMinWidth = densityConfig.gridMinWidth;
        const gridColumnCount = Math.max(
            1,
            Math.floor((width + gridGap) / (gridMinWidth + gridGap)) || 1
        );
        const gridColumnWidth =
            width > 0
                ? Math.max(
                      gridMinWidth,
                      (width - gridGap * Math.max(0, gridColumnCount - 1)) /
                          gridColumnCount
                  )
                : gridMinWidth;
        const gridRowHeight = Math.ceil(
            gridColumnWidth * densityConfig.imageHeightRatio +
                densityConfig.rowPaddingY +
                gridGap
        );

        return {
            densityConfig,
            gridGap,
            gridMinWidth,
            gridColumnCount,
            gridColumnWidth,
            gridRowHeight
        };
    }

    const gridGap = Math.round(12 * cardSpacing);
    const gridMinWidth = Math.round(Math.max(200, 320 * cardScale));
    const gridColumnCount = Math.max(
        1,
        Math.floor((width + gridGap) / (gridMinWidth + gridGap)) || 1
    );
    const gridColumnWidth =
        width > 0
            ? Math.max(
                  gridMinWidth,
                  (width - gridGap * Math.max(0, gridColumnCount - 1)) /
                      gridColumnCount
              )
            : gridMinWidth;
    const rowPaddingY = 4;
    const gridRowHeight = Math.ceil(
        gridColumnWidth * 0.66 + rowPaddingY + gridGap
    );

    return {
        gridGap,
        gridMinWidth,
        gridColumnCount,
        gridColumnWidth,
        gridRowHeight
    };
}

export function buildMyAvatarsGridRows({
    avatars,
    gridColumnCount,
    gridRowHeight
}) {
    const rows = [];
    const visibleAvatars = Array.isArray(avatars) ? avatars : [];
    for (
        let index = 0;
        index < visibleAvatars.length;
        index += gridColumnCount
    ) {
        rows.push({
            key: `grid-row:${index}`,
            avatars: visibleAvatars.slice(index, index + gridColumnCount),
            height: gridRowHeight
        });
    }
    return positionKnownSizeRows(rows).rows;
}

export function getVisibleMyAvatarsGridRows({
    gridRows,
    scrollTop,
    viewportHeight
}) {
    const overscan = Math.max(480, viewportHeight);
    return getVisibleKnownSizeRows({
        rows: gridRows,
        scrollTop,
        viewportHeight,
        overscan
    });
}
