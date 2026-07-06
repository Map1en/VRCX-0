import { DownloadIcon, ListFilterIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { TabsContent } from '@/ui/shadcn/tabs';

import { downloadJsonFile } from './groupDialogDownloads';
import { GroupListState } from './GroupListState';

const LOGS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface GroupAuditLogRow {
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
    onPageIndexChange: (pageIndex: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    onReload: () => void;
    onSearchChange: (search: string) => void;
    pageIndex: number;
    pageSize: number;
    rows: GroupAuditLogRow[];
    search: string;
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

function logRowKey(row: GroupAuditLogRow, index: number) {
    return row.id || `${row.created_at || ''}:${row.eventType || ''}:${index}`;
}

export function openGroupAuditLogActor(row: GroupAuditLogRow) {
    const args = groupAuditLogActorDialogArgs(row);
    if (!args) {
        return;
    }
    openUserDialog(args);
}

export function GroupModerationLogsTable({
    auditLogTypes,
    error,
    group,
    loading,
    onEventTypesChange,
    onPageIndexChange,
    onPageSizeChange,
    onReload,
    onSearchChange,
    pageIndex,
    pageSize,
    rows,
    search,
    selectedEventTypes
}: GroupModerationLogsTableProps) {
    const { t } = useTranslation();
    const logsLabel = t('dialog.group_member_moderation.logs').toLowerCase();
    const filteredRows = filterGroupAuditLogs(rows, search);
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );
    const showTable = !loading && !error;
    const filterLabel = selectedEventTypes.length
        ? `${selectedEventTypes.length}/${auditLogTypes.length}`
        : t('dialog.group_member_moderation.filter_type');

    return (
        <TabsContent
            value="logs"
            className="m-0 max-h-[65vh] overflow-auto pt-4"
        >
            <div className="mb-3 flex items-center justify-between gap-3">
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
                    <span className="text-muted-foreground text-sm">
                        {filteredRows.length}/{rows.length}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={t('dialog.group.dynamic.search_value', {
                            value: logsLabel
                        })}
                        className="h-8 w-64"
                    />
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value) =>
                            onPageSizeChange(
                                Number.parseInt(value ?? '', 10) || 25
                            )
                        }
                    >
                        <SelectTrigger size="sm" className="w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {LOGS_PAGE_SIZE_OPTIONS.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
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
                <div className="overflow-auto rounded-md border">
                    <Table>
                        <TableHeader className="vrcx-0-table-header sticky top-0">
                            <TableRow>
                                <TableHead className="w-44">
                                    {t(
                                        'dialog.group_member_moderation.created_at'
                                    )}
                                </TableHead>
                                <TableHead className="w-56">
                                    {t('dialog.group_member_moderation.type')}
                                </TableHead>
                                <TableHead className="w-56">
                                    {t(
                                        'dialog.group_member_moderation.display_name'
                                    )}
                                </TableHead>
                                <TableHead>
                                    {t(
                                        'dialog.group_member_moderation.description'
                                    )}
                                </TableHead>
                                <TableHead className="w-80">
                                    {t('dialog.group_member_moderation.data')}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRows.length ? (
                                visibleRows.map((row, index) => {
                                    const actorArgs =
                                        groupAuditLogActorDialogArgs(row);
                                    const targetId = String(
                                        row.targetId || ''
                                    ).trim();
                                    const data = formatLogData(row.data);
                                    return (
                                        <TableRow key={logRowKey(row, index)}>
                                            <TableCell className="text-muted-foreground align-top text-xs">
                                                {row.created_at
                                                    ? formatDateFilter(
                                                          row.created_at,
                                                          'long'
                                                      )
                                                    : '—'}
                                            </TableCell>
                                            <TableCell className="align-top text-xs whitespace-normal">
                                                {row.eventType || '—'}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                {actorArgs ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="hover:text-primary h-auto max-w-52 justify-start truncate p-0 text-left font-medium"
                                                        onClick={() =>
                                                            openGroupAuditLogActor(
                                                                row
                                                            )
                                                        }
                                                    >
                                                        {actorArgs.title}
                                                    </Button>
                                                ) : (
                                                    <span className="font-medium">
                                                        —
                                                    </span>
                                                )}
                                                <div className="text-muted-foreground truncate font-mono text-xs">
                                                    {row.actorId || '—'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground align-top text-xs whitespace-normal">
                                                {targetId.startsWith(
                                                    'wrld_'
                                                ) ? (
                                                    <Location
                                                        location={targetId}
                                                        className="mb-1"
                                                        worldNameClassName="text-xs"
                                                    />
                                                ) : null}
                                                <div>
                                                    {row.description || '—'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground max-w-80 align-top font-mono text-xs break-words whitespace-normal">
                                                {data || '—'}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={5}
                                        className="text-muted-foreground py-8 text-center text-sm"
                                    >
                                        {t('dialog.group.empty.no_rows')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            ) : null}
            {showTable ? (
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.group.label.page')} {currentPageIndex + 1} /{' '}
                        {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={currentPageIndex <= 0}
                            onClick={() =>
                                onPageIndexChange(
                                    Math.max(0, currentPageIndex - 1)
                                )
                            }
                        >
                            {t('table.pagination.previous')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={currentPageIndex >= totalPages - 1}
                            onClick={() =>
                                onPageIndexChange(
                                    Math.min(
                                        totalPages - 1,
                                        currentPageIndex + 1
                                    )
                                )
                            }
                        >
                            {t('table.pagination.next')}
                        </Button>
                    </div>
                </div>
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
    const [pageIndex, setPageIndex] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [reloadToken, setReloadToken] = useState(0);
    const [rows, setRows] = useState<GroupAuditLogRow[]>([]);
    const [search, setSearch] = useState('');
    const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);

    useEffect(() => {
        if (!open) {
            return;
        }
        setAuditLogTypes([]);
        setError('');
        setLoading(false);
        setPageIndex(0);
        setRows([]);
        setSearch('');
        setSelectedEventTypes([]);
    }, [endpoint, group.id, open]);

    useEffect(() => {
        if (!open || !active || !group.id) {
            return;
        }
        let alive = true;
        groupProfileRepository
            .getGroupAuditLogTypes({
                groupId: group.id,
                endpoint
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
                endpoint,
                eventTypes: selectedEventTypes
            })
            .then((nextRows) => {
                if (!alive) {
                    return;
                }
                setRows(nextRows);
                setPageIndex(0);
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
        <GroupModerationLogsTable
            auditLogTypes={auditLogTypes}
            error={error}
            group={group}
            loading={loading}
            onEventTypesChange={setSelectedEventTypes}
            onPageIndexChange={setPageIndex}
            onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPageIndex(0);
            }}
            onReload={() => setReloadToken((value) => value + 1)}
            onSearchChange={(nextSearch) => {
                setSearch(nextSearch);
                setPageIndex(0);
            }}
            pageIndex={pageIndex}
            pageSize={pageSize}
            rows={rows}
            search={search}
            selectedEventTypes={selectedEventTypes}
        />
    );
}
