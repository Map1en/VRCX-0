import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTableHeader,
    DataTablePagination,
    DataTableRow,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { PageFooter } from '@/components/layout/PageScaffold';
import { Table, TableBody } from '@/ui/shadcn/table';

import type {
    ModerationPaginationState,
    ModerationRow
} from '../moderationPageTypes';

type ModerationPageTableProps = {
    table: AppTable<ModerationRow>;
    filteredRowsLength: number;
    pagination: ModerationPaginationState;
    pageSizes: number[];
    onPageSizeChange: (value: string) => void;
};

export function ModerationPageTable({
    table,
    filteredRowsLength,
    pagination,
    pageSizes,
    onPageSizeChange
}: ModerationPageTableProps) {
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
                                    <DataTableRow key={row.id}>
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
                                    </DataTableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </DataTableColumnDndProvider>
                </DataTableScrollArea>
            </DataTableSurface>

            <PageFooter>
                <div className="text-muted-foreground text-sm">
                    {t('view.moderation.label.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.moderation.label.of')}{' '}
                    <span className="text-foreground font-medium">
                        {filteredRowsLength}
                    </span>{' '}
                    {t(
                        filteredRowsLength === 1
                            ? 'view.moderation.label.moderation_row'
                            : 'view.moderation.label.moderation_rows'
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
