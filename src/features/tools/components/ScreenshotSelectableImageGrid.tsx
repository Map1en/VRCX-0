import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    getScreenshotGridDensityConfig,
    type ScreenshotGridDensity
} from '@/components/media/screenshotGridPreferences';
import {
    ScreenshotThumbnailCard,
    useScreenshotThumbnailTitleMap
} from '@/components/media/ScreenshotThumbnailCard';
import {
    GALLERY_GRID_SECTION_HEADER_HEIGHT,
    useScreenshotGalleryGrid,
    type ScreenshotGallerySection
} from '@/components/media/useScreenshotGalleryGrid';
import { useStableCommands } from '@/lib/useStableCommands';
import { cn } from '@/lib/utils';
import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import {
    buildScreenshotTimelineMarks,
    findCurrentSection
} from '../screenshotTimeline';
import { ScreenshotTimelineScrubber } from './ScreenshotTimelineScrubber';

export function ScreenshotGridSectionHeader({
    section,
    className,
    top
}: {
    section: ScreenshotGallerySection;
    className?: string;
    top?: number;
}) {
    return (
        <div
            className={cn('flex items-end gap-2 px-1 pb-2', className)}
            style={{ height: GALLERY_GRID_SECTION_HEADER_HEIGHT, top }}
        >
            <span className="truncate text-sm font-medium">
                {section.label}
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
                {section.count}
            </span>
        </div>
    );
}

const SelectableScreenshotTile = memo(function SelectableScreenshotTile({
    compact,
    item,
    title,
    selected,
    selectionActive,
    favorite,
    onOpen,
    onToggleSelect,
    onToggleFavorite
}: {
    compact: boolean;
    item: ScreenshotLibraryImage;
    title: string | undefined;
    selected: boolean;
    selectionActive: boolean;
    favorite: boolean;
    onOpen: (path: string) => void;
    onToggleSelect: (path: string, checked: boolean, shift: boolean) => void;
    onToggleFavorite: ((path: string, favorite: boolean) => void) | undefined;
}) {
    const { t } = useTranslation();
    return (
        <ScreenshotThumbnailCard
            compact={compact}
            fadeIn={false}
            item={item}
            onOpen={onOpen}
            title={title}
            selectable
            selected={selected}
            selectionActive={selectionActive}
            selectLabel={`${t('common.actions.select')} ${item.fileName}`}
            onToggleSelect={(checked, shift) =>
                onToggleSelect(item.path, checked, shift)
            }
            favorite={favorite}
            favoriteLabel={t(
                favorite
                    ? 'dialog.screenshot_metadata.unfavorite'
                    : 'dialog.screenshot_metadata.favorite'
            )}
            onToggleFavorite={
                onToggleFavorite
                    ? (nextFavorite) =>
                          onToggleFavorite(item.path, nextFavorite)
                    : undefined
            }
        />
    );
});

export function ScreenshotSelectableImageGrid({
    density,
    images,
    initialScrollTop,
    resetKey,
    revealPath,
    onRevealPathConsumed,
    hasSelection,
    selectedKeysSet,
    onOpen,
    onToggleSelect,
    onScrollPositionChange,
    favoritePaths,
    onToggleFavorite,
    sectionOf
}: {
    density: ScreenshotGridDensity;
    images: ScreenshotLibraryImage[];
    initialScrollTop: number;
    resetKey: string;
    revealPath?: string;
    onRevealPathConsumed?: () => void;
    hasSelection: boolean;
    selectedKeysSet: ReadonlySet<string>;
    onOpen: (path: string) => void;
    onToggleSelect: (path: string, checked: boolean, shift: boolean) => void;
    onScrollPositionChange?: (scrollTop: number) => void;
    favoritePaths?: ReadonlySet<string>;
    onToggleFavorite?: (path: string, favorite: boolean) => void;
    sectionOf?: (item: ScreenshotLibraryImage) => {
        key: string;
        label: string;
    };
}) {
    const {
        gridColumnCount,
        gridGap,
        gridMinWidth,
        rows,
        setScrollTop,
        totalHeight,
        viewportMetrics,
        viewportRef,
        visibleRows
    } = useScreenshotGalleryGrid({
        density,
        initialScrollTop,
        items: images,
        onRevealPathConsumed,
        resetKey,
        revealPath,
        sectionOf
    });
    const timelineMarks = useMemo(
        () => (sectionOf ? buildScreenshotTimelineMarks(rows) : []),
        [rows, sectionOf]
    );
    const showScrubber = timelineMarks.length >= 2;
    const stickySection =
        sectionOf && viewportMetrics.scrollTop > 0
            ? findCurrentSection(rows, viewportMetrics.scrollTop)?.section
            : undefined;
    const compactCard = getScreenshotGridDensityConfig(density).compactCard;
    const visibleItems = useMemo(
        () => visibleRows.flatMap((row) => row.items),
        [visibleRows]
    );
    const titleMap = useScreenshotThumbnailTitleMap(visibleItems);
    const tileCommands = useStableCommands({
        onOpen,
        onToggleSelect,
        onToggleFavorite
    });

    return (
        <div className="flex min-h-0 flex-1">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                    ref={viewportRef}
                    tabIndex={-1}
                    className={cn(
                        'min-h-0 flex-1 overflow-auto p-0.5 pr-1 outline-none',
                        showScrubber && '[scrollbar-width:none]'
                    )}
                    onScroll={(event) =>
                        onScrollPositionChange?.(event.currentTarget.scrollTop)
                    }
                >
                    <div className="relative" style={{ height: totalHeight }}>
                        {visibleRows.map((row) =>
                            row.section ? (
                                <ScreenshotGridSectionHeader
                                    key={row.key}
                                    section={row.section}
                                    className="absolute right-0 left-0"
                                    top={row.top}
                                />
                            ) : (
                                <div
                                    key={row.key}
                                    className="absolute right-0 left-0 grid"
                                    style={{
                                        top: row.top,
                                        gridTemplateColumns: `repeat(${gridColumnCount}, minmax(${gridMinWidth}px, 1fr))`,
                                        gap: gridGap
                                    }}
                                >
                                    {row.items.map(
                                        (item: ScreenshotLibraryImage) => (
                                            <SelectableScreenshotTile
                                                key={item.path}
                                                compact={compactCard}
                                                item={item}
                                                title={titleMap.get(item.path)}
                                                selected={selectedKeysSet.has(
                                                    item.path
                                                )}
                                                selectionActive={hasSelection}
                                                favorite={
                                                    favoritePaths?.has(
                                                        item.path
                                                    ) === true
                                                }
                                                onOpen={tileCommands.onOpen}
                                                onToggleSelect={
                                                    tileCommands.onToggleSelect
                                                }
                                                onToggleFavorite={
                                                    tileCommands.onToggleFavorite
                                                }
                                            />
                                        )
                                    )}
                                </div>
                            )
                        )}
                    </div>
                </div>
                {stickySection ? (
                    <ScreenshotGridSectionHeader
                        section={stickySection}
                        className="bg-background/85 pointer-events-none absolute inset-x-0 top-0 z-10 backdrop-blur"
                    />
                ) : null}
            </div>
            {showScrubber ? (
                <ScreenshotTimelineScrubber
                    marks={timelineMarks}
                    totalHeight={totalHeight}
                    viewportHeight={viewportMetrics.viewportHeight}
                    scrollTop={viewportMetrics.scrollTop}
                    onScrub={setScrollTop}
                />
            ) : null}
        </div>
    );
}
