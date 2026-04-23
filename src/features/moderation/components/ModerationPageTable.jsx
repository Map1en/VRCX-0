import {
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { PageFooter } from '@/components/layout/PageScaffold.jsx';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

export function ModerationPageTable({
    table,
    filteredRowsLength,
    pagination,
    pageSizes,
    onPageSizeChange,
    t
}) {
    return (
        <>
            <DataTableSurface>
                <DataTableScrollArea>
                    <Table className="app-data-table table-fixed">
                        <DataTableHeader table={table} />
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <TableRow key={row.original?.id || row.id}>
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
                    {t('view.moderation.generated.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.moderation.generated.of')}{' '}
                    <span className="text-foreground font-medium">
                        {filteredRowsLength}
                    </span>{' '}
                    {t('view.moderation.generated.moderation_row')}
                    {filteredRowsLength === 1 ? '' : 's'}
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
