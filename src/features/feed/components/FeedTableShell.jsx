import { Fragment } from 'react';

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
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { PageFooter } from '@/components/layout/PageScaffold.jsx';
import { Spinner } from '@/ui/shadcn/spinner';
import { Table, TableBody, TableCell, TableRow } from '@/ui/shadcn/table';

import { FeedExpandedRow } from './FeedTableParts.jsx';

export function FeedTableShell({
    table,
    columns,
    rows,
    loadStatus,
    favoritesOnly,
    isFavoritesLoaded,
    loadingPreviousInstancesKey,
    currentEndpoint,
    onOpenPreviousInstances,
    onNewInstance,
    onPreviewImage,
    pagination,
    pageSizes,
    resolvePageSize,
    setPagination,
    t
}) {
    return (
        <>
            <DataTableSurface>
                <DataTableScrollArea>
                    <DataTableColumnDndProvider table={table}>
                        <Table
                            className="table-fixed min-w-full"
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
                                                            row={row.original}
                                                            loadingHistoryKey={
                                                                loadingPreviousInstancesKey
                                                            }
                                                            endpoint={
                                                                currentEndpoint
                                                            }
                                                            onOpenPreviousInstances={
                                                                onOpenPreviousInstances
                                                            }
                                                            onNewInstance={
                                                                onNewInstance
                                                            }
                                                            onPreviewImage={
                                                                onPreviewImage
                                                            }
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
                                                {t('view.feed.generated.loading_feed_rows')}
                                            </span>
                                        ) : favoritesOnly &&
                                          !isFavoritesLoaded ? (
                                            t('view.feed.generated.favorites_are_still_hydrating')
                                        ) : loadStatus === 'error' ? (
                                            t('view.feed.generated.feed_query_failed')
                                        ) : (
                                            t(
                                                'view.feed.generated.no_feed_rows_match_the_current_filters'
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
                    {rows.length} {t('view.feed.generated.rows')}
                    {favoritesOnly
                        ? ` · ${t('view.feed.generated.favorites_only')}`
                        : ''}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={table.getState().pagination.pageIndex}
                    pageCount={table.getPageCount() || 1}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    onPageSizeChange={(value) =>
                        setPagination({
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
