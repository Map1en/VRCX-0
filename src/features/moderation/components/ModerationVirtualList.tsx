import { flexRender } from '@tanstack/react-table';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { DataTableColumnResizeHandle } from '@/components/data-table/DataTableColumnResizeHandle';
import {
    getStretchColumnId,
    resolveColumnLabel
} from '@/components/data-table/tableColumnLayout';
import { VirtualHistoryList } from '@/components/data-table/VirtualHistoryList';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';

import type { ModerationRow } from '../moderationPageTypes';

const MODERATION_ROW_CHUNK = 60;

export function ModerationVirtualList({
    table,
    resetKey,
    emptyState
}: {
    table: AppTable<ModerationRow>;
    resetKey: string;
    emptyState: ReactNode;
}) {
    const { t } = useTranslation();
    const density = usePreferencesStore((state) => state.tableDensity);
    const [visibleCount, setVisibleCount] = useState(MODERATION_ROW_CHUNK);
    const rows = table.getSortedRowModel().rows;
    const visibleRows = useMemo(
        () => rows.slice(0, visibleCount).map((row) => ({ key: row.id, row })),
        [rows, visibleCount]
    );
    const headers = table.getHeaderGroups().flatMap((group) => group.headers);
    const columns = table.getVisibleLeafColumns();
    const stretchColumnId = getStretchColumnId(table);
    const layout = {
        gridTemplateColumns: columns
            .map((column) =>
                column.id === stretchColumnId
                    ? `minmax(${column.getSize()}px, 1fr)`
                    : `${column.getSize()}px`
            )
            .join(' '),
        minWidth: columns.reduce((width, column) => width + column.getSize(), 0)
    };
    const hasMore = visibleCount < rows.length;

    function loadMore() {
        setVisibleCount((current) =>
            Math.min(rows.length, current + MODERATION_ROW_CHUNK)
        );
    }

    useEffect(() => {
        setVisibleCount(MODERATION_ROW_CHUNK);
    }, [resetKey]);

    const footer = hasMore ? (
        <Button variant="link" size="sm" onClick={loadMore}>
            {t('common.load_more')}
        </Button>
    ) : (
        <span>
            {rows.length}{' '}
            {t(
                rows.length === 1
                    ? 'view.moderation.label.moderation_row'
                    : 'view.moderation.label.moderation_rows'
            )}{' '}
            · {t('common.no_more')}
        </span>
    );

    return (
        <VirtualHistoryList
            rows={visibleRows}
            estimatedRowHeight={density === 'compact' ? 32 : 40}
            resetKey={resetKey}
            minWidth={layout.minWidth}
            hasMore={hasMore}
            loadingOlder={false}
            onLoadOlder={loadMore}
            latestLabel={t('view.moderation.label.back_to_top')}
            header={
                <div
                    className="grid min-h-[var(--vrcx-0-table-header-height)] items-center text-xs text-[var(--vrcx-0-table-header-foreground)]"
                    style={layout}
                >
                    {headers.map((header) => (
                        <div
                            key={header.id}
                            className="relative flex h-full min-w-0 items-center px-[var(--vrcx-0-table-cell-padding-inline)]"
                        >
                            {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                            )}
                            {header.column.getCanResize() ? (
                                <DataTableColumnResizeHandle
                                    header={header}
                                    label={resolveColumnLabel(header.column)}
                                />
                            ) : null}
                        </div>
                    ))}
                </div>
            }
            renderRow={({ row }) => (
                <div
                    className="grid min-h-[var(--vrcx-0-table-row-height)] items-center border-b border-[var(--vrcx-0-table-divider)] hover:bg-[var(--vrcx-0-table-row-hover-surface)]"
                    style={layout}
                >
                    {row.getVisibleCells().map((cell) => (
                        <div
                            key={cell.id}
                            className={`min-w-0 px-[var(--vrcx-0-table-cell-padding-inline)] ${cell.column.columnDef.meta?.tableCellClassName ?? ''}`}
                        >
                            {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                            )}
                        </div>
                    ))}
                </div>
            )}
            footer={footer}
            emptyState={emptyState}
        />
    );
}
