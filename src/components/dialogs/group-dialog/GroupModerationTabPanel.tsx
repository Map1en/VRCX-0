import { DownloadIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
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
import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';
import { TabsContent } from '@/ui/shadcn/tabs';

import { downloadJsonFile } from './groupDialogDownloads';
import { GroupListState } from './GroupListState';
import {
    moderationRowSearchText,
    moderationRowStatus,
    moderationRowUserId,
    moderationStatusTone,
    type GroupModerationAction,
    type GroupModerationStatusTone,
    type GroupModerationTab
} from './groupModerationRows';
import {
    getGroupModerationColumnIds,
    useGroupModerationColumns
} from './useGroupModerationColumns';
import { useGroupModerationTable } from './useGroupModerationTable';

const ALL_ROLES_VALUE = 'all';

const SELECTED_ROW_ACCENT_CLASS: Record<GroupModerationStatusTone, string> = {
    neutral: 'border-l-border',
    active: 'border-l-emerald-500',
    pending: 'border-l-amber-500',
    danger: 'border-l-destructive'
};

export interface GroupModerationServerSelectOption {
    label: string;
    value: string;
}

export interface GroupModerationServerControl {
    query: string;
    onQueryChange: (value: string) => void;
    sort: string;
    onSortChange: (value: string) => void;
    sortOptions: GroupModerationServerSelectOption[];
    roleId: string;
    onRoleChange: (value: string) => void;
    roleOptions: GroupModerationServerSelectOption[];
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    loadedCount: number;
}

export function GroupModerationTabPanel({
    actionKey,
    error,
    group,
    loading,
    onOpenUser,
    onReload,
    onRunAction,
    onToggleAllVisible,
    onToggleRow,
    rows,
    selectable = false,
    selectedIds,
    server,
    tab,
    toolbarExtra
}: {
    actionKey: string;
    error: string;
    group: GroupProfileRecord;
    loading: boolean;
    onOpenUser: (row: EntityRecord) => void;
    onReload: () => void;
    onRunAction: (action: GroupModerationAction, row: EntityRecord) => void;
    onToggleAllVisible?: (userIds: string[], checked: boolean) => void;
    onToggleRow?: (userId: string, checked: boolean) => void;
    rows: EntityRecord[];
    selectable?: boolean;
    selectedIds?: ReadonlySet<string>;
    server?: GroupModerationServerControl;
    tab: GroupModerationTab;
    toolbarExtra?: ReactNode;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const sortable = !server;

    const filteredRows = useMemo(() => {
        if (server) {
            return rows;
        }
        const query = search.trim().toLowerCase();
        if (!query) {
            return rows;
        }
        return rows.filter((row) =>
            moderationRowSearchText(row, group).includes(query)
        );
    }, [group, rows, search, server]);

    const columns = useGroupModerationColumns({
        actionKey,
        group,
        onOpenUser,
        onRunAction,
        onToggleAllVisible,
        onToggleRow,
        selectable,
        selectedIds: selectedIds || null,
        sortable,
        tab: tab.value
    });
    const columnIds = useMemo(
        () => getGroupModerationColumnIds(selectable),
        [selectable]
    );
    const { pageSizes, pagination, setPagination, table } =
        useGroupModerationTable({
            columnIds,
            columns,
            paged: sortable,
            rows: filteredRows,
            tableId: `group-moderation:${tab.value}`
        });

    useEffect(() => {
        setPagination((current) => ({ ...current, pageIndex: 0 }));
    }, [search, setPagination]);

    const serverQueryActive = Boolean(server && server.query.trim());
    const clientQueryActive = !server && Boolean(search.trim());
    const emptyMessage = server
        ? serverQueryActive
            ? t('common.no_matching_records')
            : t('dialog.group.empty.no_rows')
        : clientQueryActive && rows.length
          ? t('common.no_matching_records')
          : t('dialog.group.empty.no_rows');

    return (
        <TabsContent
            value={tab.value}
            className="m-0 flex min-h-0 flex-1 flex-col gap-3 pt-4"
        >
            <div className="flex shrink-0 items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={loading}
                        onClick={onReload}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('common.actions.refresh')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!rows.length}
                        onClick={() =>
                            downloadJsonFile(
                                `${group.id}_${tab.value}.json`,
                                rows
                            )
                        }
                    >
                        <DownloadIcon data-icon="inline-start" />
                        JSON
                    </Button>
                    {toolbarExtra}
                    <span className="text-muted-foreground text-sm tabular-nums">
                        {server
                            ? server.loadedCount
                            : `${filteredRows.length}/${rows.length}`}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        value={server ? server.query : search}
                        onChange={(event) =>
                            server
                                ? server.onQueryChange(event.target.value)
                                : setSearch(event.target.value)
                        }
                        placeholder={t('dialog.group.dynamic.search_value', {
                            value: tab.label.toLowerCase()
                        })}
                        className="h-8 w-64"
                    />
                    {server ? (
                        <>
                            <Select
                                value={server.sort}
                                items={server.sortOptions}
                                disabled={serverQueryActive}
                                onValueChange={(value) =>
                                    value && server.onSortChange(value)
                                }
                            >
                                <SelectTrigger size="sm" className="w-44">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {server.sortOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            {server.roleOptions.length ? (
                                <Select
                                    value={server.roleId || ALL_ROLES_VALUE}
                                    items={server.roleOptions.map((option) => ({
                                        value: option.value || ALL_ROLES_VALUE,
                                        label: option.label
                                    }))}
                                    disabled={serverQueryActive}
                                    onValueChange={(value) =>
                                        server.onRoleChange(
                                            value === ALL_ROLES_VALUE
                                                ? ''
                                                : (value ?? '')
                                        )
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {server.roleOptions.map(
                                                (option) => (
                                                    <SelectItem
                                                        key={
                                                            option.value ||
                                                            ALL_ROLES_VALUE
                                                        }
                                                        value={
                                                            option.value ||
                                                            ALL_ROLES_VALUE
                                                        }
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>
            {loading ? (
                <GroupListState
                    title={t('dialog.group.dynamic.no_value', {
                        value: tab.label.toLowerCase()
                    })}
                    loading
                />
            ) : null}
            {error ? (
                <GroupListState
                    title={t('dialog.group.dynamic.no_value', {
                        value: tab.label.toLowerCase()
                    })}
                    error={error}
                />
            ) : null}
            {!loading && !error ? (
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
                                    {table.getRowModel().rows.length ? (
                                        table.getRowModel().rows.map((row) => {
                                            const userId = moderationRowUserId(
                                                row.original
                                            );
                                            const isSelected = Boolean(
                                                selectable &&
                                                userId &&
                                                selectedIds?.has(userId)
                                            );
                                            return (
                                                <TableRow
                                                    key={row.id}
                                                    data-selected={
                                                        isSelected || undefined
                                                    }
                                                    className={cn(
                                                        'border-l-2 border-l-transparent',
                                                        isSelected &&
                                                            'bg-muted/40',
                                                        isSelected &&
                                                            SELECTED_ROW_ACCENT_CLASS[
                                                                moderationStatusTone(
                                                                    moderationRowStatus(
                                                                        row.original
                                                                    )
                                                                )
                                                            ]
                                                    )}
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
                                                                />
                                                            ))}
                                                    </DataTableColumnSortableContext>
                                                </TableRow>
                                            );
                                        })
                                    ) : (
                                        <DataTableEmptyRow
                                            colSpan={
                                                table.getVisibleLeafColumns()
                                                    .length || 1
                                            }
                                        >
                                            {emptyMessage}
                                        </DataTableEmptyRow>
                                    )}
                                </TableBody>
                            </Table>
                        </DataTableColumnDndProvider>
                    </DataTableScrollArea>
                </DataTableSurface>
            ) : null}
            {!loading && !error && server ? (
                <div className="flex shrink-0 items-center justify-between">
                    <span className="text-muted-foreground text-sm tabular-nums">
                        {t('dialog.group_member_moderation.loaded_count', {
                            count: server.loadedCount
                        })}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!server.hasMore || server.loadingMore}
                        onClick={server.onLoadMore}
                    >
                        {server.loadingMore ? (
                            <Loader2Icon
                                data-icon="inline-start"
                                className="animate-spin"
                            />
                        ) : null}
                        {t('common.load_more')}
                    </Button>
                </div>
            ) : null}
            {!loading && !error && !server ? (
                <DataTablePagination
                    className="shrink-0"
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    onPageSizeChange={(value) =>
                        setPagination({
                            pageIndex: 0,
                            pageSize: Number.parseInt(value, 10) || 25
                        })
                    }
                />
            ) : null}
        </TabsContent>
    );
}
