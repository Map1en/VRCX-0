import {
    DataTableHeader,
    DataTablePagination
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    Table,
    TableBody,
    TableCell,
    TableRow
} from '@/ui/shadcn/table';

export function NotificationPageTable({
    table,
    detail,
    loadStatus,
    rowsCount,
    pagination,
    pageSizes,
    onPageSizeChange,
    t
}) {
    const visibleColumnCount = Math.max(table.getVisibleLeafColumns().length, 1);

    return (
        <>
            {detail ? (
                <div className="text-muted-foreground text-sm">
                    {userFacingErrorMessage(
                        detail,
                        'Failed to load notifications.'
                    )}
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                <div className="h-full overflow-auto">
                    <Table className="app-data-table table-fixed">
                        <DataTableHeader table={table} />
                        <TableBody>
                            {table.getRowModel().rows.length > 0 ? (
                                table.getRowModel().rows.map((row) => (
                                    <TableRow key={row.id}>
                                        {row.getVisibleCells().map((cell) => (
                                            <ResizableTableCell
                                                key={cell.id}
                                                cell={cell}
                                            />
                                        ))}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={visibleColumnCount}
                                        className="text-muted-foreground h-24 text-center"
                                    >
                                        {loadStatus === 'running'
                                            ? t('common.loading')
                                            : t('common.no_matching_entries')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-muted-foreground text-sm">
                    {rowsCount}{' '}
                    {t('view.notification.generated.notifications_in_view')}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageCount={table.getPageCount() || 1}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    previousLabel={t('table.pagination.previous')}
                    nextLabel={t('table.pagination.next')}
                    onPageSizeChange={onPageSizeChange}
                />
            </div>
        </>
    );
}
