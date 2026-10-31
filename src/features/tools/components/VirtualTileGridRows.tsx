import type { ReactNode } from 'react';

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
    visibleRows: ReadonlyArray<{ key: string; top: number; items: T[] }>;
}) {
    return (
        <div className="p-1">
            <div className="relative" style={{ height: totalHeight }}>
                {visibleRows.map((row) => (
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
                ))}
            </div>
        </div>
    );
}
