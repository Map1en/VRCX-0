import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';

import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { resolveFeedUserDisplayName, resolveFeedUserId } from '../feedRows.js';
import {
    FeedDetailCell,
    FeedUserLink,
    SortButton,
    formatTimestamp,
    formatTimestampLong
} from './FeedTableParts.jsx';

function ExpanderCell({ row }) {
    if (!row.getCanExpand()) {
        return null;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => row.toggleExpanded()}
        >
            {row.getIsExpanded() ? (
                <ChevronDownIcon data-icon="icon" />
            ) : (
                <ChevronRightIcon data-icon="icon" />
            )}
        </Button>
    );
}

function DateCell({ row }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="text-muted-foreground text-sm">
                    {formatTimestamp(row.original.created_at)}
                </span>
            </TooltipTrigger>
            <TooltipContent side="right">
                {formatTimestampLong(row.original.created_at)}
            </TooltipContent>
        </Tooltip>
    );
}

export function buildFeedColumns({
    canBoopFromFeed,
    canSendInviteFromFeed,
    canUseFeedFriendLocation,
    currentEndpoint,
    currentUserId,
    currentUserSnapshot,
    friendLogNamesById,
    friendsById,
    launchFeedFriendLocation,
    loadingPreviousInstancesKey,
    onNewInstance,
    onOpenPreviousInstances,
    requestFeedFriendInvite,
    selfInviteFeedFriendLocation,
    sendFeedFriendBoop,
    sendFeedFriendInvite,
    t
}) {
    return [
        {
            id: 'expander',
            size: 20,
            enableSorting: false,
            enableHiding: false,
            meta: { label: '' },
            header: () => null,
            cell: ({ row }) => <ExpanderCell row={row} />
        },
        {
            id: 'created_at',
            accessorFn: (row) =>
                new Date(row?.created_at || 0).valueOf() || 0,
            meta: { label: t('table.feed.date') },
            header: ({ column }) => (
                <SortButton column={column} label={t('table.feed.date')} />
            ),
            cell: ({ row }) => <DateCell row={row} />
        },
        {
            id: 'type',
            accessorFn: (row) => String(row?.type || ''),
            meta: { label: t('table.feed.type') },
            header: ({ column }) => (
                <SortButton column={column} label={t('table.feed.type')} />
            ),
            cell: ({ row }) => {
                const typeLabel = row.original.type
                    ? t(`view.feed.filters.${row.original.type}`)
                    : '';
                return <Badge variant="outline">{typeLabel}</Badge>;
            }
        },
        {
            id: 'displayName',
            accessorFn: (row) =>
                resolveFeedUserDisplayName(
                    row,
                    friendsById?.[resolveFeedUserId(row)],
                    friendLogNamesById?.[resolveFeedUserId(row)]
                ),
            meta: { label: t('table.feed.user') },
            header: ({ column }) => (
                <SortButton column={column} label={t('table.feed.user')} />
            ),
            cell: ({ row }) => (
                <FeedUserLink
                    row={row.original}
                    friend={friendsById?.[resolveFeedUserId(row.original)]}
                    cachedDisplayName={
                        friendLogNamesById?.[resolveFeedUserId(row.original)]
                    }
                    endpoint={currentEndpoint}
                    currentUserId={currentUserId}
                    currentUserSnapshot={currentUserSnapshot}
                    canSendInvite={canSendInviteFromFeed}
                    canBoop={canBoopFromFeed}
                    canUseFriendInstance={canUseFeedFriendLocation}
                    actions={{
                        launchLocation: launchFeedFriendLocation,
                        selfInviteLocation: selfInviteFeedFriendLocation,
                        sendInvite: sendFeedFriendInvite,
                        requestInvite: requestFeedFriendInvite,
                        sendBoop: sendFeedFriendBoop
                    }}
                />
            )
        },
        {
            id: 'detail',
            accessorFn: (row) =>
                [
                    row?.location,
                    row?.worldName,
                    row?.statusDescription,
                    row?.avatarName,
                    row?.bio,
                    row?.message
                ]
                    .filter(Boolean)
                    .join(' '),
            enableSorting: false,
            meta: { label: t('table.feed.detail') },
            header: () => t('table.feed.detail'),
            minSize: 100,
            cell: ({ row }) => (
                <FeedDetailCell
                    row={row.original}
                    loadingHistoryKey={loadingPreviousInstancesKey}
                    endpoint={currentEndpoint}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    onNewInstance={onNewInstance}
                />
            )
        }
    ];
}
