import { MapPinIcon, PencilIcon, PersonStandingIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import type { FriendRecordInput } from '@/domain/friends/types';
import { cn } from '@/lib/utils';
import { openUserDialog } from '@/services/dialogService';
import {
    SOLID_USER_STATUS_DOT_CLASS_NAMES,
    userStatusFromValue
} from '@/shared/utils/friendStatus';
import { normalizeString } from '@/shared/utils/string';
import { Button } from '@/ui/shadcn/button';

const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

type DashboardFeedRow = Record<string, unknown> & {
    id?: string | number | null;
    rowId?: string | number | null;
    type?: string | null;
    created_at?: string | null;
    createdAt?: string | null;
    userId?: string | null;
    senderUserId?: string | null;
    displayName?: string | null;
    details?: Record<string, unknown> | null;
    location?: string | null;
    worldName?: string | null;
    groupName?: string | null;
    message?: string | null;
    status?: string | null;
    statusDescription?: string | null;
    avatarName?: string | null;
    bio?: string | null;
};

function resolveFeedUserDisplayName(
    row: DashboardFeedRow,
    friend: FriendRecordInput | null | undefined
) {
    const userId = normalizeString(row?.userId);
    const rowDisplayName = normalizeString(row?.displayName);
    const friendDisplayName = normalizeString(
        friend?.displayName || friend?.username
    );
    if (rowDisplayName) {
        return rowDisplayName;
    }
    if (friendDisplayName) {
        return friendDisplayName;
    }
    return userId || UNKNOWN_FEED_USER_DISPLAY_NAME;
}

function openFeedUser(
    row: DashboardFeedRow,
    friend: FriendRecordInput | null | undefined
) {
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return;
    }
    openUserDialog({
        userId,
        title: resolveFeedUserDisplayName(row, friend) || undefined,
        seedData: row
    });
}

function getFeedRowId(row: DashboardFeedRow) {
    if (row?.id != null) {
        return `id:${row.id}`;
    }
    if (row?.rowId != null) {
        return `row:${row?.type ?? ''}:${row.rowId}`;
    }
    const type = row?.type ?? '';
    const createdAt = row?.created_at ?? row?.createdAt ?? '';
    const userId = row?.userId ?? row?.senderUserId ?? '';
    const location = row?.location ?? row?.details?.location ?? '';
    const message = row?.message ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

export function getFeedRowKey(row: DashboardFeedRow) {
    return [
        getFeedRowId(row),
        row?.type ?? '',
        row?.created_at ?? row?.createdAt ?? '',
        row?.userId ?? row?.senderUserId ?? '',
        row?.location ?? row?.details?.location ?? '',
        row?.status ?? '',
        row?.avatarName ?? '',
        row?.bio ?? '',
        row?.message ?? ''
    ].join(':');
}

function FeedUserName({
    row,
    friend,
    className = ''
}: {
    row: DashboardFeedRow;
    friend?: FriendRecordInput | null;
    className?: string;
}) {
    const displayName = resolveFeedUserDisplayName(row, friend);
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return <span className={className}>{displayName}</span>;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className={cn(
                'hover:text-primary h-auto shrink-0 cursor-pointer justify-start p-0 text-left font-normal',
                className
            )}
            onClick={() => openFeedUser(row, friend)}
        >
            {displayName}
        </Button>
    );
}

function FeedLocation({
    row,
    className = 'text-foreground [&_button:hover]:text-foreground'
}: {
    row: DashboardFeedRow;
    className?: string;
}) {
    if (!row?.location) {
        return null;
    }
    return (
        <div className="min-w-0 flex-1 truncate">
            <Location
                location={row.location}
                hint={row.worldName || ''}
                grouphint={row.groupName || ''}
                enableContextMenu
                disableTooltip
                className={className}
            />
        </div>
    );
}

function FeedStatusDot({ status = '' }: { status?: string | null }) {
    const normalizedStatus =
        String(status || '').toLowerCase() === 'online'
            ? 'active'
            : userStatusFromValue(status);

    if (!normalizedStatus || normalizedStatus === 'offline') {
        return null;
    }

    return (
        <span
            className={cn(
                'mr-1 ml-0.5 size-2.5 shrink-0 self-center rounded-full',
                SOLID_USER_STATUS_DOT_CLASS_NAMES[normalizedStatus]
            )}
            data-dashboard-feed-status-dot
        />
    );
}

export function FeedEntryContent({
    row,
    friend
}: {
    row: DashboardFeedRow;
    friend?: FriendRecordInput | null;
}) {
    const { t } = useTranslation();

    switch (row?.type) {
        case 'GPS':
            return (
                <div className="flex min-w-0 items-center">
                    <MapPinIcon className="mr-1 size-3.5 shrink-0 text-sky-500" />
                    <FeedUserName row={row} friend={friend} />
                    <span className="text-muted-foreground mx-1 shrink-0">
                        →
                    </span>
                    <FeedLocation row={row} />
                </div>
            );
        case 'Online':
            return (
                <div className="flex min-w-0 items-center">
                    <FeedStatusDot status="online" />
                    <FeedUserName row={row} friend={friend} />
                    {row?.location ? (
                        <>
                            <span className="text-muted-foreground mx-1 shrink-0">
                                →
                            </span>
                            <FeedLocation row={row} />
                        </>
                    ) : null}
                </div>
            );
        case 'Offline':
            return (
                <div className="flex min-w-0 items-center">
                    <FeedUserName row={row} friend={friend} />
                </div>
            );
        case 'Status':
            return (
                <div className="flex min-w-0 items-center">
                    <FeedStatusDot status={row?.status} />
                    <FeedUserName row={row} friend={friend} />
                    <span className="text-muted-foreground ml-1 min-w-0 truncate">
                        {row?.statusDescription || ''}
                    </span>
                </div>
            );
        case 'Avatar':
            return (
                <div className="flex min-w-0 items-center">
                    <PersonStandingIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                    <FeedUserName row={row} friend={friend} />
                    <span className="text-muted-foreground ml-1 min-w-0 truncate">
                        {row?.avatarName ? `→ ${row.avatarName}` : ''}
                    </span>
                </div>
            );
        case 'Bio':
            return (
                <div className="flex min-w-0 items-center">
                    <PencilIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                    <FeedUserName row={row} friend={friend} />
                    <span className="text-muted-foreground ml-1">
                        {t('dashboard.widget.feed_bio')}
                    </span>
                </div>
            );
        default:
            return (
                <div className="flex min-w-0 items-center">
                    <FeedUserName row={row} friend={friend} />
                    <span className="text-muted-foreground ml-1 min-w-0 truncate">
                        {row?.type || ''}
                    </span>
                </div>
            );
    }
}
