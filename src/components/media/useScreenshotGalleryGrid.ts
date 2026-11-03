import { useCallback, useEffect, useMemo, useRef } from 'react';

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
export const GALLERY_GRID_SECTION_HEADER_HEIGHT = 40;

export type ScreenshotGallerySection = {
    key: string;
    label: string;
    count: number;
};

type ScreenshotGalleryGridRow = Record<string, unknown> & {
    key: string;
    height: number;
    items: ScreenshotLibraryImage[];
    section?: ScreenshotGallerySection;
};

type ScreenshotGallerySectionOf = (item: ScreenshotLibraryImage) => {
    key: string;
    label: string;
};

function groupItemsBySection(
    items: readonly ScreenshotLibraryImage[],
    sectionOf: ScreenshotGallerySectionOf
) {
    const groups: Array<{
        section: ScreenshotGallerySection;
        items: ScreenshotLibraryImage[];
    }> = [];
    for (const item of items) {
        const { key, label } = sectionOf(item);
        const current = groups.at(-1);
        if (current && current.section.key === key) {
            current.items.push(item);
            current.section.count += 1;
        } else {
            groups.push({ section: { key, label, count: 1 }, items: [item] });
        }
    }
    return groups;
}

export function buildGalleryGridRows({
    cardHeight,
    gridColumnCount,
    gridGap,
    items,
    sectionOf
}: {
    cardHeight: number;
    gridColumnCount: number;
    gridGap: number;
    items: readonly ScreenshotLibraryImage[];
    sectionOf?: ScreenshotGallerySectionOf;
}) {
    const rows: ScreenshotGalleryGridRow[] = [];
    const groups = sectionOf
        ? groupItemsBySection(items, sectionOf)
        : [{ section: undefined, items: [...items] }];

    groups.forEach((group, groupIndex) => {
        const isLastGroup = groupIndex === groups.length - 1;
        if (group.section) {
            rows.push({
                key: `screenshot-gallery-section:${group.section.key}`,
                height: GALLERY_GRID_SECTION_HEADER_HEIGHT,
                items: [],
                section: group.section
            });
        }
        for (
            let index = 0;
            index < group.items.length;
            index += gridColumnCount
        ) {
            const isLastRow =
                isLastGroup && index + gridColumnCount >= group.items.length;
            rows.push({
                key: `screenshot-gallery-row:${group.section?.key ?? ''}:${index}`,
                height: cardHeight + (isLastRow ? 0 : gridGap),
                items: group.items.slice(index, index + gridColumnCount)
            });
        }
    });

    return positionKnownSizeRows<ScreenshotGalleryGridRow>(rows);
}

export function resolveScreenshotGridRevealScrollTop({
    rowIndex,
    rows,
    scrollTop,
    viewportHeight
}: {
    rowIndex: number;
    rows: ReadonlyArray<{ top: number; height: number }>;
    scrollTop: number;
    viewportHeight: number;
}) {
    const row = rowIndex < 0 ? null : rows[rowIndex];
    if (!row) {
        return null;
    }
    if (
        row.top >= scrollTop &&
        row.top + row.height <= scrollTop + viewportHeight
    ) {
        return null;
    }
    return Math.max(0, Math.round(row.top - (viewportHeight - row.height) / 2));
}

export function useScreenshotGalleryGrid({
    density = DEFAULT_SCREENSHOT_GRID_DENSITY,
    initialScrollTop = 0,
    items,
    onRevealPathConsumed,
    resetKey,
    revealPath = '',
    sectionOf
}: {
    density?: ScreenshotGridDensity;
    initialScrollTop?: number;
    items: readonly ScreenshotLibraryImage[];
    onRevealPathConsumed?: () => void;
    resetKey: string;
    revealPath?: string;
    sectionOf?: ScreenshotGallerySectionOf;
}) {
    const {
        setScrollTop,
        viewportMetrics,
        viewportRef: setViewportRef
    } = useScrollViewportMetrics();
    const viewportElementRef = useRef<HTMLElement | null>(null);
    const viewportRef = useCallback(
        (node: HTMLElement | null) => {
            viewportElementRef.current = node;
            setViewportRef(node);
        },
        [setViewportRef]
    );
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
                items,
                sectionOf
            }),
        [cardHeight, gridColumnCount, gridGap, items, sectionOf]
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

    useEffect(() => {
        if (
            !revealPath ||
            !items.length ||
            viewportMetrics.width <= 0 ||
            viewportMetrics.viewportHeight <= 0
        ) {
            return;
        }
        const rowIndex = positionedRows.rows.findIndex((row) =>
            row.items.some((item) => item.path === revealPath)
        );
        onRevealPathConsumed?.();
        if (rowIndex === -1) {
            return;
        }
        const nextScrollTop = resolveScreenshotGridRevealScrollTop({
            rowIndex,
            rows: positionedRows.rows,
            scrollTop: viewportMetrics.scrollTop,
            viewportHeight: viewportMetrics.viewportHeight
        });
        if (nextScrollTop !== null) {
            setScrollTop(nextScrollTop);
        }
        viewportElementRef.current?.focus({ preventScroll: true });
    }, [
        items,
        onRevealPathConsumed,
        positionedRows.rows,
        revealPath,
        setScrollTop,
        viewportMetrics.scrollTop,
        viewportMetrics.viewportHeight,
        viewportMetrics.width
    ]);

    return {
        cardHeight,
        gridColumnCount,
        gridGap,
        gridMinWidth,
        rows: positionedRows.rows,
        setScrollTop,
        totalHeight: positionedRows.totalHeight,
        viewportMetrics,
        viewportRef,
        visibleRows
    };
}
