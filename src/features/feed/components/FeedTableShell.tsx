import type { PaginationState } from '@tanstack/react-table';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTableEmptyRow,
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { PageFooter } from '@/components/layout/PageScaffold';
import { Spinner } from '@/ui/shadcn/spinner';
import { Table, TableBody, TableCell, TableRow } from '@/ui/shadcn/table';

import type {
    FeedColumns,
    FeedLoadStatus,
    FeedLocationActionPayload,
    FeedPaginationSetter,
    FeedRow,
    FeedTableInstance
} from '../feedTypes';
import { FeedExpandedRow } from './FeedTableParts';

type FeedTableShellProps = {
    columns: FeedColumns;
    favoritesOnly: boolean;
    isFavoritesLoaded: boolean;
    loadStatus: FeedLoadStatus;
    loadingPreviousInstancesKey: string;
    onNewInstance(payload?: FeedLocationActionPayload): void;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    onPaginationChange: FeedPaginationSetter;
    pageSizes: number[];
    pagination: PaginationState;
    resolvePageSize(
        candidate: unknown,
        pageSizes?: number[],
        fallback?: number
    ): number;
    rows: FeedRow[];
    table: FeedTableInstance;
};

export function FeedTableShell({
    columns,
    favoritesOnly,
    isFavoritesLoaded,
    loadStatus,
    loadingPreviousInstancesKey,
    onNewInstance,
    onOpenPreviousInstances,
    onPaginationChange,
    pageSizes,
    pagination,
    resolvePageSize,
    rows,
    table
}: FeedTableShellProps) {
    const { t } = useTranslation();

    return (
        <>
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
                                {table.getRowModel().rows.length > 0 ? (
                                    table.getRowModel().rows.map((row) => (
                                        <Fragment key={row.id}>
                                            <TableRow className="h-9">
                                                <DataTableColumnSortableContext
                                                    table={table}
                                                >
                                                    {row
                                                        .getVisibleCells()
                                                        .map((cell) => (
                                                            <ResizableTableCell
                                                                key={cell.id}
                                                                cell={cell}
                                                                className="px-2 py-1"
                                                            />
                                                        ))}
                                                </DataTableColumnSortableContext>
                                            </TableRow>
                                            {row.getIsExpanded() ? (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={
                                                            row.getVisibleCells()
                                                                .length
                                                        }
                                                    >
                                                        <FeedExpandedRow
                                                            loadingHistoryKey={
                                                                loadingPreviousInstancesKey
                                                            }
                                                            onNewInstance={
                                                                onNewInstance
                                                            }
                                                            onOpenPreviousInstances={
                                                                onOpenPreviousInstances
                                                            }
                                                            row={row.original}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ) : null}
                                        </Fragment>
                                    ))
                                ) : (
                                    <DataTableEmptyRow colSpan={columns.length}>
                                        {loadStatus === 'running' ? (
                                            <span className="inline-flex items-center gap-2">
                                                <Spinner />
                                                {t(
                                                    'view.feed.loading.loading_feed_rows'
                                                )}
                                            </span>
                                        ) : favoritesOnly &&
                                          !isFavoritesLoaded ? (
                                            t(
                                                'view.feed.label.favorites_are_still_hydrating'
                                            )
                                        ) : loadStatus === 'error' ? (
                                            t(
                                                'view.feed.error.feed_query_failed'
                                            )
                                        ) : (
                                            t(
                                                'view.feed.empty.no_feed_rows_match_the_current_filters'
                                            )
                                        )}
                                    </DataTableEmptyRow>
                                )}
                            </TableBody>
                        </Table>
                    </DataTableColumnDndProvider>
                </DataTableScrollArea>
            </DataTableSurface>

            <PageFooter>
                <div className="text-muted-foreground text-sm">
                    {rows.length} {t('view.feed.label.rows')}
                    {favoritesOnly
                        ? ` · ${t('view.feed.label.favorites_only')}`
                        : ''}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={table.getState().pagination.pageIndex}
                    pageCount={table.getPageCount() || 1}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    onPageSizeChange={(value: unknown) =>
                        onPaginationChange({
                            pageIndex: 0,
                            pageSize: resolvePageSize(
                                value,
                                pageSizes,
                                pagination.pageSize
                            )
                        })
                    }
                />
            </PageFooter>
        </>
    );
}
