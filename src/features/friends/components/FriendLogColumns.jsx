import { Trash2Icon, XIcon } from 'lucide-react';

import { formatDateFilter } from '@/lib/dateTime.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { getFriendLogRowKey, normalizeUserId } from '../friendLogRows.js';
import {
    friendLogTypeLabel,
    SortButton,
    renderUserCell
} from './FriendLogViewParts.jsx';

export function buildFriendLogColumns({
    currentUserId,
    deletingRowKey,
    handleDeleteRow,
    loadStatus,
    rowsOwnerUserId,
    shiftHeld,
    t
}) {
    return [
        {
            id: 'spacer',
            size: 20,
            minSize: 0,
            maxSize: 20,
            enableSorting: false,
            enableResizing: false,
            header: () => null,
            cell: () => null
        },
        {
            id: 'created_at',
            size: 120,
            accessorFn: (row) => row?.created_at || '',
            header: ({ column }) => (
                <SortButton column={column} label={t('table.friendLog.date')} />
            ),
            sortingFn: (rowA, rowB) => {
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
            cell: ({ row }) => {
                const createdAt = row.original?.created_at || '';
                return (
                    <span
                        className="text-sm"
                        title={formatDateFilter(createdAt, 'long')}
                    >
                        {formatDateFilter(createdAt, 'short')}
                    </span>
                );
            }
        },
        {
            id: 'type',
            size: 160,
            accessorFn: (row) => row?.type || '',
            header: ({ column }) => (
                <SortButton column={column} label={t('table.friendLog.type')} />
            ),
            cell: ({ row }) => (
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
            accessorFn: (row) => row?.displayName || row?.userId || '',
            header: ({ column }) => (
                <SortButton column={column} label={t('table.friendLog.user')} />
            ),
            sortingFn: (rowA, rowB) =>
                String(
                    rowA.original?.displayName || rowA.original?.userId || ''
                ).localeCompare(
                    String(
                        rowB.original?.displayName ||
                            rowB.original?.userId ||
                            ''
                    ),
                    undefined,
                    { sensitivity: 'base' }
                ),
            cell: ({ row }) => renderUserCell(row.original)
        },
        {
            id: 'action',
            size: 80,
            maxSize: 80,
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
                            aria-label={'Delete'}
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
            header: () => null,
            cell: () => null
        }
    ];
}
