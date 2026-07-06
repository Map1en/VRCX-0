import type {
    PaginationState,
    Table as ReactTable
} from '@tanstack/react-table';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableColumnDnd } from '@/components/data-table/dataTableColumnDndContext';
import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView';
import {
    ResizableTableCell,
    ResizableTableHead
} from '@/components/data-table/ResizableTableParts';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Table, TableBody, TableHeader, TableRow } from '@/ui/shadcn/table';

import type { MyAvatarActionHandler, MyAvatarRow } from '../myAvatarsTypes';
import { AvatarActionMenuItems, openAvatarDetails } from './MyAvatarsViewParts';

type MyAvatarsTableViewProps = {
    table: ReactTable<MyAvatarRow>;
    savingTagsAvatarId: string;
    updatingAvatarId: string;
    uploadingImageAvatarId: string;
    filteredCount: number;
    pageSizes: number[];
    pagination: PaginationState;
    onAvatarAction: MyAvatarActionHandler;
    onPageSizeChange: (value: string) => void;
};

function isInteractiveRowEvent(
    event: KeyboardEvent<HTMLElement> | MouseEvent<HTMLElement>
) {
    return (
        event.target instanceof HTMLElement &&
        Boolean(
            event.target.closest(
                'button,a,input,textarea,select,[role="button"],[role="menuitem"]'
            )
        )
    );
}

function MyAvatarsTableHeader({ table }: { table: ReactTable<MyAvatarRow> }) {
    const columnDnd = useDataTableColumnDnd();

    return (
        <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
                <DataTableColumnSortableContext
                    key={headerGroup.id}
                    table={table}
                >
                    <TableRow className="hover:bg-transparent">
                        {headerGroup.headers.map((header) => (
                            <ResizableTableHead
                                key={header.id}
                                header={header}
                                enableColumnReorder={columnDnd.enabled}
                                className={String(
                                    header.column.columnDef.meta
                                        ?.tableHeadClassName || ''
                                )}
                            />
                        ))}
                    </TableRow>
                </DataTableColumnSortableContext>
            ))}
        </TableHeader>
    );
}

export function MyAvatarsTableView({
    table,
    savingTagsAvatarId,
    updatingAvatarId,
    uploadingImageAvatarId,
    filteredCount,
    pageSizes,
    pagination,
    onAvatarAction,
    onPageSizeChange
}: MyAvatarsTableViewProps) {
    const { t } = useTranslation();
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';

    return (
        <>
            <DataTableSurface>
                <DataTableScrollArea wideTable>
                    <DataTableColumnDndProvider table={table}>
                        <Table
                            className="min-w-full table-fixed"
                            style={getDataTableSizingStyle(table)}
                        >
                            <DataTableColumnSizeColGroup table={table} />
                            <MyAvatarsTableHeader table={table} />
                            <TableBody>
                                {table.getRowModel().rows.map((row) => (
                                    <ContextMenu
                                        key={row.original?.id || row.id}
                                    >
                                        <ContextMenuTrigger
                                            render={
                                                <TableRow
                                                    className={[
                                                        'group h-8 cursor-pointer',
                                                        row.original?.id ===
                                                        currentAvatarId
                                                            ? 'bg-primary/10'
                                                            : ''
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' ')}
                                                    tabIndex={0}
                                                    aria-label={t(
                                                        'view.my_avatars.dynamic.open_value',
                                                        {
                                                            value:
                                                                row.original
                                                                    ?.name ||
                                                                row.original
                                                                    ?.id ||
                                                                t(
                                                                    'view.my_avatars.label.avatar'
                                                                )
                                                        }
                                                    )}
                                                    onKeyDown={(event) => {
                                                        if (
                                                            isInteractiveRowEvent(
                                                                event
                                                            )
                                                        ) {
                                                            return;
                                                        }
                                                        if (
                                                            event.key !==
                                                                'Enter' &&
                                                            event.key !== ' '
                                                        ) {
                                                            return;
                                                        }
                                                        event.preventDefault();
                                                        openAvatarDetails(
                                                            row.original
                                                        );
                                                    }}
                                                    onClick={(event) => {
                                                        if (
                                                            isInteractiveRowEvent(
                                                                event
                                                            )
                                                        ) {
                                                            return;
                                                        }
                                                        openAvatarDetails(
                                                            row.original
                                                        );
                                                    }}
                                                >
                                                    <DataTableColumnSortableContext
                                                        table={table}
                                                    >
                                                        {row
                                                            .getVisibleCells()
                                                            .map((cell) => (
                                                                <ResizableTableCell
                                                                    key={
                                                                        cell.id
                                                                    }
                                                                    cell={cell}
                                                                    className={[
                                                                        cell
                                                                            .column
                                                                            .columnDef
                                                                            .meta
                                                                            ?.tableCellClassName,
                                                                        'px-2 py-0.5'
                                                                    ]
                                                                        .filter(
                                                                            Boolean
                                                                        )
                                                                        .join(
                                                                            ' '
                                                                        )}
                                                                />
                                                            ))}
                                                    </DataTableColumnSortableContext>
                                                </TableRow>
                                            }
                                        />
                                        <ContextMenuContent className="w-max max-w-[90vw] min-w-52">
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
                                                onAction={(action, avatar) => {
                                                    onAvatarAction(
                                                        action,
                                                        avatar
                                                    );
                                                }}
                                            />
                                        </ContextMenuContent>
                                    </ContextMenu>
                                ))}
                            </TableBody>
                        </Table>
                    </DataTableColumnDndProvider>
                </DataTableScrollArea>
            </DataTableSurface>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-muted-foreground text-sm">
                    {t('view.my_avatars.label.showing')}{' '}
                    <span className="text-foreground font-medium">
                        {table.getRowModel().rows.length}
                    </span>{' '}
                    {t('view.my_avatars.label.of')}{' '}
                    <span className="text-foreground font-medium">
                        {filteredCount}
                    </span>{' '}
                    {t(
                        filteredCount === 1
                            ? 'view.my_avatars.label.avatar'
                            : 'view.my_avatars.label.avatars'
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
            </div>
        </>
    );
}
