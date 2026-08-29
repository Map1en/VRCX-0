import type { PaginationState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
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

import type { FriendLogRow } from '../friendLogRows';

export function FriendLogPageTable({
    table,
    orderedRowsLength,
    pagination,
    pageSizes,
    onPageSizeChange
}: {
    table: AppTable<FriendLogRow>;
    orderedRowsLength: number;
    pagination: PaginationState;
    pageSizes: number[];
    onPageSizeChange: (value: string) => void;
}) {
    const { t } = useTranslation();

    return (
        <>
            <DataTableSurface>
                <DataTableScrollArea>
                    <DataTableColumnDndProvider table={table}>
                        <Table
                            className="table-fixed"
                            style={getDataTableSizingStyle(table)}
                        >
                            <DataTableColumnSizeColGroup table={table} />
                            <DataTableHeader table={table} />
                            <TableBody>
                                {table.getRowModel().rows.map((row) => (
                                    <TableRow
                                        key={row.original?.rowId || row.id}
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
                    {t('view.friend_log.label.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.friend_log.label.of')}{' '}
                    <span className="text-foreground font-medium">
                        {orderedRowsLength}
                    </span>{' '}
                    {t(
                        orderedRowsLength === 1
                            ? 'view.friend_log.label.log_row'
                            : 'view.friend_log.label.log_rows'
                    )}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    onPageSizeChange={onPageSizeChange}
                />
            </PageFooter>
        </>
    );
}
