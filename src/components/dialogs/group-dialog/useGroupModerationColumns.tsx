import type { Column, ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { formatDateFilter } from '@/lib/dateTime';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { GroupModerationTabValue } from './groupDialogUtils';
import {
    getGroupModerationActions,
    moderationRowDate,
    moderationRowLabel,
    moderationRowNote,
    moderationRowRoles,
    moderationRowStatus,
    moderationRowUserId,
    moderationStatusLabel,
    type GroupModerationAction
} from './groupModerationRows';
import { ModerationStatusBadge } from './ModerationStatusBadge';

function columnHeaderLabel(label: string) {
    return (
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {label}
        </span>
    );
}

const DANGER_ACTION_KEYS = new Set(['ban', 'block-request']);

function renderColumnHeader(
    column: Column<EntityRecord>,
    label: string,
    sortable: boolean
) {
    return sortable ? (
        <DataTableSortButton column={column} label={label} />
    ) : (
        columnHeaderLabel(label)
    );
}

const GROUP_MODERATION_BASE_COLUMN_IDS = [
    'user',
    'detail',
    'status',
    'date',
    'actions'
];

export function getGroupModerationColumnIds(selectable: boolean): string[] {
    return selectable
        ? ['select', ...GROUP_MODERATION_BASE_COLUMN_IDS]
        : [...GROUP_MODERATION_BASE_COLUMN_IDS];
}

export function useGroupModerationColumns({
    actionKey,
    group,
    onOpenUser,
    onRunAction,
    onToggleAllVisible,
    onToggleRow,
    selectable,
    selectedIds,
    sortable,
    tab
}: {
    actionKey: string;
    group: GroupProfileRecord;
    onOpenUser: (row: EntityRecord) => void;
    onRunAction: (action: GroupModerationAction, row: EntityRecord) => void;
    onToggleAllVisible?: (userIds: string[], checked: boolean) => void;
    onToggleRow?: (userId: string, checked: boolean) => void;
    selectable: boolean;
    selectedIds: ReadonlySet<string> | null;
    sortable: boolean;
    tab: GroupModerationTabValue;
}): ColumnDef<EntityRecord>[] {
    const { t } = useTranslation();

    return useMemo<ColumnDef<EntityRecord>[]>(() => {
        const columns: ColumnDef<EntityRecord>[] = [];
        const userLabel = t('dialog.group.label.user');
        const statusLabel = t('dialog.group.label.status');
        const dateLabel = t('dialog.group.label.date');
        const detailLabel = `${t('dialog.group_member_moderation.roles')} / ${t('dialog.group_member_moderation.description')}`;

        if (selectable) {
            columns.push({
                id: 'select',
                size: 36,
                minSize: 36,
                maxSize: 36,
                enableSorting: false,
                enableHiding: false,
                enableResizing: false,
                header: ({ table }) => {
                    const visibleUserIds = table
                        .getRowModel()
                        .rows.map((row) => moderationRowUserId(row.original))
                        .filter(Boolean);
                    const allSelected =
                        visibleUserIds.length > 0 &&
                        visibleUserIds.every((userId) =>
                            selectedIds?.has(userId)
                        );
                    return (
                        <Checkbox
                            checked={allSelected}
                            disabled={!visibleUserIds.length}
                            aria-label={t(
                                'dialog.group_member_moderation.select_all'
                            )}
                            onCheckedChange={(checked) =>
                                onToggleAllVisible?.(
                                    visibleUserIds,
                                    Boolean(checked)
                                )
                            }
                        />
                    );
                },
                cell: ({ row }) => {
                    const userId = moderationRowUserId(row.original);
                    return (
                        <Checkbox
                            checked={Boolean(
                                userId && selectedIds?.has(userId)
                            )}
                            disabled={!userId}
                            aria-label={moderationRowLabel(row.original)}
                            onCheckedChange={(checked) =>
                                userId &&
                                onToggleRow?.(userId, Boolean(checked))
                            }
                        />
                    );
                }
            });
        }

        columns.push({
            id: 'user',
            accessorFn: (row) => moderationRowLabel(row),
            size: 220,
            minSize: 140,
            enableSorting: sortable,
            meta: { label: userLabel },
            header: ({ column }) =>
                renderColumnHeader(column, userLabel, sortable),
            cell: ({ row }) => {
                const userId = moderationRowUserId(row.original);
                const label = moderationRowLabel(row.original);
                if (!userId) {
                    return <span className="font-medium">{label}</span>;
                }
                return (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary h-auto w-full min-w-0 justify-start truncate p-0 text-left font-medium"
                        onClick={() => onOpenUser(row.original)}
                    >
                        {label}
                    </Button>
                );
            }
        });

        columns.push({
            id: 'detail',
            accessorFn: (row) =>
                moderationRowRoles(row, group) || moderationRowNote(row),
            size: 280,
            minSize: 140,
            enableSorting: false,
            meta: { label: detailLabel },
            header: () => columnHeaderLabel(detailLabel),
            cell: ({ row }) => {
                const detail =
                    moderationRowRoles(row.original, group) ||
                    moderationRowNote(row.original) ||
                    '—';
                if (detail === '—') {
                    return (
                        <span className="text-muted-foreground text-xs">—</span>
                    );
                }
                return (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <span className="text-muted-foreground block truncate text-xs">
                                    {detail}
                                </span>
                            }
                        />
                        <TooltipContent className="max-w-xs whitespace-normal">
                            {detail}
                        </TooltipContent>
                    </Tooltip>
                );
            }
        });

        columns.push({
            id: 'status',
            accessorFn: (row) => moderationRowStatus(row),
            size: 140,
            minSize: 100,
            enableSorting: sortable,
            meta: { label: statusLabel },
            header: ({ column }) =>
                renderColumnHeader(column, statusLabel, sortable),
            cell: ({ row }) => {
                const status = moderationRowStatus(row.original);
                return (
                    <ModerationStatusBadge
                        status={status}
                        label={moderationStatusLabel(status, t)}
                    />
                );
            }
        });

        columns.push({
            id: 'date',
            accessorFn: (row) => moderationRowDate(row),
            size: 170,
            minSize: 120,
            enableSorting: sortable,
            meta: { label: dateLabel },
            sortingFn: (rowA, rowB) => {
                const leftTs = Date.parse(moderationRowDate(rowA.original));
                const rightTs = Date.parse(moderationRowDate(rowB.original));
                if (
                    Number.isFinite(leftTs) &&
                    Number.isFinite(rightTs) &&
                    leftTs !== rightTs
                ) {
                    return leftTs - rightTs;
                }
                return 0;
            },
            header: ({ column }) =>
                renderColumnHeader(column, dateLabel, sortable),
            cell: ({ row }) => {
                const date = moderationRowDate(row.original);
                return (
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {date ? formatDateFilter(date, 'long') : '—'}
                    </span>
                );
            }
        });

        columns.push({
            id: 'actions',
            size: 220,
            minSize: 140,
            enableSorting: false,
            enableHiding: false,
            enableResizing: false,
            meta: { disableReorder: true },
            header: () => (
                <span className="text-muted-foreground block text-right text-xs font-medium tracking-wide uppercase">
                    {t('dialog.group.label.actions')}
                </span>
            ),
            cell: ({ row }) => {
                const userId = moderationRowUserId(row.original);
                const actions = getGroupModerationActions(tab, row.original, t);
                if (!actions.length) {
                    return null;
                }
                return (
                    <div className="flex justify-end gap-2">
                        {actions.map((action) => {
                            const nextActionKey = `${tab}:${action.key}:${userId}`;
                            const isRunning = actionKey === nextActionKey;
                            return (
                                <Button
                                    key={action.key}
                                    type="button"
                                    size="sm"
                                    variant={
                                        DANGER_ACTION_KEYS.has(action.key)
                                            ? 'destructive'
                                            : action.destructive
                                              ? 'outline'
                                              : 'secondary'
                                    }
                                    className="transition-transform duration-[140ms] ease-out active:scale-[0.97]"
                                    disabled={Boolean(actionKey)}
                                    onClick={() =>
                                        onRunAction(action, row.original)
                                    }
                                >
                                    {isRunning ? '...' : action.label}
                                </Button>
                            );
                        })}
                    </div>
                );
            }
        });

        return columns;
    }, [
        actionKey,
        group,
        onOpenUser,
        onRunAction,
        onToggleAllVisible,
        onToggleRow,
        selectable,
        selectedIds,
        sortable,
        t,
        tab
    ]);
}
