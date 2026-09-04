import { Trash2Icon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppColumnDef } from '@/components/data-table/appTable';
import {
    DATA_TABLE_CONTROL_CELL_CLASS_NAME,
    DATA_TABLE_METADATA_CELL_CLASS_NAME,
    DATA_TABLE_PRIMARY_CELL_CLASS_NAME
} from '@/components/data-table/DataTableView';
import { formatDateFilter } from '@/lib/dateTime';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getFriendLogRowKey, normalizeUserId } from '../friendLogRows';
import type { FriendLogRow } from '../friendLogRows';
import {
    FriendLogTypeIndicator,
    SortButton,
    renderUserCell
} from './FriendLogViewParts';

export function useFriendLogColumns({
    currentUserId,
    deletingRowKey,
    handleDeleteRow,
    loadStatus,
    rowsOwnerUserId,
    shiftHeld
}: {
    currentUserId: string;
    deletingRowKey: string;
    handleDeleteRow: (
        row: FriendLogRow,
        options?: { skipConfirm?: boolean }
    ) => Promise<void>;
    loadStatus: string;
    rowsOwnerUserId: string;
    shiftHeld: boolean;
}) {
    const { t } = useTranslation();

    return useMemo<AppColumnDef<FriendLogRow>[]>(
        () => [
            {
                id: 'spacer',
                size: 20,
                minSize: 0,
                maxSize: 20,
                enableSorting: false,
                enableResizing: false,
                header: (): ReactNode => null,
                cell: (): ReactNode => null
            },
            {
                id: 'created_at',
                size: 120,
                accessorFn: (row) => row?.created_at || '',
                meta: {
                    tableCellClassName: DATA_TABLE_METADATA_CELL_CLASS_NAME
                },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.date')}
                    />
                ),
                cell: ({ row }) => {
                    const createdAt = row.original?.created_at || '';
                    return (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span className="text-sm">
                                        {formatDateFilter(createdAt, 'short')}
                                    </span>
                                }
                            />
                            <TooltipContent>
                                {formatDateFilter(createdAt, 'long')}
                            </TooltipContent>
                        </Tooltip>
                    );
                }
            },
            {
                id: 'type',
                size: 160,
                accessorFn: (row) => row?.type || '',
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.type')}
                    />
                ),
                cell: ({ row }) => (
                    <FriendLogTypeIndicator type={row.original.type} />
                )
            },
            {
                id: 'displayName',
                size: 260,
                minSize: 80,
                meta: {
                    stretch: true,
                    tableCellClassName: DATA_TABLE_PRIMARY_CELL_CLASS_NAME
                },
                enableSorting: false,
                header: () => t('table.friendLog.user'),
                cell: ({ row }) => renderUserCell(row.original)
            },
            {
                id: 'action',
                size: 64,
                minSize: 64,
                maxSize: 64,
                enableResizing: false,
                enableSorting: false,
                meta: {
                    tableCellClassName: DATA_TABLE_CONTROL_CELL_CLASS_NAME
                },
                header: () => t('table.friendLog.action'),
                cell: ({ row }) => {
                    const rowKey = getFriendLogRowKey(
                        row.original,
                        rowsOwnerUserId
                    );
                    return (
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={t('common.actions.delete')}
                                disabled={
                                    !currentUserId ||
                                    rowsOwnerUserId !==
                                        normalizeUserId(currentUserId) ||
                                    loadStatus === 'running' ||
                                    deletingRowKey === rowKey
                                }
                                onClick={(event) =>
                                    handleDeleteRow(row.original, {
                                        skipConfirm: shiftHeld || event.shiftKey
                                    })
                                }
                            >
                                {deletingRowKey === rowKey ? (
                                    <Spinner data-icon="inline-start" />
                                ) : shiftHeld ? (
                                    <XIcon
                                        data-icon="inline-start"
                                        className="text-destructive"
                                    />
                                ) : (
                                    <Trash2Icon data-icon="inline-start" />
                                )}
                            </Button>
                        </div>
                    );
                }
            },
            {
                id: 'trailing',
                size: 5,
                enableSorting: false,
                enableResizing: false,
                header: (): ReactNode => null,
                cell: (): ReactNode => null
            }
        ],
        [
            currentUserId,
            deletingRowKey,
            handleDeleteRow,
            loadStatus,
            rowsOwnerUserId,
            shiftHeld,
            t
        ]
    );
}
