import {
    getVisibleKnownSizeRows,
    positionKnownSizeRows
} from '@/lib/knownSizeVirtualRows';

import type {
    MyAvatarRow,
    MyAvatarsGridDensity,
    MyAvatarsGridDensityConfig,
    MyAvatarsGridRow
} from './myAvatarsTypes';

const MY_AVATARS_IMAGE_ASPECT_RATIO = 4 / 3;

const MY_AVATARS_GRID_CARD_PADDING = 2;

const MY_AVATARS_GRID_DENSITY_CONFIGS = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        gridGap: 8,
        gridMinWidth: 180,
        overlayPaddingX: 8,
        overlayPaddingY: 7,
        overlayPaddingTop: 24,
        overlayNameOnlyPaddingTop: 16,
        overlayGap: 4,
        nameFontSize: 13,
        nameLineHeight: 1.15,
        tagFontSize: 9,
        maxVisibleTags: 2
    }),
    compact: Object.freeze({
        value: 'compact',
        gridGap: 7,
        gridMinWidth: 150,
        overlayPaddingX: 7,
        overlayPaddingY: 6,
        overlayPaddingTop: 22,
        overlayNameOnlyPaddingTop: 14,
        overlayGap: 4,
        nameFontSize: 12,
        nameLineHeight: 1.12,
        tagFontSize: 8,
        maxVisibleTags: 1
    }),
    dense: Object.freeze({
        value: 'dense',
        gridGap: 6,
        gridMinWidth: 125,
        overlayPaddingX: 6,
        overlayPaddingY: 5,
        overlayPaddingTop: 18,
        overlayNameOnlyPaddingTop: 12,
        overlayGap: 3,
        nameFontSize: 11,
        nameLineHeight: 1.1,
        tagFontSize: 8,
        maxVisibleTags: 0
    })
});

export function getMyAvatarsGridDensityConfig(
    value: MyAvatarsGridDensity
): MyAvatarsGridDensityConfig {
    return MY_AVATARS_GRID_DENSITY_CONFIGS[value];
}

type MyAvatarsGridMetricsInput = {
    gridDensity: MyAvatarsGridDensity;
    width: number;
};

export function getMyAvatarsGridMetrics({
    gridDensity,
    width
}: MyAvatarsGridMetricsInput) {
    const densityConfig = getMyAvatarsGridDensityConfig(gridDensity);
    const gridPadding = MY_AVATARS_GRID_CARD_PADDING;
    const gridInset = gridPadding * 2;
    const gridGap = Math.max(0, densityConfig.gridGap - gridInset);
    const gridMinWidth = densityConfig.gridMinWidth + gridInset;
    const gridColumnCount = Math.max(
        1,
        Math.floor((width + gridGap) / (gridMinWidth + gridGap)) || 1
    );
    const gridColumnWidth =
        (width - gridGap * (gridColumnCount - 1)) / gridColumnCount;
    const cardWidth = Math.max(0, gridColumnWidth - gridInset);
    const cardHeight = Math.round(cardWidth / MY_AVATARS_IMAGE_ASPECT_RATIO);
    const cellHeight = cardHeight + gridInset;

    return {
        densityConfig,
        gridGap,
        gridMinWidth,
        gridPadding,
        gridColumnCount,
        cellHeight
    };
}

type BuildMyAvatarsGridRowsInput = {
    avatars: readonly MyAvatarRow[] | null | undefined;
    cellHeight: number;
    gridColumnCount: number;
    gridGap: number;
};

export function buildMyAvatarsGridRows({
    avatars,
    cellHeight,
    gridColumnCount,
    gridGap
}: BuildMyAvatarsGridRowsInput) {
    const rows: Omit<MyAvatarsGridRow, 'top'>[] = [];
    const visibleAvatars = Array.isArray(avatars) ? avatars : [];
    for (
        let index = 0;
        index < visibleAvatars.length;
        index += gridColumnCount
    ) {
        const isLastRow = index + gridColumnCount >= visibleAvatars.length;
        rows.push({
            key: `grid-row:${index}`,
            avatars: visibleAvatars.slice(index, index + gridColumnCount),
            cellHeight,
            height: cellHeight + (isLastRow ? 0 : gridGap)
        });
    }
    return positionKnownSizeRows(rows);
}

type VisibleMyAvatarsGridRowsInput = {
    gridRows: readonly MyAvatarsGridRow[] | null | undefined;
    scrollTop: number;
    viewportHeight: number;
};

export function getVisibleMyAvatarsGridRows({
    gridRows,
    scrollTop,
    viewportHeight
}: VisibleMyAvatarsGridRowsInput) {
    const overscan = Math.max(480, viewportHeight);
    return getVisibleKnownSizeRows({
        rows: gridRows,
        scrollTop,
        viewportHeight,
        overscan
    });
}
