import { ArrowDownIcon, ArrowRightIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { timeToText } from '@/lib/dateTime.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { AvatarInfoLine } from './FeedAvatarInfoLine.jsx';
import { formatDifferenceHtml } from './FeedDifferenceHtml.js';
import { FeedLocationLink } from './FeedLocationLink.jsx';
import { FeedStatusBadge } from './FeedStatusBadge.jsx';

function FeedExpandedRow({
    row,
    loadingHistoryKey,
    endpoint = '',
    onOpenPreviousInstances,
    onNewInstance,
    onPreviewImage
}) {
    const { t } = useTranslation();

    if (row?.type === 'GPS') {
        return (
            <div className="pl-5 text-sm">
                {row.previousLocation ? (
                    <>
                        <FeedLocationLink
                            location={row.previousLocation}
                            worldName={row.previousWorldName}
                            groupName={row.previousGroupName}
                            loadingHistoryKey={loadingHistoryKey}
                            endpoint={endpoint}
                            onOpenPreviousInstances={onOpenPreviousInstances}
                            onNewInstance={onNewInstance}
                            disableTooltip
                            wrapperClassName="inline-block align-middle"
                        />
                        {row.time ? (
                            <Badge variant="secondary" className="ml-1 w-fit">
                                {timeToText(row.time)}
                            </Badge>
                        ) : null}
                        <br />
                        <span className="inline-flex">
                            <ArrowDownIcon className="size-4" />
                        </span>
                    </>
                ) : null}
                {row.location ? (
                    <FeedLocationLink
                        location={row.location}
                        worldName={row.worldName}
                        groupName={row.groupName}
                        loadingHistoryKey={loadingHistoryKey}
                        endpoint={endpoint}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        onNewInstance={onNewInstance}
                        disableTooltip
                    />
                ) : null}
            </div>
        );
    }

    if (row?.type === 'Offline') {
        return row.location ? (
            <div className="pl-5 text-sm">
                <FeedLocationLink
                    location={row.location}
                    worldName={row.worldName}
                    groupName={row.groupName}
                    loadingHistoryKey={loadingHistoryKey}
                    endpoint={endpoint}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    onNewInstance={onNewInstance}
                    disableTooltip
                    wrapperClassName="inline-block align-middle"
                />
                {row.time ? (
                    <Badge variant="secondary" className="ml-1 w-fit">
                        {timeToText(row.time)}
                    </Badge>
                ) : null}
            </div>
        ) : null;
    }

    if (row?.type === 'Online') {
        return row.location ? (
            <div className="pl-5 text-sm">
                <FeedLocationLink
                    location={row.location}
                    worldName={row.worldName}
                    groupName={row.groupName}
                    loadingHistoryKey={loadingHistoryKey}
                    endpoint={endpoint}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    onNewInstance={onNewInstance}
                    disableTooltip
                />
            </div>
        ) : null;
    }

    if (row?.type === 'Status') {
        if (row.statusDescription === row.previousStatusDescription) {
            return (
                <div className="flex items-center pl-5 text-sm">
                    <FeedStatusBadge status={row.previousStatus} />
                    <span className="mx-2 inline-flex">
                        <ArrowRightIcon className="size-4" />
                    </span>
                    <FeedStatusBadge status={row.status} />
                </div>
            );
        }

        return (
            <div className="flex items-center pl-5 text-sm">
                <FeedStatusBadge
                    status={row.previousStatus}
                    label={row.previousStatusDescription || ''}
                />
                <span className="mx-2 inline-flex">
                    <ArrowRightIcon className="size-4" />
                </span>
                <FeedStatusBadge
                    status={row.status}
                    label={row.statusDescription || ''}
                />
            </div>
        );
    }

    if (row?.type === 'Bio') {
        return (
            <div className="pl-5 text-sm">
                <pre
                    className="font-inherit text-xs leading-5 whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                        __html: formatDifferenceHtml(row.previousBio, row.bio)
                    }}
                />
            </div>
        );
    }

    if (row?.type === 'Avatar') {
        const previousImage =
            row.previousCurrentAvatarThumbnailImageUrl ||
            row.previousCurrentAvatarImageUrl ||
            '';
        const currentImage =
            row.currentAvatarThumbnailImageUrl ||
            row.currentAvatarImageUrl ||
            '';

        return (
            <div className="pl-5 text-sm">
                <div className="flex items-center">
                    <div className="inline-block w-40 align-top">
                        {previousImage ? (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto p-0"
                                    aria-label={"Preview previous avatar"}
                                    onClick={() =>
                                        onPreviewImage?.({
                                            url:
                                                row.previousCurrentAvatarImageUrl ||
                                                previousImage,
                                            title:
                                                row.previousAvatarName ||
                                                'Previous avatar'
                                        })
                                    }
                                >
                                    <img
                                        src={previousImage}
                                        alt={t('view.feed.generated.previous_avatar')}
                                        className="h-30 w-40 rounded object-cover"
                                        loading="lazy"
                                    />
                                </Button>
                                <br />
                                <AvatarInfoLine
                                    imageUrl={previousImage}
                                    userId={row.userId}
                                    ownerId={row.previousOwnerId}
                                    avatarName={row.previousAvatarName}
                                    avatarTags={row.previousCurrentAvatarTags}
                                />
                            </>
                        ) : null}
                    </div>
                    <span className="mx-2 inline-flex">
                        <ArrowRightIcon className="size-4" />
                    </span>
                    <div className="inline-block w-40 align-top">
                        {currentImage ? (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto p-0"
                                    aria-label={"Preview current avatar"}
                                    onClick={() =>
                                        onPreviewImage?.({
                                            url:
                                                row.currentAvatarImageUrl ||
                                                currentImage,
                                            title:
                                                row.avatarName ||
                                                'Current avatar'
                                        })
                                    }
                                >
                                    <img
                                        src={currentImage}
                                        alt={row.avatarName || 'Current avatar'}
                                        className="h-30 w-40 rounded object-cover"
                                        loading="lazy"
                                    />
                                </Button>
                                <br />
                                <AvatarInfoLine
                                    imageUrl={currentImage}
                                    userId={row.userId}
                                    ownerId={row.ownerId}
                                    avatarName={row.avatarName}
                                    avatarTags={row.currentAvatarTags}
                                />
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

export { FeedExpandedRow };
