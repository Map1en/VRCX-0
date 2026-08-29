import { ChevronRightIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppCellContext, AppRow } from '@/components/data-table/appTable';
import {
    getFeedRowCreatedAtMs,
    resolveFeedUserDisplayName,
    resolveFeedUserId
} from '@/components/feed/feedRows';
import { FeedTypeIndicator } from '@/components/feed/FeedTypeIndicator';
import type {
    FeedColumns,
    FeedRow,
    FeedTableMeta
} from '@/components/feed/feedTypes';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    FeedDetailCell,
    FeedUserLink,
    SortButton,
    formatTimestampLong,
    formatTimestampParts
} from './FeedTableParts';

function ExpanderCell({ row }: { row: AppRow<FeedRow> }) {
    if (!row.getCanExpand()) {
        return null;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => row.toggleExpanded()}
        >
            <ChevronRightIcon
                data-icon="icon"
                className={cn(
                    'transition-transform duration-150 ease-out',
                    row.getIsExpanded() && 'rotate-90'
                )}
            />
        </Button>
    );
}

function DateCell({ row }: { row: AppRow<FeedRow> }) {
    const { date, time } = formatTimestampParts(row.original.created_at);
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="text-sm font-normal tabular-nums">
                        <span className="text-muted-foreground/80">{date}</span>
                        {time ? (
                            <span className="text-foreground/75 ml-1">
                                {time}
                            </span>
                        ) : null}
                    </span>
                }
            />
            <TooltipContent side="right">
                {formatTimestampLong(row.original.created_at)}
            </TooltipContent>
        </Tooltip>
    );
}

function UserCell({ row, table }: AppCellContext<FeedRow>) {
    const meta = table.options.meta?.feed;
    if (!meta) {
        return null;
    }

    return (
        <FeedUserLink
            actions={meta.actions}
            cachedDisplayName={
                meta.friendLogNamesById[resolveFeedUserId(row.original)]
            }
            row={row.original}
        />
    );
}

function DetailCell({ row, table }: AppCellContext<FeedRow>) {
    const meta = table.options.meta?.feed;
    if (!meta) {
        return null;
    }

    return (
        <div className="text-foreground/80 font-normal">
            <FeedDetailCell
                loadingHistoryKey={meta.loadingPreviousInstancesKey}
                onNewInstance={meta.actions.openFeedNewInstance}
                onOpenPreviousInstances={meta.onOpenPreviousInstances}
                row={row.original}
            />
        </div>
    );
}

export function useFeedColumns(meta: FeedTableMeta): FeedColumns {
    const { t } = useTranslation();

    return useMemo<FeedColumns>(
        () => [
            {
                id: 'expander',
                size: 50,
                minSize: 50,
                maxSize: 50,
                enableResizing: false,
                enableSorting: false,
                enableHiding: false,
                meta: { label: '' },
                header: () => null,
                cell: ({ row }) => <ExpanderCell row={row} />
            },
            {
                id: 'created_at',
                accessorFn: getFeedRowCreatedAtMs,
                meta: { label: t('table.feed.date') },
                header: ({ column }) => (
                    <SortButton column={column} label={t('table.feed.date')} />
                ),
                cell: ({ row }) => <DateCell row={row} />
            },
            {
                id: 'type',
                accessorFn: (row: FeedRow) => row.type || '',
                meta: { label: t('table.feed.type') },
                header: ({ column }) => (
                    <SortButton column={column} label={t('table.feed.type')} />
                ),
                cell: ({ row }) => {
                    const typeLabel = row.original.type
                        ? t(`view.feed.filters.${row.original.type}`)
                        : '';
                    return (
                        <FeedTypeIndicator
                            label={typeLabel}
                            type={row.original.type}
                        />
                    );
                }
            },
            {
                id: 'displayName',
                accessorFn: (row: FeedRow) => {
                    const userId = resolveFeedUserId(row);
                    return resolveFeedUserDisplayName(
                        row,
                        meta.knownUsersById[userId],
                        meta.friendLogNamesById[userId]
                    );
                },
                meta: { label: t('table.feed.user') },
                header: ({ column }) => (
                    <SortButton column={column} label={t('table.feed.user')} />
                ),
                cell: UserCell
            },
            {
                id: 'detail',
                accessorFn: (row: FeedRow) =>
                    [
                        row?.location,
                        row?.worldName,
                        row?.statusDescription,
                        row?.avatarName,
                        row?.bio
                    ]
                        .filter(Boolean)
                        .join(' '),
                enableSorting: false,
                enableHiding: false,
                meta: { label: t('table.feed.detail'), stretch: true },
                header: () => (
                    <span className="text-muted-foreground text-xs tracking-wide uppercase">
                        {t('table.feed.detail')}
                    </span>
                ),
                minSize: 100,
                cell: DetailCell
            }
        ],
        [meta, t]
    );
}
