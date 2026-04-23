import {
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import {
    LoadingState,
    PageBody,
    PageFooter
} from '@/components/layout/PageScaffold.jsx';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

import { FriendListEmptyState } from './FriendListViewParts.jsx';

export function FriendListTable({
    t,
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
}) {
    return (
        <PageBody>
            {isLoading ? (
                <LoadingState
                    label={t(
                        'view.friend_list.generated.loading_the_friend_roster_snapshot'
                    )}
                />
            ) : isError ? (
                <FriendListEmptyState
                    title={t(
                        'view.friend_list.generated.friend_roster_failed_to_load'
                    )}
                    description={
                        friendDetail ||
                        t(
                            'view.friend_list.generated.roster_bootstrap_did_not_complete'
                        )
                    }
                />
            ) : hasRows ? (
                <>
                    <DataTableSurface>
                        <DataTableScrollArea wideTable>
                            <Table className="w-max min-w-full">
                                <DataTableHeader
                                    table={table}
                                    onResetLayout={onResetTableLayout}
                                />
                                <TableBody>
                                    {table.getRowModel().rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            className="cursor-pointer"
                                            tabIndex={0}
                                            aria-label={t(
                                                'view.friend_list.generated_dynamic.open_value',
                                                {
                                                    value:
                                                        row.original
                                                            ?.displayName ||
                                                        row.original
                                                            ?.username ||
                                                        t(
                                                            'view.friend_list.generated.friend'
                                                        )
                                                }
                                            )}
                                            onKeyDown={(event) => {
                                                if (
                                                    event.key !== 'Enter' &&
                                                    event.key !== ' '
                                                ) {
                                                    return;
                                                }
                                                event.preventDefault();
                                                onOpenUser(row.original);
                                            }}
                                            onClick={() => onOpenUser(row.original)}
                                        >
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => (
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
                            {t('view.friend_list.generated.showing')}{' '}
                            <span className="text-foreground font-medium">
                                {table.getRowModel().rows.length}
                            </span>{' '}
                            {t('view.friend_list.generated.of')}{' '}
                            <span className="text-foreground font-medium">
                                {filteredRowsLength}
                            </span>{' '}
                            {t('view.friend_list.generated.friend')}
                            {filteredRowsLength === 1 ? '' : 's'}
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
                        'view.friend_list.generated.no_friends_match_the_current_filters'
                    )}
                    description={
                        favoritesOnly
                            ? t(
                                  'view.friend_list.generated.try_turning_off_favorites_only_or_broadening_the_search_query'
                              )
                            : t(
                                  'view.friend_list.generated.the_current_search_filters_excluded_every_friend_in_the_roster'
                              )
                    }
                />
            )}
        </PageBody>
    );
}
