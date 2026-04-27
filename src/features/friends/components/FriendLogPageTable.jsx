import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { PageFooter } from '@/components/layout/PageScaffold.jsx';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

export function FriendLogPageTable({
    table,
    orderedRowsLength,
    pagination,
    pageSizes,
    onPageSizeChange,
    t
}) {
    return (
        <>
            <DataTableSurface>
                <DataTableScrollArea wideTable>
                    <DataTableColumnDndProvider table={table}>
                        <Table
                            className="table-fixed min-w-full"
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
                    {t('view.friend_log.generated.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.friend_log.generated.of')}{' '}
                    <span className="text-foreground font-medium">
                        {orderedRowsLength}
                    </span>{' '}
                    {t('view.friend_log.generated.log_row')}
                    {orderedRowsLength === 1 ? '' : 's'}
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
