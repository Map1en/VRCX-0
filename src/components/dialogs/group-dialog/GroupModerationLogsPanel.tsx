import type { ColumnDef } from '@tanstack/react-table';
import { DownloadIcon, ListFilterIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
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
import { Location } from '@/components/Location';
import { formatDateFilter } from '@/lib/dateTime';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';
import { TabsContent } from '@/ui/shadcn/tabs';

import { downloadJsonFile } from './groupDialogDownloads';
import { GroupListState } from './GroupListState';
import { GroupModerationLogsExportDialog } from './GroupModerationLogsExportDialog';
import { useGroupModerationTable } from './useGroupModerationTable';

const LOGS_COLUMN_IDS = ['created', 'type', 'actor', 'description', 'data'];

export interface GroupAuditLogRow {
    actorDisplayName?: string;
    actorId?: string;
    created_at?: string;
    data?: unknown;
    description?: string;
    eventType?: string;
    id?: string;
    targetId?: string;
}

interface GroupModerationLogsPanelProps {
    active: boolean;
    endpoint: string;
    group: {
        id?: string;
        name?: string;
    };
    open: boolean;
}

interface GroupModerationLogsTableProps {
    auditLogTypes: string[];
    error: string;
    group: {
        id?: string;
    };
    loading: boolean;
    onEventTypesChange: (eventTypes: string[]) => void;
    onExport: () => void;
    onReload: () => void;
    rows: GroupAuditLogRow[];
    selectedEventTypes: string[];
}

export function formatGroupAuditLogTypeName(value: string) {
    const parts = value
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(1);
    return parts
        .map((part) =>
            part
                .split(/[-_]/u)
                .filter(Boolean)
                .map(
                    (word) =>
                        `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`
                )
                .join(' ')
        )
        .join(' ');
}

export function toggleGroupAuditLogType(
    selectedEventTypes: string[],
    eventType: string
) {
    if (selectedEventTypes.includes(eventType)) {
        return selectedEventTypes.filter((value) => value !== eventType);
    }
    return [...selectedEventTypes, eventType];
}

export function filterGroupAuditLogs(rows: GroupAuditLogRow[], search: string) {
    const query = search.trim().toLowerCase();
    if (!query) {
        return rows;
    }
    return rows.filter((row) =>
        String(row.description || '')
            .toLowerCase()
            .includes(query)
    );
}

export function groupAuditLogActorDialogArgs(row: GroupAuditLogRow) {
    const userId = String(row.actorId || '').trim();
    if (!userId) {
        return null;
    }
    const title = String(row.actorDisplayName || userId).trim();
    return {
        userId,
        title,
        seedData: {
            id: userId,
            displayName: title
        }
    };
}

function formatLogData(data: unknown) {
    if (data == null) {
        return '';
    }
    try {
        const value = JSON.stringify(data);
        return typeof value === 'string' ? value : '';
    } catch {
        return '';
    }
}

const AUDIT_LOG_DIFF_VALUE_MAX_LENGTH = 80;
const AUDIT_LOG_DIFF_ARRAY_MAX_ITEMS = 5;

interface AuditLogDiffField {
    old?: unknown;
    new?: unknown;
}

function isAuditLogDiffField(value: unknown): value is AuditLogDiffField {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        ('old' in value || 'new' in value)
    );
}

function isAuditLogDiffShape(
    data: unknown
): data is Record<string, AuditLogDiffField> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const entries = Object.values(data as Record<string, unknown>);
    return entries.length > 0 && entries.every(isAuditLogDiffField);
}

function truncateAuditLogDiffText(value: string) {
    return value.length > AUDIT_LOG_DIFF_VALUE_MAX_LENGTH
        ? `${value.slice(0, AUDIT_LOG_DIFF_VALUE_MAX_LENGTH)}…`
        : value;
}

function compactAuditLogDiffValue(value: unknown): string {
    if (value === undefined) {
        return '—';
    }
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        const items = value
            .slice(0, AUDIT_LOG_DIFF_ARRAY_MAX_ITEMS)
            .map((item) => compactAuditLogDiffValue(item));
        const remaining = value.length - AUDIT_LOG_DIFF_ARRAY_MAX_ITEMS;
        return `[${items.join(', ')}${remaining > 0 ? `, +${remaining} more` : ''}]`;
    }
    if (typeof value === 'object') {
        try {
            return truncateAuditLogDiffText(JSON.stringify(value));
        } catch {
            return '[object]';
        }
    }
    return truncateAuditLogDiffText(String(value));
}

export function describeGroupAuditLogDataDiff(data: unknown): string[] | null {
    if (!isAuditLogDiffShape(data)) {
        return null;
    }
    return Object.entries(data).map(
        ([field, diff]) =>
            `${field}: ${compactAuditLogDiffValue(diff.old)} → ${compactAuditLogDiffValue(diff.new)}`
    );
}

export function openGroupAuditLogActor(row: GroupAuditLogRow) {
    const args = groupAuditLogActorDialogArgs(row);
    if (!args) {
        return;
    }
    openUserDialog(args);
}

function auditLogHeaderLabel(label: string) {
    return (
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {label}
        </span>
    );
}

export function createGroupAuditLogColumns(
    t: (key: string) => string
): ColumnDef<GroupAuditLogRow>[] {
    const createdLabel = t('dialog.group_member_moderation.created_at');
    const typeLabel = t('dialog.group_member_moderation.type');
    const actorLabel = t('dialog.group_member_moderation.display_name');
    const descriptionLabel = t('dialog.group_member_moderation.description');
    const dataLabel = t('dialog.group_member_moderation.data');

    return [
        {
            id: 'created',
            accessorFn: (row) => row.created_at || '',
            size: 180,
            minSize: 140,
            meta: { label: createdLabel },
            sortingFn: (rowA, rowB) => {
                const leftTs = Date.parse(rowA.original.created_at || '');
                const rightTs = Date.parse(rowB.original.created_at || '');
                if (
                    Number.isFinite(leftTs) &&
                    Number.isFinite(rightTs) &&
                    leftTs !== rightTs
                ) {
                    return leftTs - rightTs;
                }
                return 0;
            },
            header: ({ column }) => (
                <DataTableSortButton column={column} label={createdLabel} />
            ),
            cell: ({ row }) => (
                <span className="text-muted-foreground text-xs tabular-nums">
                    {row.original.created_at
                        ? formatDateFilter(row.original.created_at, 'long')
                        : '—'}
                </span>
            )
        },
        {
            id: 'type',
            accessorFn: (row) => row.eventType || '',
            size: 190,
            minSize: 120,
            meta: { label: typeLabel },
            header: ({ column }) => (
                <DataTableSortButton column={column} label={typeLabel} />
            ),
            cell: ({ row }) => (
                <span className="text-xs whitespace-normal">
                    {row.original.eventType
                        ? formatGroupAuditLogTypeName(row.original.eventType) ||
                          row.original.eventType
                        : '—'}
                </span>
            )
        },
        {
            id: 'actor',
            accessorFn: (row) => row.actorDisplayName || row.actorId || '',
            size: 180,
            minSize: 120,
            meta: { label: actorLabel },
            header: ({ column }) => (
                <DataTableSortButton column={column} label={actorLabel} />
            ),
            cell: ({ row }) => {
                const actorArgs = groupAuditLogActorDialogArgs(row.original);
                if (!actorArgs) {
                    return <span className="font-medium">—</span>;
                }
                return (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary h-auto w-full min-w-0 justify-start truncate p-0 text-left font-medium"
                        onClick={() => openGroupAuditLogActor(row.original)}
                    >
                        {actorArgs.title}
                    </Button>
                );
            }
        },
        {
            id: 'description',
            accessorFn: (row) => row.description || '',
            size: 320,
            minSize: 160,
            enableSorting: false,
            meta: { label: descriptionLabel },
            header: () => auditLogHeaderLabel(descriptionLabel),
            cell: ({ row }) => {
                const targetId = String(row.original.targetId || '').trim();
                return (
                    <div className="text-muted-foreground text-xs whitespace-normal">
                        {targetId.startsWith('wrld_') ? (
                            <Location
                                location={targetId}
                                className="mb-1"
                                worldNameClassName="text-xs"
                            />
                        ) : null}
                        <div>{row.original.description || '—'}</div>
                    </div>
                );
            }
        },
        {
            id: 'data',
            size: 320,
            minSize: 160,
            enableSorting: false,
            meta: { label: dataLabel },
            header: () => auditLogHeaderLabel(dataLabel),
            cell: ({ row }) => {
                const diffLines = describeGroupAuditLogDataDiff(
                    row.original.data
                );
                if (diffLines) {
                    return (
                        <div className="text-muted-foreground space-y-0.5 font-mono text-xs break-words whitespace-normal">
                            {diffLines.map((line, index) => (
                                <div key={`${index}:${line}`}>{line}</div>
                            ))}
                        </div>
                    );
                }
                const data = formatLogData(row.original.data);
                return (
                    <span className="text-muted-foreground font-mono text-xs break-words whitespace-normal">
                        {data || '—'}
                    </span>
                );
            }
        }
    ];
}

export function GroupModerationLogsTable({
    auditLogTypes,
    error,
    group,
    loading,
    onEventTypesChange,
    onExport,
    onReload,
    rows,
    selectedEventTypes
}: GroupModerationLogsTableProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const logsLabel = t('dialog.group_member_moderation.logs').toLowerCase();

    const filteredRows = useMemo(
        () => filterGroupAuditLogs(rows, search),
        [rows, search]
    );
    const columns = useMemo(() => createGroupAuditLogColumns(t), [t]);
    const { pageSizes, pagination, setPagination, table } =
        useGroupModerationTable<GroupAuditLogRow>({
            columnIds: LOGS_COLUMN_IDS,
            columns,
            paged: true,
            rows: filteredRows,
            tableId: 'group-moderation:logs'
        });

    useEffect(() => {
        setPagination((current) => ({ ...current, pageIndex: 0 }));
    }, [search, setPagination]);

    const filterLabel = selectedEventTypes.length
        ? `${selectedEventTypes.length}/${auditLogTypes.length}`
        : t('dialog.group_member_moderation.filter_type');
    const showTable = !loading && !error;

    return (
        <TabsContent
            value="logs"
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
                            downloadJsonFile(`${group.id}_logs.json`, rows)
                        }
                    >
                        <DownloadIcon data-icon="inline-start" />
                        JSON
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!rows.length}
                        onClick={onExport}
                    >
                        <DownloadIcon data-icon="inline-start" />
                        {t('dialog.group_member_moderation.export_logs')}
                    </Button>
                    {auditLogTypes.length ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={loading}
                                    >
                                        <ListFilterIcon data-icon="inline-start" />
                                        {filterLabel}
                                    </Button>
                                }
                            />
                            <DropdownMenuContent className="max-h-80 w-64 overflow-y-auto">
                                {auditLogTypes.map((eventType) => (
                                    <DropdownMenuCheckboxItem
                                        key={eventType}
                                        checked={selectedEventTypes.includes(
                                            eventType
                                        )}
                                        onClick={(event) =>
                                            event.preventDefault()
                                        }
                                        onCheckedChange={() =>
                                            onEventTypesChange(
                                                toggleGroupAuditLogType(
                                                    selectedEventTypes,
                                                    eventType
                                                )
                                            )
                                        }
                                    >
                                        <span className="truncate">
                                            {formatGroupAuditLogTypeName(
                                                eventType
                                            ) || eventType}
                                        </span>
                                    </DropdownMenuCheckboxItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : null}
                    <span className="text-muted-foreground text-sm tabular-nums">
                        {filteredRows.length}/{rows.length}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('dialog.group.dynamic.search_value', {
                            value: logsLabel
                        })}
                        className="h-8 w-64"
                    />
                </div>
            </div>
            {loading ? (
                <GroupListState
                    title={t('dialog.group.dynamic.no_value', {
                        value: logsLabel
                    })}
                    loading
                />
            ) : null}
            {error ? (
                <GroupListState
                    title={t('dialog.group.dynamic.no_value', {
                        value: logsLabel
                    })}
                    error={error}
                />
            ) : null}
            {showTable ? (
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
                                        table.getRowModel().rows.map((row) => (
                                            <TableRow key={row.id}>
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
                                            </TableRow>
                                        ))
                                    ) : (
                                        <DataTableEmptyRow
                                            colSpan={
                                                table.getVisibleLeafColumns()
                                                    .length || 1
                                            }
                                        >
                                            {t('dialog.group.empty.no_rows')}
                                        </DataTableEmptyRow>
                                    )}
                                </TableBody>
                            </Table>
                        </DataTableColumnDndProvider>
                    </DataTableScrollArea>
                </DataTableSurface>
            ) : null}
            {showTable ? (
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

export function GroupModerationLogsPanel({
    active,
    endpoint,
    group,
    open
}: GroupModerationLogsPanelProps) {
    const { t } = useTranslation();
    const [auditLogTypes, setAuditLogTypes] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const [rows, setRows] = useState<GroupAuditLogRow[]>([]);
    const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
    const [exportOpen, setExportOpen] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }
        setAuditLogTypes([]);
        setError('');
        setLoading(false);
        setRows([]);
        setSelectedEventTypes([]);
        setExportOpen(false);
    }, [endpoint, group.id, open]);

    useEffect(() => {
        if (!open || !active || !group.id) {
            return;
        }
        let alive = true;
        groupProfileRepository
            .getGroupAuditLogTypes({
                groupId: group.id
            })
            .then((types) => {
                if (!alive) {
                    return;
                }
                setAuditLogTypes(
                    types.filter(
                        (type): type is string => typeof type === 'string'
                    )
                );
            })
            .catch(() => {
                if (alive) {
                    setAuditLogTypes([]);
                }
            });
        return () => {
            alive = false;
        };
    }, [active, endpoint, group.id, open]);

    useEffect(() => {
        if (!open || !active || !group.id) {
            return;
        }

        let alive = true;
        setLoading(true);
        setError('');

        groupProfileRepository
            .getAllGroupLogs({
                groupId: group.id,
                eventTypes: selectedEventTypes
            })
            .then((nextRows) => {
                if (!alive) {
                    return;
                }
                setRows(nextRows);
            })
            .catch((requestError) => {
                if (!alive) {
                    return;
                }
                setError(
                    requestError instanceof Error
                        ? requestError.message
                        : t('dialog.group.toast.value_failed', {
                              value: t('dialog.group_member_moderation.logs')
                          })
                );
                setRows([]);
            })
            .finally(() => {
                if (alive) {
                    setLoading(false);
                }
            });

        return () => {
            alive = false;
        };
    }, [active, endpoint, group.id, open, reloadToken, selectedEventTypes, t]);

    return (
        <>
            <GroupModerationLogsTable
                auditLogTypes={auditLogTypes}
                error={error}
                group={group}
                loading={loading}
                onEventTypesChange={setSelectedEventTypes}
                onExport={() => setExportOpen(true)}
                onReload={() => setReloadToken((value) => value + 1)}
                rows={rows}
                selectedEventTypes={selectedEventTypes}
            />
            <GroupModerationLogsExportDialog
                open={exportOpen}
                onOpenChange={setExportOpen}
                rows={rows}
            />
        </>
    );
}
