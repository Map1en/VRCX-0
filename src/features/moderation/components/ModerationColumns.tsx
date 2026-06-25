import type { ColumnDef } from '@tanstack/react-table';
import { Trash2Icon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    getModerationRowKey,
    resolveModerationTypeLabel
} from '../moderationPageState';
import type {
    DeleteModerationOptions,
    ModerationRow,
    ModerationUserTarget
} from '../moderationPageTypes';
import { SortButton } from './ModerationViewParts';

type ModerationColumnsOptions = {
    deletingModerationKey: string;
    onDeleteModeration: (
        row: ModerationRow,
        options?: DeleteModerationOptions
    ) => void | Promise<void>;
    onOpenUser: (target: ModerationUserTarget) => void;
    shiftHeld: boolean;
};

export function useModerationColumns({
    deletingModerationKey,
    onDeleteModeration,
    onOpenUser,
    shiftHeld
}: ModerationColumnsOptions) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const getModerationTypeLabel = (type: any) =>
        resolveModerationTypeLabel(type, t);

    return useMemo<ColumnDef<ModerationRow>[]>(
        () => [
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
                accessorFn: (row: any) => row?.created || '',
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.moderation.date')}
                    />
                ),
                sortingFn: (rowA: any, rowB: any) => {
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
                cell: ({ row }: any) => {
                    const createdAt = row.original?.created || '';
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
                size: 140,
                meta: {
                    label: t('table.moderation.type')
                },
                accessorFn: (row: any) => row?.type || '',
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.moderation.type')}
                    />
                ),
                cell: ({ row }: any) => (
                    <Badge variant="outline" className="text-muted-foreground">
                        {getModerationTypeLabel(row.original?.type)}
                    </Badge>
                )
            },
            {
                id: 'sourceDisplayName',
                size: 120,
                enableSorting: false,
                meta: {
                    label: t('table.moderation.source')
                },
                accessorFn: (row: any) =>
                    row?.sourceDisplayName || row?.sourceUserId || '',
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.moderation.source')}
                    </span>
                ),
                cell: ({ row }: any) => (
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
                enableSorting: false,
                meta: {
                    label: t('table.moderation.target'),
                    stretch: true
                },
                accessorFn: (row: any) =>
                    row?.targetDisplayName || row?.targetUserId || '',
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.moderation.target')}
                    </span>
                ),
                cell: ({ row }: any) => (
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
                accessorFn: (row: any) => getModerationRowKey(row),
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.moderation.action')}
                    </span>
                ),
                cell: ({ row }: any) => {
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
                                aria-label={t('common.actions.delete')}
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
        ],
        [
            currentUserId,
            deletingModerationKey,
            getModerationTypeLabel,
            onDeleteModeration,
            onOpenUser,
            shiftHeld,
            t
        ]
    );
}
