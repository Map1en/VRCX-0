import { Trash2Icon, XIcon } from 'lucide-react';

import { formatDateFilter } from '@/lib/dateTime.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { SortButton } from './ModerationViewParts.jsx';

export function buildModerationColumns({
    currentUserId,
    deletingModerationKey,
    getModerationRowKey,
    getModerationTypeLabel,
    onDeleteModeration,
    onOpenUser,
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
            enableHiding: false,
            header: () => null,
            cell: () => null
        },
        {
            id: 'created',
            size: 120,
            meta: {
                label: t('table.moderation.date')
            },
            accessorFn: (row) => row?.created || '',
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.moderation.date')}
                />
            ),
            sortingFn: (rowA, rowB) => {
                const leftTs = Date.parse(rowA.original?.created ?? '');
                const rightTs = Date.parse(rowB.original?.created ?? '');
                if (
                    Number.isFinite(leftTs) &&
                    Number.isFinite(rightTs) &&
                    leftTs !== rightTs
                ) {
                    return leftTs - rightTs;
                }
                return String(rowA.original?.id || '').localeCompare(
                    String(rowB.original?.id || '')
                );
            },
            cell: ({ row }) => {
                const createdAt = row.original?.created || '';
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
            size: 140,
            meta: {
                label: t('table.moderation.type')
            },
            accessorFn: (row) => row?.type || '',
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.moderation.type')}
                />
            ),
            cell: ({ row }) => (
                <Badge variant="outline" className="text-muted-foreground">
                    {getModerationTypeLabel(row.original?.type)}
                </Badge>
            )
        },
        {
            id: 'sourceDisplayName',
            size: 120,
            meta: {
                label: t('table.moderation.source')
            },
            accessorFn: (row) =>
                row?.sourceDisplayName || row?.sourceUserId || '',
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.moderation.source')}
                />
            ),
            sortingFn: (rowA, rowB) =>
                String(
                    rowA.original?.sourceDisplayName ||
                        rowA.original?.sourceUserId ||
                        ''
                ).localeCompare(
                    String(
                        rowB.original?.sourceDisplayName ||
                            rowB.original?.sourceUserId ||
                            ''
                    ),
                    undefined,
                    {
                        sensitivity: 'base'
                    }
                ),
            cell: ({ row }) => (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary block h-auto w-full min-w-0 truncate p-0 pr-2.5 text-left text-sm font-normal"
                    disabled={!row.original?.sourceUserId}
                    onClick={() =>
                        onOpenUser({
                            userId: row.original?.sourceUserId,
                            title:
                                row.original?.sourceDisplayName ||
                                row.original?.sourceUserId
                        })
                    }
                >
                    {row.original?.sourceDisplayName ||
                        row.original?.sourceUserId ||
                        ''}
                </Button>
            )
        },
        {
            id: 'targetDisplayName',
            size: 260,
            minSize: 80,
            meta: {
                label: t('table.moderation.target'),
                stretch: true
            },
            accessorFn: (row) =>
                row?.targetDisplayName || row?.targetUserId || '',
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.moderation.target')}
                />
            ),
            sortingFn: (rowA, rowB) =>
                String(
                    rowA.original?.targetDisplayName ||
                        rowA.original?.targetUserId ||
                        ''
                ).localeCompare(
                    String(
                        rowB.original?.targetDisplayName ||
                            rowB.original?.targetUserId ||
                            ''
                    ),
                    undefined,
                    {
                        sensitivity: 'base'
                    }
                ),
            cell: ({ row }) => (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary block h-auto w-full min-w-0 p-0 pr-2.5 text-left text-sm font-normal break-words whitespace-normal"
                    disabled={!row.original?.targetUserId}
                    onClick={() =>
                        onOpenUser({
                            userId: row.original?.targetUserId,
                            title:
                                row.original?.targetDisplayName ||
                                row.original?.targetUserId
                        })
                    }
                >
                    {row.original?.targetDisplayName ||
                        row.original?.targetUserId ||
                        ''}
                </Button>
            )
        },
        {
            id: 'action',
            size: 80,
            minSize: 80,
            maxSize: 80,
            enableSorting: false,
            meta: {
                label: t('table.moderation.action')
            },
            accessorFn: (row) => getModerationRowKey(row),
            header: () => (
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('table.moderation.action')}
                </span>
            ),
            cell: ({ row }) => {
                const original = row.original;
                const rowKey = getModerationRowKey(original);
                const canDelete =
                    Boolean(currentUserId) &&
                    original?.sourceUserId === currentUserId;
                const isDeleting = deletingModerationKey === rowKey;
                if (!canDelete) {
                    return null;
                }
                return (
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Delete"
                            disabled={isDeleting}
                            onClick={() =>
                                onDeleteModeration(original, {
                                    skipConfirm: shiftHeld
                                })
                            }
                        >
                            {isDeleting ? (
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
            enableHiding: false,
            header: () => null,
            cell: () => null
        }
    ];
}
