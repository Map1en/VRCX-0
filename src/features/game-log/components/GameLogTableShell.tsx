import type { Table as ReactTable } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';

import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { PageFooter } from '@/components/layout/PageScaffold';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

import { resolveGameLogPageSize } from '../gameLogState';
import type { GameLogPaginationSetter, GameLogRow } from '../gameLogTypes';

type GameLogTableShellProps = {
    pageCount: number;
    pageSizes: number[];
    rows: readonly GameLogRow[];
    setPagination: GameLogPaginationSetter;
    setSessionLimit(value: number): void;
    table: ReactTable<GameLogRow>;
};

export function GameLogTableShell({
    pageCount,
    pageSizes,
    rows,
    setPagination,
    setSessionLimit,
    table
}: GameLogTableShellProps) {
    const { t } = useTranslation();
    const pagination = table.getState().pagination;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <DataTableSurface>
                <DataTableScrollArea>
                    <DataTableColumnDndProvider table={table}>
                        <Table
                            className="min-w-full table-fixed"
                            style={getDataTableSizingStyle(table)}
                        >
                            <DataTableColumnSizeColGroup table={table} />
                            <DataTableHeader table={table} />
                            <TableBody>
                                {table.getRowModel().rows.map((row) => (
                                    <TableRow
                                        key={
                                            row.original?.rowId != null
                                                ? `${String(row.original.type)}:${String(row.original.rowId)}`
                                                : row.id
                                        }
                                    >
                                        <DataTableColumnSortableContext
                                            table={table}
                                        >
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => (
                                                    <ResizableTableCell
                                                        key={cell.id}
                                                        cell={cell}
                                                    />
                                                ))}
                                        </DataTableColumnSortableContext>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </DataTableColumnDndProvider>
                </DataTableScrollArea>
            </DataTableSurface>

            <PageFooter>
                <div className="text-muted-foreground text-sm">
                    {t('view.game_log.label.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.game_log.label.of')}{' '}
                    <span className="text-foreground font-medium">
                        {rows.length}
                    </span>{' '}
                    {t(
                        rows.length === 1
                            ? 'view.game_log.label.game_log_row'
                            : 'view.game_log.label.game_log_rows'
                    )}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageCount={pageCount}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    onPageSizeChange={(value: unknown) => {
                        const nextPageSize = resolveGameLogPageSize(
                            value,
                            pageSizes,
                            pagination.pageSize
                        );
                        setPagination({
                            pageIndex: 0,
                            pageSize: nextPageSize
                        });
                        setSessionLimit(nextPageSize);
                    }}
                />
            </PageFooter>
        </div>
    );
}
