import { useTranslation } from 'react-i18next';

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
import {
    LoadingState,
    PageBody,
    PageFooter
} from '@/components/layout/PageScaffold';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

import { FriendListEmptyState } from './FriendListViewParts';

export function FriendListTable({
    table,
    pageCount,
    pageSizes,
    pagination,
    filteredRowsLength,
    friendDetail,
    favoritesOnly,
    isLoading,
    isError,
    hasRows,
    onResetTableLayout,
    onPageSizeChange,
    onOpenUser
}: any) {
    const { t } = useTranslation();

    return (
        <PageBody>
            {isLoading ? (
                <LoadingState
                    label={t(
                        'view.friend_list.loading.loading_the_friend_roster_snapshot'
                    )}
                />
            ) : isError ? (
                <FriendListEmptyState
                    title={t(
                        'view.friend_list.error.friend_roster_failed_to_load'
                    )}
                    description={
                        friendDetail ||
                        t(
                            'view.friend_list.success.roster_bootstrap_did_not_complete'
                        )
                    }
                />
            ) : hasRows ? (
                <>
                    <DataTableSurface>
                        <DataTableScrollArea wideTable>
                            <DataTableColumnDndProvider table={table}>
                                <Table
                                    className="min-w-full table-fixed"
                                    style={getDataTableSizingStyle(table)}
                                >
                                    <DataTableColumnSizeColGroup
                                        table={table}
                                    />
                                    <DataTableHeader
                                        table={table}
                                        onResetLayout={onResetTableLayout}
                                    />
                                    <TableBody>
                                        {table
                                            .getRowModel()
                                            .rows.map((row: any) => (
                                                <TableRow
                                                    key={row.id}
                                                    className="cursor-pointer"
                                                    tabIndex={0}
                                                    aria-label={t(
                                                        'view.friend_list.dynamic.open_value',
                                                        {
                                                            value:
                                                                row.original
                                                                    ?.displayName ||
                                                                row.original
                                                                    ?.username ||
                                                                t(
                                                                    'view.friend_list.label.friend'
                                                                )
                                                        }
                                                    )}
                                                    onKeyDown={(event: any) => {
                                                        if (
                                                            event.key !==
                                                                'Enter' &&
                                                            event.key !== ' '
                                                        ) {
                                                            return;
                                                        }
                                                        event.preventDefault();
                                                        onOpenUser(
                                                            row.original
                                                        );
                                                    }}
                                                    onClick={() =>
                                                        onOpenUser(row.original)
                                                    }
                                                >
                                                    <DataTableColumnSortableContext
                                                        table={table}
                                                    >
                                                        {row
                                                            .getVisibleCells()
                                                            .map(
                                                                (cell: any) => (
                                                                    <ResizableTableCell
                                                                        key={
                                                                            cell.id
                                                                        }
                                                                        cell={
                                                                            cell
                                                                        }
                                                                    />
                                                                )
                                                            )}
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
                            {t('view.friend_list.label.showing')}{' '}
                            <span className="text-foreground font-medium">
                                {table.getRowModel().rows.length}
                            </span>{' '}
                            {t('view.friend_list.label.of')}{' '}
                            <span className="text-foreground font-medium">
                                {filteredRowsLength}
                            </span>{' '}
                            {t(
                                filteredRowsLength === 1
                                    ? 'view.friend_list.label.friend'
                                    : 'view.friend_list.label.friends'
                            )}
                        </div>
                        <DataTablePagination
                            table={table}
                            pageIndex={pagination.pageIndex}
                            pageCount={pageCount}
                            pageSize={pagination.pageSize}
                            pageSizes={pageSizes}
                            pageSizeLabel={t('table.pagination.rows_per_page')}
                            onPageSizeChange={onPageSizeChange}
                        />
                    </PageFooter>
                </>
            ) : (
                <FriendListEmptyState
                    title={t(
                        'view.friend_list.empty.no_friends_match_the_current_filters'
                    )}
                    description={
                        favoritesOnly
                            ? t(
                                  'view.friend_list.label.try_turning_off_favorites_only_or_broadening_the_search_query'
                              )
                            : t(
                                  'view.friend_list.label.the_current_search_filters_excluded_every_friend_in_the_roster'
                              )
                    }
                />
            )}
        </PageBody>
    );
}
