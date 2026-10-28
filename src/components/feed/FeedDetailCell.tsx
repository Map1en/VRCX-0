import { ArrowRightIcon } from 'lucide-react';

import {
    LogFilterMenuItems,
    type LogFilterCommands
} from '@/components/data-table/LogFilterContextMenu';
import { parseLocation } from '@/shared/utils/location';

import { AvatarInfoLine } from './FeedAvatarInfoLine';
import { FeedLocationLink } from './FeedLocationLink';
import { resolveFeedLocationForDisplay } from './feedRows';
import { FeedStatusBadge } from './FeedStatusBadge';
import type { FeedLocationActionPayload, FeedRow } from './feedTypes';

type FeedDetailCellProps = {
    filterCommands?: LogFilterCommands;
    loadingHistoryKey?: string;
    locationClassName?: string;
    onNewInstance?(payload?: FeedLocationActionPayload): void;
    onOpenPreviousInstances?(payload?: FeedLocationActionPayload): void;
    row: FeedRow;
};

function FeedDetailCell({
    filterCommands,
    loadingHistoryKey = '',
    locationClassName = '',
    onNewInstance,
    onOpenPreviousInstances,
    row
}: FeedDetailCellProps) {
    const type = row?.type;

    if (type === 'GPS' || type === 'Online' || type === 'Offline') {
        const location = resolveFeedLocationForDisplay(row);
        return (
            <FeedLocationLink
                className={locationClassName}
                contextMenuExtraItems={
                    filterCommands ? (
                        <LogFilterMenuItems
                            commands={filterCommands}
                            target={{
                                worldId: parseLocation(location).worldId,
                                worldName: row?.worldName || ''
                            }}
                        />
                    ) : undefined
                }
                disableTooltip
                groupName={row?.groupName}
                loadingHistoryKey={loadingHistoryKey}
                location={location}
                onNewInstance={onNewInstance}
                onOpenPreviousInstances={onOpenPreviousInstances}
                worldName={row?.worldName}
            />
        );
    }

    if (type === 'Status') {
        if (row?.statusDescription === row?.previousStatusDescription) {
            return (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                    <FeedStatusBadge status={row?.previousStatus} />
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                    <FeedStatusBadge status={row?.status} />
                </div>
            );
        }

        return (
            <div className="flex min-w-0 items-center gap-2">
                <FeedStatusBadge status={row?.status} />
                <span className="block w-full min-w-0 truncate">
                    {row.statusDescription || ''}
                </span>
            </div>
        );
    }

    if (type === 'Avatar') {
        return (
            <div className="w-full min-w-0 truncate">
                <AvatarInfoLine
                    avatarName={row?.avatarName}
                    avatarTags={row?.currentAvatarTags}
                    imageUrl={row?.currentAvatarImageUrl}
                    ownerId={row?.ownerId}
                    userId={row?.userId}
                />
            </div>
        );
    }

    if (type === 'Bio') {
        return (
            <span className="block w-full min-w-0 truncate">
                {row.bio || ''}
            </span>
        );
    }

    return null;
}

export { FeedDetailCell };
