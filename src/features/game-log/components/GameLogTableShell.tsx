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
    getLogFilterRowAttributes
} from '@/components/data-table/LogFilterContextMenu';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { PageFooter } from '@/components/layout/PageScaffold';
import { Table, TableBody } from '@/ui/shadcn/table';

import {
    getGameLogRowFilterTarget,
    useGameLogFilterCommands
} from '../gameLogFilterCommands';
import { resolveGameLogPageSize } from '../gameLogState';
import type { GameLogPaginationSetter, GameLogRow } from '../gameLogTypes';

type GameLogTableShellProps = {
    pageCount: number;
    pageSizes: number[];
    rows: readonly GameLogRow[];
    setPagination: GameLogPaginationSetter;
    table: AppTable<GameLogRow>;
};

export function GameLogTableShell({
    pageCount,
    pageSizes,
    rows,
    setPagination,
    table
}: GameLogTableShellProps) {
    const { t } = useTranslation();
    const filterCommands = useGameLogFilterCommands();
    const pagination = table.state.pagination;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
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
                                            key={
                                                row.original?.rowId != null
                                                    ? `${String(row.original.type)}:${String(row.original.rowId)}`
                                                    : row.id
                                            }
                                            {...getLogFilterRowAttributes(
                                                getGameLogRowFilterTarget(
                                                    row.original,
                                                    t
                                                )
                                            )}
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
                        i18nKey="view.game_log.label.showing_summary"
                        count={rows.length}
                        values={{ shown: table.getRowModel().rows.length }}
                        components={{
                            b: <span className="text-foreground font-medium" />
                        }}
                    />
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageCount={pageCount}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    onPageSizeChange={(value: string) => {
                        const nextPageSize = resolveGameLogPageSize(
                            value,
                            pageSizes,
                            pagination.pageSize
                        );
                        setPagination({
                            pageIndex: 0,
                            pageSize: nextPageSize
                        });
                    }}
                />
            </PageFooter>
        </div>
    );
}
