import type { ReactNode } from 'react';

import type { ScreenshotGallerySection } from '@/components/media/useScreenshotGalleryGrid';

import { ScreenshotGridSectionHeader } from './ScreenshotSelectableImageGrid';

export function VirtualTileGridRows<T>({
    columnCount,
    gap,
    getKey,
    renderItem,
    totalHeight,
    visibleRows
}: {
    columnCount: number;
    gap: number;
    getKey: (item: T) => string;
    renderItem: (item: T) => ReactNode;
    totalHeight: number;
    visibleRows: ReadonlyArray<{
        key: string;
        top: number;
        items: T[];
        section?: ScreenshotGallerySection;
    }>;
}) {
    return (
        <div className="p-1">
            <div className="relative" style={{ height: totalHeight }}>
                {visibleRows.map((row) =>
                    row.section ? (
                        <ScreenshotGridSectionHeader
                            key={row.key}
                            section={row.section}
                            className="absolute inset-x-0"
                            top={row.top}
                        />
                    ) : (
                        <div
                            key={row.key}
                            className="absolute inset-x-0 grid items-start"
                            style={{
                                top: row.top,
                                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                                gap
                            }}
                        >
                            {row.items.map((item) => (
                                <div key={getKey(item)} className="min-w-0">
                                    {renderItem(item)}
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
