import { DownloadIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime.js';
import { openUserDialog } from '@/services/dialogService.js';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { TabsContent } from '@/ui/shadcn/tabs';

import { downloadJsonFile } from './groupDialogDownloads.js';
import { GroupListState } from './GroupListState.jsx';
import {
    getGroupModerationActions,
    moderationRowDate,
    moderationRowLabel,
    moderationRowRoles,
    moderationRowSearchText,
    moderationRowStatus,
    moderationRowSubtitle,
    moderationRowUserId
} from './groupModerationRows.js';

export function GroupModerationTabPanel({
    actionKey,
    activeTab,
    error,
    group,
    loading,
    onPageIndexChange,
    onPageSizeChange,
    onReload,
    onRunAction,
    onSearchChange,
    pageIndex,
    pageSize,
    rows,
    search,
    tab
}) {
    const { t } = useTranslation();
    const filteredRows = rows.filter((row) => {
        const query = search.trim().toLowerCase();
        return !query || moderationRowSearchText(row, group).includes(query);
    });
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    return (
        <TabsContent
            value={tab.value}
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
                            downloadJsonFile(
                                `${group.id}_${activeTab}.json`,
                                rows
                            )
                        }
                    >
                        <DownloadIcon data-icon="inline-start" />
                        JSON
                    </Button>
                    <span className="text-muted-foreground text-sm">
                        {filteredRows.length}/{rows.length}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={t(
                            'dialog.group.generated_dynamic.search_value',
                            { value: tab.label.toLowerCase() }
                        )}
                        className="h-8 w-64"
                    />
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value) =>
                            onPageSizeChange(Number.parseInt(value, 10) || 25)
                        }
                    >
                        <SelectTrigger size="sm" className="w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {[10, 25, 50, 100].map((size) => (
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
                    title={t('dialog.group.generated_dynamic.no_value', {
                        value: tab.label.toLowerCase()
                    })}
                    loading
                />
            ) : null}
            {error ? (
                <GroupListState
                    title={t('dialog.group.generated_dynamic.no_value', {
                        value: tab.label.toLowerCase()
                    })}
                    error={error}
                />
            ) : null}
            {!loading && !error ? (
                <div className="overflow-auto rounded-md border">
                    <Table>
                        <TableHeader className="bg-background sticky top-0">
                            <TableRow>
                                <TableHead className="w-56">
                                    {t('dialog.group.generated.user')}
                                </TableHead>
                                <TableHead>
                                    {t(
                                        'dialog.group.generated.roles_description'
                                    )}
                                </TableHead>
                                <TableHead className="w-44">
                                    {t('dialog.group.generated.status')}
                                </TableHead>
                                <TableHead className="w-44">
                                    {t('dialog.group.generated.date')}
                                </TableHead>
                                <TableHead className="w-48 text-right">
                                    {t('dialog.group.generated.actions')}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRows.length ? (
                                visibleRows.map((row, index) => {
                                    const userId = moderationRowUserId(row);
                                    const label = moderationRowLabel(row);
                                    const date = moderationRowDate(row);
                                    const actions = getGroupModerationActions(
                                        activeTab,
                                        row,
                                        t
                                    );
                                    return (
                                        <TableRow
                                            key={`${label}:${date}:${index}`}
                                        >
                                            <TableCell className="align-top">
                                                {userId ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="hover:text-primary h-auto max-w-52 justify-start truncate p-0 text-left font-medium"
                                                        onClick={() =>
                                                            openUserDialog({
                                                                userId,
                                                                title: label,
                                                                seedData:
                                                                    row?.user ||
                                                                    null
                                                            })
                                                        }
                                                    >
                                                        {label}
                                                    </Button>
                                                ) : (
                                                    <span className="font-medium">
                                                        {label}
                                                    </span>
                                                )}
                                                <div className="text-muted-foreground truncate font-mono text-xs">
                                                    {userId || row?.id || '—'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground align-top text-xs whitespace-normal">
                                                {moderationRowRoles(
                                                    row,
                                                    group
                                                ) ||
                                                    row?.description ||
                                                    row?.note ||
                                                    row?.managerNotes ||
                                                    moderationRowSubtitle(
                                                        row
                                                    ) ||
                                                    '—'}
                                            </TableCell>
                                            <TableCell className="align-top text-xs whitespace-normal">
                                                {moderationRowStatus(row)}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground align-top text-xs">
                                                {date
                                                    ? formatDateFilter(
                                                          date,
                                                          'long'
                                                      )
                                                    : '—'}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                <div className="flex justify-end gap-2">
                                                    {actions.map((action) => {
                                                        const nextActionKey = `${activeTab}:${action.key}:${userId}`;
                                                        return (
                                                            <Button
                                                                key={action.key}
                                                                type="button"
                                                                size="sm"
                                                                variant={
                                                                    action.destructive
                                                                        ? 'outline'
                                                                        : 'secondary'
                                                                }
                                                                disabled={Boolean(
                                                                    actionKey
                                                                )}
                                                                onClick={() =>
                                                                    void onRunAction(
                                                                        action,
                                                                        row
                                                                    )
                                                                }
                                                            >
                                                                {actionKey ===
                                                                nextActionKey
                                                                    ? '...'
                                                                    : action.label}
                                                            </Button>
                                                        );
                                                    })}
                                                </div>
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
                                        {t('dialog.group.generated.no_rows')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            ) : null}
            {!loading && !error ? (
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.group.generated.page')}{' '}
                        {currentPageIndex + 1} / {totalPages}
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
