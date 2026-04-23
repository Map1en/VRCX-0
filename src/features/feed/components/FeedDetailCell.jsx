import { ArrowRightIcon } from 'lucide-react';

import { AvatarInfoLine } from './FeedAvatarInfoLine.jsx';
import { FeedLocationLink } from './FeedLocationLink.jsx';
import { FeedStatusBadge } from './FeedStatusBadge.jsx';

function FeedDetailCell({
    row,
    loadingHistoryKey,
    endpoint = '',
    onOpenPreviousInstances,
    onNewInstance
}) {
    const type = row?.type;

    if (type === 'GPS' || type === 'Online' || type === 'Offline') {
        return (
            <FeedLocationLink
                location={row?.location}
                worldName={row?.worldName}
                groupName={row?.groupName}
                loadingHistoryKey={loadingHistoryKey}
                endpoint={endpoint}
                onOpenPreviousInstances={onOpenPreviousInstances}
                onNewInstance={onNewInstance}
                disableTooltip
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
                    {row?.statusDescription || ''}
                </span>
            </div>
        );
    }

    if (type === 'Avatar') {
        return (
            <div className="w-full min-w-0 truncate">
                <AvatarInfoLine
                    imageUrl={row?.currentAvatarImageUrl}
                    userId={row?.userId}
                    ownerId={row?.ownerId}
                    avatarName={row?.avatarName}
                    avatarTags={row?.currentAvatarTags}
                />
            </div>
        );
    }

    if (type === 'Bio') {
        return (
            <span className="block w-full min-w-0 truncate">
                {row?.bio || ''}
            </span>
        );
    }

    return row?.message ? (
        <span className="block w-full min-w-0 truncate">{row.message}</span>
    ) : null;
}

export { FeedDetailCell };
