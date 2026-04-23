import {
    DataTableHeader,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import {
    AvatarActionMenuItems,
    openAvatarDetails
} from './MyAvatarsViewParts.jsx';

export function MyAvatarsTableView({
    t,
    table,
    currentAvatarId,
    savingTagsAvatarId,
    updatingAvatarId,
    uploadingImageAvatarId,
    filteredCount,
    pageSizes,
    pagination,
    onAvatarAction,
    onPageSizeChange
}) {
    return (
        <>
            <DataTableSurface>
                <DataTableScrollArea wideTable>
                    <Table className="w-max min-w-full">
                        <DataTableHeader table={table} />
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <ContextMenu
                                    key={row.original?.id || row.id}
                                >
                                    <ContextMenuTrigger asChild>
                                        <TableRow
                                            className={[
                                                'cursor-pointer',
                                                row.original?.id ===
                                                    currentAvatarId
                                                    ? 'bg-primary/10'
                                                    : ''
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            tabIndex={0}
                                            aria-label={t(
                                                'view.my_avatars.generated_dynamic.open_value',
                                                {
                                                    value:
                                                        row.original?.name ||
                                                        row.original?.id ||
                                                        t(
                                                            'view.my_avatars.generated.avatar'
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
                                                openAvatarDetails(row.original);
                                            }}
                                            onClick={() =>
                                                openAvatarDetails(row.original)
                                            }
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
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                        <AvatarActionMenuItems
                                            avatar={row.original}
                                            isActive={
                                                row.original?.id ===
                                                currentAvatarId
                                            }
                                            disabled={
                                                updatingAvatarId ===
                                                    row.original?.id ||
                                                savingTagsAvatarId ===
                                                    row.original?.id ||
                                                uploadingImageAvatarId ===
                                                    row.original?.id
                                            }
                                            Item={ContextMenuItem}
                                            Group={ContextMenuGroup}
                                            Separator={ContextMenuSeparator}
                                            onAction={(action, avatar) =>
                                                void onAvatarAction(
                                                    action,
                                                    avatar
                                                )
                                            }
                                        />
                                    </ContextMenuContent>
                                </ContextMenu>
                            ))}
                        </TableBody>
                    </Table>
                </DataTableScrollArea>
            </DataTableSurface>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-muted-foreground text-sm">
                    {t('view.my_avatars.generated.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.my_avatars.generated.of')}{' '}
                    <span className="text-foreground font-medium">
                        {filteredCount}
                    </span>{' '}
                    {t('view.my_avatars.generated.avatar')}
                    {filteredCount === 1 ? '' : 's'}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    onPageSizeChange={onPageSizeChange}
                />
            </div>
        </>
    );
}
