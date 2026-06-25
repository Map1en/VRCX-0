import { ArrowDownIcon, ArrowRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { timeToText } from '@/lib/dateTime';
import { useModalStore } from '@/state/modalStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { resolveFeedLocationForDisplay } from '../feedRows';
import type { FeedLocationActionPayload, FeedRow } from '../feedTypes';
import { AvatarInfoLine } from './FeedAvatarInfoLine';
import { formatDifferenceHtml } from './FeedDifferenceHtml';
import { FeedLocationLink } from './FeedLocationLink';
import { FeedStatusBadge } from './FeedStatusBadge';

type FeedExpandedRowProps = {
    loadingHistoryKey: string;
    onNewInstance(payload?: FeedLocationActionPayload): void;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    row: FeedRow;
};

function FeedExpandedRow({
    loadingHistoryKey,
    onNewInstance,
    onOpenPreviousInstances,
    row
}: FeedExpandedRowProps) {
    const { t } = useTranslation();
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const displayLocation = resolveFeedLocationForDisplay(row);

    if (row?.type === 'GPS') {
        return (
            <div className="pl-5 text-sm">
                {row.previousLocation ? (
                    <>
                        <FeedLocationLink
                            disableTooltip
                            groupName={row.previousGroupName}
                            loadingHistoryKey={loadingHistoryKey}
                            location={row.previousLocation}
                            onNewInstance={onNewInstance}
                            onOpenPreviousInstances={onOpenPreviousInstances}
                            worldName={row.previousWorldName}
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
                {displayLocation ? (
                    <FeedLocationLink
                        disableTooltip
                        groupName={row.groupName}
                        loadingHistoryKey={loadingHistoryKey}
                        location={displayLocation}
                        onNewInstance={onNewInstance}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        worldName={row.worldName}
                    />
                ) : null}
            </div>
        );
    }

    if (row?.type === 'Offline') {
        return displayLocation ? (
            <div className="pl-5 text-sm">
                <FeedLocationLink
                    disableTooltip
                    groupName={row.groupName}
                    loadingHistoryKey={loadingHistoryKey}
                    location={displayLocation}
                    onNewInstance={onNewInstance}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    worldName={row.worldName}
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
        return displayLocation ? (
            <div className="pl-5 text-sm">
                <FeedLocationLink
                    disableTooltip
                    groupName={row.groupName}
                    loadingHistoryKey={loadingHistoryKey}
                    location={displayLocation}
                    onNewInstance={onNewInstance}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    worldName={row.worldName}
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
                    label={String(row.previousStatusDescription || '')}
                />
                <span className="mx-2 inline-flex">
                    <ArrowRightIcon className="size-4" />
                </span>
                <FeedStatusBadge
                    status={row.status}
                    label={String(row.statusDescription || '')}
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
        const previousAvatarLabel = t('view.feed.label.previous_avatar');
        const currentAvatarLabel = t('dialog.avatar.actions.current_avatar');

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
                                    aria-label={previousAvatarLabel}
                                    onClick={() =>
                                        openImagePreview({
                                            url: String(
                                                row.previousCurrentAvatarImageUrl ||
                                                    previousImage
                                            ),
                                            title:
                                                String(
                                                    row.previousAvatarName || ''
                                                ) || previousAvatarLabel
                                        })
                                    }
                                >
                                    <img
                                        src={String(previousImage)}
                                        alt={previousAvatarLabel}
                                        className="h-30 w-40 rounded object-cover"
                                        loading="lazy"
                                    />
                                </Button>
                                <br />
                                <AvatarInfoLine
                                    avatarName={row.previousAvatarName}
                                    avatarTags={row.previousCurrentAvatarTags}
                                    imageUrl={previousImage}
                                    ownerId={row.previousOwnerId}
                                    userId={row.userId}
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
                                    aria-label={currentAvatarLabel}
                                    onClick={() =>
                                        openImagePreview({
                                            url: String(
                                                row.currentAvatarImageUrl ||
                                                    currentImage
                                            ),
                                            title:
                                                String(row.avatarName || '') ||
                                                currentAvatarLabel
                                        })
                                    }
                                >
                                    <img
                                        src={String(currentImage)}
                                        alt={
                                            String(row.avatarName || '') ||
                                            currentAvatarLabel
                                        }
                                        className="h-30 w-40 rounded object-cover"
                                        loading="lazy"
                                    />
                                </Button>
                                <br />
                                <AvatarInfoLine
                                    avatarName={row.avatarName}
                                    avatarTags={row.currentAvatarTags}
                                    imageUrl={currentImage}
                                    ownerId={row.ownerId}
                                    userId={row.userId}
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
