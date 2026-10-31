import type { PaginationState } from '@tanstack/react-table';
import { Trans, useTranslation } from 'react-i18next';

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
import {
    LogFilterContextMenu,
    getLogFilterRowAttributes,
    type LogFilterCommands
} from '@/components/data-table/LogFilterContextMenu';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { PageFooter } from '@/components/layout/PageScaffold';
import { Table, TableBody } from '@/ui/shadcn/table';

import type { FriendLogRow } from '../friendLogRows';

export function FriendLogPageTable({
    table,
    filterCommands,
    orderedRowsLength,
    pagination,
    pageSizes,
    onPageSizeChange
}: {
    table: AppTable<FriendLogRow>;
    filterCommands: LogFilterCommands;
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
                            <LogFilterContextMenu commands={filterCommands}>
                                <TableBody>
                                    {table.getRowModel().rows.map((row) => (
                                        <DataTableRow
                                            key={row.original?.rowId || row.id}
                                            {...getLogFilterRowAttributes({
                                                userId:
                                                    row.original.userId || '',
                                                userName:
                                                    row.original
                                                        .resolvedDisplayName ||
                                                    row.original.displayName ||
                                                    '',
                                                type: row.original.type,
                                                typeLabel: t(
                                                    `view.friend_log.filters.${row.original.type}`
                                                )
                                            })}
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
                                        </DataTableRow>
                                    ))}
                                </TableBody>
                            </LogFilterContextMenu>
                        </Table>
                    </DataTableColumnDndProvider>
                </DataTableScrollArea>
            </DataTableSurface>

            <PageFooter>
                <div className="text-muted-foreground text-sm">
                    <Trans
                        i18nKey="view.friend_log.label.showing_summary"
                        count={orderedRowsLength}
                        values={{ shown: table.getRowModel().rows.length }}
                        components={{
                            b: <span className="text-foreground font-medium" />
                        }}
                    />
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
