import {
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { DataTableHeader } from '@/components/data-table/DataTableView.jsx';
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
                    <Table className="w-max min-w-full">
                        <DataTableHeader table={table} />
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <TableRow key={row.original?.rowId || row.id}>
                                    {row.getVisibleCells().map((cell) => (
                                        <ResizableTableCell
                                            key={cell.id}
                                            cell={cell}
                                        />
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
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
