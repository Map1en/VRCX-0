import { Trash2Icon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getFriendLogRowKey, normalizeUserId } from '../friendLogRows';
import {
    friendLogTypeLabel,
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
}: any) {
    const { t } = useTranslation();

    return useMemo(
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
                accessorFn: (row: any) => row?.created_at || '',
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.date')}
                    />
                ),
                sortingFn: (rowA: any, rowB: any) => {
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
                        (Number.parseInt(rowA.original?.rowId ?? 0, 10) || 0) -
                        (Number.parseInt(rowB.original?.rowId ?? 0, 10) || 0)
                    );
                },
                cell: ({ row }: any) => {
                    const createdAt = row.original?.created_at || '';
                    return (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="text-sm">
                                    {formatDateFilter(createdAt, 'short')}
                                </span>
                            </TooltipTrigger>
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
                accessorFn: (row: any) => row?.type || '',
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendLog.type')}
                    />
                ),
                cell: ({ row }: any) => (
                    <Badge variant="outline" className="text-muted-foreground">
                        {friendLogTypeLabel(row.original?.type, t) ||
                            row.original?.type ||
                            ''}
                    </Badge>
                )
            },
            {
                id: 'displayName',
                size: 260,
                minSize: 80,
                accessorFn: (row: any) =>
                    row?.resolvedDisplayName ||
                    row?.displayName ||
                    row?.userId ||
                    '',
                enableSorting: false,
                header: () => t('table.friendLog.user'),
                cell: ({ row }: any) => renderUserCell(row.original)
            },
            {
                id: 'action',
                size: 80,
                maxSize: 80,
                enableSorting: false,
                accessorFn: (row: any) =>
                    getFriendLogRowKey(row, rowsOwnerUserId),
                header: () => t('table.friendLog.action'),
                cell: ({ row }: any) => {
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
                                onClick={(event: any) =>
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
