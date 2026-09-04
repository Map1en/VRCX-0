import type { PaginationState } from '@tanstack/react-table';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppRow, AppTable } from '@/components/data-table/appTable';
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
import {
    LoadingState,
    PageBody,
    PageFooter
} from '@/components/layout/PageScaffold';
import { Table, TableBody } from '@/ui/shadcn/table';

import type { FriendListRow } from '../friendListRows';
import { FriendListEmptyState } from './FriendListViewParts';

const FriendListTableRow = memo(
    function FriendListTableRow({
        row,
        table,
        onOpenUser
    }: {
        row: AppRow<FriendListRow>;
        table: AppTable<FriendListRow>;
        columns: AppTable<FriendListRow>['options']['columns'];
        columnLayoutKey: string;
        onOpenUser: (friend: FriendListRow) => void;
    }) {
        const { t } = useTranslation();

        return (
            <DataTableRow
                className="cursor-pointer"
                tabIndex={0}
                aria-label={t('view.friend_list.dynamic.open_value', {
                    value:
                        row.original?.displayName ||
                        row.original?.username ||
                        t('view.friend_list.label.friend')
                })}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') {
                        return;
                    }
                    event.preventDefault();
                    onOpenUser(row.original);
                }}
                onClick={() => onOpenUser(row.original)}
            >
                <DataTableColumnSortableContext table={table}>
                    {row.getVisibleCells().map((cell) => (
                        <ResizableTableCell key={cell.id} cell={cell} />
                    ))}
                </DataTableColumnSortableContext>
            </DataTableRow>
        );
    },
    (previous, next) =>
        previous.row.original === next.row.original &&
        previous.columns === next.columns &&
        previous.columnLayoutKey === next.columnLayoutKey &&
        previous.onOpenUser === next.onOpenUser
);

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
}: {
    table: AppTable<FriendListRow>;
    pageCount: number;
    pageSizes: number[];
    pagination: PaginationState;
    filteredRowsLength: number;
    friendDetail: string;
    favoritesOnly: boolean;
    isLoading: boolean;
    isError: boolean;
    hasRows: boolean;
    onResetTableLayout: () => void;
    onPageSizeChange: (value: string) => void;
    onOpenUser: (friend: FriendListRow) => void;
}) {
    const { t } = useTranslation();
    const columnLayoutKey = table
        .getVisibleLeafColumns()
        .map((column) => `${column.id}:${column.getSize()}`)
        .join('|');

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
                        <DataTableScrollArea>
                            <DataTableColumnDndProvider table={table}>
                                <Table
                                    className="table-fixed"
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
                                        {table.getRowModel().rows.map((row) => (
                                            <FriendListTableRow
                                                key={row.id}
                                                row={row}
                                                table={table}
                                                columns={table.options.columns}
                                                columnLayoutKey={
                                                    columnLayoutKey
                                                }
                                                onOpenUser={onOpenUser}
                                            />
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
