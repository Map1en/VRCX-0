import { createContext, use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppColumn, AppColumnDef } from '@/components/data-table/appTable';
import {
    DataTableHeaderLabel,
    DataTableSortButton
} from '@/components/data-table/DataTableSortButton';
import {
    DATA_TABLE_METADATA_CELL_CLASS_NAME,
    DATA_TABLE_PRIMARY_CELL_CLASS_NAME,
    DATA_TABLE_STICKY_ACTION_CELL_CLASS_NAME,
    DATA_TABLE_STICKY_ACTION_HEADER_CLASS_NAME
} from '@/components/data-table/DataTableView';
import type { GroupProfileRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';
import { formatDateFilter } from '@/lib/dateTime';
import { useStableCommands } from '@/lib/useStableCommands';
import { IntentTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';

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
    return <DataTableHeaderLabel>{label}</DataTableHeaderLabel>;
}

const DANGER_ACTION_KEYS = new Set(['ban', 'block-request']);

function renderColumnHeader(
    column: AppColumn<EntityRecord>,
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

export const GroupModerationSelectionContext = createContext<
    ReadonlySet<string> | undefined
>(undefined);

export const GroupModerationRowContext = createContext({
    selected: false,
    actionKey: ''
});

function SelectAllCheckbox({
    visibleUserIds,
    onToggleAllVisible
}: {
    visibleUserIds: string[];
    onToggleAllVisible?: (userIds: string[], checked: boolean) => void;
}) {
    const { t } = useTranslation();
    const selectedIds = use(GroupModerationSelectionContext);
    const allSelected =
        visibleUserIds.length > 0 &&
        visibleUserIds.every((userId) => selectedIds?.has(userId));
    return (
        <Checkbox
            checked={allSelected}
            disabled={!visibleUserIds.length}
            aria-label={t('dialog.group_member_moderation.select_all')}
            onCheckedChange={(checked) =>
                onToggleAllVisible?.(visibleUserIds, Boolean(checked))
            }
        />
    );
}

function RowSelectCheckbox({
    record,
    onToggleRow
}: {
    record: EntityRecord;
    onToggleRow?: (userId: string, checked: boolean) => void;
}) {
    const { selected } = use(GroupModerationRowContext);
    const userId = moderationRowUserId(record);
    return (
        <Checkbox
            checked={selected}
            disabled={!userId}
            aria-label={moderationRowLabel(record)}
            onCheckedChange={(checked) =>
                userId && onToggleRow?.(userId, Boolean(checked))
            }
        />
    );
}

function RowActions({
    record,
    tab,
    onRunAction
}: {
    record: EntityRecord;
    tab: GroupModerationTabValue;
    onRunAction: (action: GroupModerationAction, row: EntityRecord) => void;
}) {
    const { t } = useTranslation();
    const { actionKey } = use(GroupModerationRowContext);
    const userId = moderationRowUserId(record);
    const actions = getGroupModerationActions(tab, record, t);
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
                        onClick={() => onRunAction(action, record)}
                    >
                        {isRunning ? '...' : action.label}
                    </Button>
                );
            })}
        </div>
    );
}

export function useGroupModerationColumns({
    group,
    onOpenUser,
    onRunAction,
    onToggleAllVisible,
    onToggleRow,
    selectable,
    sortable,
    tab
}: {
    group: GroupProfileRecord;
    onOpenUser: (row: EntityRecord) => void;
    onRunAction: (action: GroupModerationAction, row: EntityRecord) => void;
    onToggleAllVisible?: (userIds: string[], checked: boolean) => void;
    onToggleRow?: (userId: string, checked: boolean) => void;
    selectable: boolean;
    sortable: boolean;
    tab: GroupModerationTabValue;
}): AppColumnDef<EntityRecord>[] {
    const { t } = useTranslation();
    const commands = useStableCommands({
        onOpenUser,
        onRunAction,
        onToggleAllVisible,
        onToggleRow
    });

    return useMemo<AppColumnDef<EntityRecord>[]>(() => {
        const columns: AppColumnDef<EntityRecord>[] = [];
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
                header: ({ table }) => (
                    <SelectAllCheckbox
                        visibleUserIds={table
                            .getRowModel()
                            .rows.map((row) =>
                                moderationRowUserId(row.original)
                            )
                            .filter(Boolean)}
                        onToggleAllVisible={commands.onToggleAllVisible}
                    />
                ),
                cell: ({ row }) => (
                    <RowSelectCheckbox
                        record={row.original}
                        onToggleRow={commands.onToggleRow}
                    />
                )
            });
        }

        columns.push({
            id: 'user',
            accessorFn: (row) => moderationRowLabel(row),
            size: 220,
            minSize: 140,
            enableSorting: sortable,
            meta: {
                label: userLabel,
                tableCellClassName: DATA_TABLE_PRIMARY_CELL_CLASS_NAME
            },
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
                        className="h-auto w-full min-w-0 justify-start truncate p-0 text-left font-medium hover:bg-transparent"
                        onClick={() => commands.onOpenUser(row.original)}
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
            enableHiding: false,
            meta: { label: detailLabel, stretch: true },
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
                    <IntentTooltip
                        content={detail}
                        contentClassName="max-w-xs whitespace-normal"
                    >
                        <span className="text-muted-foreground block truncate text-xs">
                            {detail}
                        </span>
                    </IntentTooltip>
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
            meta: {
                label: dateLabel,
                tableCellClassName: DATA_TABLE_METADATA_CELL_CLASS_NAME
            },
            sortFn: (rowA, rowB) => {
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
                    <span className="text-xs">
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
            meta: {
                disableReorder: true,
                tableHeadClassName: DATA_TABLE_STICKY_ACTION_HEADER_CLASS_NAME,
                tableCellClassName: DATA_TABLE_STICKY_ACTION_CELL_CLASS_NAME
            },
            header: () => (
                <DataTableHeaderLabel className="block text-right">
                    {t('dialog.group.label.actions')}
                </DataTableHeaderLabel>
            ),
            cell: ({ row }) => (
                <RowActions
                    record={row.original}
                    tab={tab}
                    onRunAction={commands.onRunAction}
                />
            )
        });

        return columns;
    }, [commands, group, selectable, sortable, t, tab]);
}
