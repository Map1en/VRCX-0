import { Trash2Icon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppColumnDef } from '@/components/data-table/appTable';
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
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.date')}
                    />
                ),
                sortFn: (rowA, rowB) => {
                    const leftTs = Date.parse(rowA.original?.created_at ?? '');
                    const rightTs = Date.parse(rowB.original?.created_at ?? '');
                    if (
                        Number.isFinite(leftTs) &&
                        Number.isFinite(rightTs) &&
                        leftTs !== rightTs
                    ) {
                        return leftTs - rightTs;
                    }

                    return (
                        (Number(rowA.original?.rowId ?? 0) || 0) -
                        (Number(rowB.original?.rowId ?? 0) || 0)
                    );
                },
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
                meta: { stretch: true },
                accessorFn: (row) =>
                    row?.resolvedDisplayName ||
                    row?.displayName ||
                    row?.userId ||
                    '',
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
                accessorFn: (row) => getFriendLogRowKey(row, rowsOwnerUserId),
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
