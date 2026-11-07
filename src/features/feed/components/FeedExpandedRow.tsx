import { ArrowRightIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AvatarInfoLine } from '@/components/feed/FeedAvatarInfoLine';
import { FeedLocationLink } from '@/components/feed/FeedLocationLink';
import { resolveFeedLocationForDisplay } from '@/components/feed/feedRows';
import { FeedStatusBadge } from '@/components/feed/FeedStatusBadge';
import type {
    FeedLocationActionPayload,
    FeedRow
} from '@/components/feed/feedTypes';
import { useResolvedLocation } from '@/components/location/useResolvedLocation';
import { FadeInImage } from '@/components/media/FadeInImage';
import { timeToText } from '@/lib/dateTime';
import { useWorldSummaries } from '@/lib/useWorldSummaries';
import { parseLocation } from '@/shared/utils/location';
import { replaceBioSymbols } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { formatDifferenceHtml } from './FeedDifferenceHtml';

type FeedExpandedRowProps = {
    loadingHistoryKey: string;
    onNewInstance(payload?: FeedLocationActionPayload): void;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    row: FeedRow;
};

function ExpandedRowShell({ children }: { children: ReactNode }) {
    return (
        <div className="animate-in fade-in border-border ml-2.5 border-l-2 py-3 pl-7 text-sm duration-150">
            {children}
        </div>
    );
}

type AvatarColumnProps = {
    avatarName: string | null | undefined;
    avatarTags: string[] | null | undefined;
    imageAlt: string;
    imageUrl: string;
    label: string;
    onOpenPreview(): void;
    ownerId: string | null | undefined;
    userId: string | null | undefined;
};

function AvatarColumn({
    avatarName,
    avatarTags,
    imageAlt,
    imageUrl,
    label,
    onOpenPreview,
    ownerId,
    userId
}: AvatarColumnProps) {
    return (
        <div className="flex w-40 flex-col gap-1">
            <span className="text-muted-foreground text-xs">{label}</span>
            <Button
                type="button"
                variant="ghost"
                className="h-auto w-fit p-0"
                aria-label={label}
                onClick={onOpenPreview}
            >
                <FadeInImage
                    src={imageUrl}
                    alt={imageAlt}
                    className="h-30 w-40 rounded-lg border object-cover"
                    loading="lazy"
                />
            </Button>
            <AvatarInfoLine
                avatarName={avatarName}
                avatarTags={avatarTags}
                imageUrl={imageUrl}
                ownerId={ownerId}
                userId={userId}
            />
        </div>
    );
}

type LocationColumnProps = Omit<FeedExpandedRowProps, 'row'> & {
    caption: string;
    groupName?: string | null;
    location: string | null | undefined;
    thumbnailUrl: string;
    worldName?: string | null;
};

function LocationColumn({
    caption,
    groupName,
    loadingHistoryKey,
    location,
    onNewInstance,
    onOpenPreviousInstances,
    thumbnailUrl,
    worldName
}: LocationColumnProps) {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const resolved = useResolvedLocation({
        location,
        hint: worldName,
        grouphint: groupName,
        endpoint
    });
    const instance = resolved.instanceName
        ? ` · #${resolved.instanceName}`
        : '';
    const group = resolved.groupName ? ` (${resolved.groupName})` : '';
    const fullText = resolved.text ? `${resolved.text}${instance}${group}` : '';
    const body = (
        <div className="flex min-w-0 flex-col gap-1">
            {thumbnailUrl ? (
                <FadeInImage
                    src={thumbnailUrl}
                    alt=""
                    className="h-42 w-56 rounded-lg border object-cover"
                    loading="lazy"
                />
            ) : (
                <div className="bg-muted h-42 w-56 rounded-lg border" />
            )}
            <FeedLocationLink
                disableTooltip
                groupName={groupName}
                loadingHistoryKey={loadingHistoryKey}
                location={location}
                onNewInstance={onNewInstance}
                onOpenPreviousInstances={onOpenPreviousInstances}
                worldName={worldName}
                wrapperClassName="min-w-0"
            />
        </div>
    );

    return (
        <div className="flex w-56 min-w-0 flex-col gap-1">
            <span className="text-muted-foreground truncate text-xs">
                {caption}
            </span>
            {fullText ? (
                <Tooltip>
                    <TooltipTrigger render={body} />
                    <TooltipContent className="max-w-sm">
                        {fullText}
                    </TooltipContent>
                </Tooltip>
            ) : (
                body
            )}
        </div>
    );
}

function GpsExpandedContent({ row, ...actions }: FeedExpandedRowProps) {
    const { t } = useTranslation();
    const displayLocation = resolveFeedLocationForDisplay(row);
    const previousWorldId = parseLocation(row.previousLocation).worldId;
    const currentWorldId = parseLocation(displayLocation).worldId;
    const worldIds = useMemo(
        () => [previousWorldId, currentWorldId].filter(Boolean),
        [currentWorldId, previousWorldId]
    );
    const worlds = useWorldSummaries(worldIds);
    const previousLabel = t('view.feed.label.previous_location');

    return (
        <div className="flex items-center gap-3">
            <LocationColumn
                {...actions}
                caption={
                    row.time
                        ? `${previousLabel} · ${t('view.feed.label.stayed', {
                              duration: timeToText(row.time)
                          })}`
                        : previousLabel
                }
                location={row.previousLocation}
                thumbnailUrl={worlds.get(previousWorldId)?.thumbnailUrl ?? ''}
            />
            <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
            <LocationColumn
                {...actions}
                caption={t('view.feed.label.current_location')}
                groupName={row.groupName}
                location={displayLocation}
                thumbnailUrl={worlds.get(currentWorldId)?.thumbnailUrl ?? ''}
                worldName={row.worldName}
            />
        </div>
    );
}

function FeedExpandedRow({
    loadingHistoryKey,
    onNewInstance,
    onOpenPreviousInstances,
    row
}: FeedExpandedRowProps) {
    const { t } = useTranslation();
    const openImagePreview = useModalStore((state) => state.openImagePreview);

    if (row?.type === 'GPS') {
        return (
            <ExpandedRowShell>
                <GpsExpandedContent
                    loadingHistoryKey={loadingHistoryKey}
                    onNewInstance={onNewInstance}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    row={row}
                />
            </ExpandedRowShell>
        );
    }

    if (row?.type === 'Status') {
        return (
            <ExpandedRowShell>
                <div className="flex max-w-2xl items-center gap-2">
                    <span className="inline-flex items-center gap-1.5">
                        <FeedStatusBadge status={row.previousStatus} />
                        <span className="bg-destructive/10 text-destructive rounded px-0.5 line-through">
                            {row.previousStatusDescription || ''}
                        </span>
                    </span>
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="inline-flex items-center gap-1.5">
                        <FeedStatusBadge status={row.status} />
                        <span className="bg-primary/10 text-primary rounded px-0.5">
                            {row.statusDescription || ''}
                        </span>
                    </span>
                </div>
            </ExpandedRowShell>
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
            <ExpandedRowShell>
                <div className="flex items-center gap-3">
                    {previousImage ? (
                        <AvatarColumn
                            avatarName={row.previousAvatarName}
                            avatarTags={row.previousCurrentAvatarTags}
                            imageAlt={previousAvatarLabel}
                            imageUrl={previousImage}
                            label={previousAvatarLabel}
                            onOpenPreview={() =>
                                openImagePreview({
                                    url:
                                        row.previousCurrentAvatarImageUrl ||
                                        previousImage,
                                    title:
                                        row.previousAvatarName ||
                                        previousAvatarLabel
                                })
                            }
                            ownerId={row.previousOwnerId}
                            userId={row.userId}
                        />
                    ) : null}
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                    {currentImage ? (
                        <AvatarColumn
                            avatarName={row.avatarName}
                            avatarTags={row.currentAvatarTags}
                            imageAlt={row.avatarName || currentAvatarLabel}
                            imageUrl={currentImage}
                            label={currentAvatarLabel}
                            onOpenPreview={() =>
                                openImagePreview({
                                    url:
                                        row.currentAvatarImageUrl ||
                                        currentImage,
                                    title: row.avatarName || currentAvatarLabel
                                })
                            }
                            ownerId={row.ownerId}
                            userId={row.userId}
                        />
                    ) : null}
                </div>
            </ExpandedRowShell>
        );
    }

    if (row?.type === 'Bio') {
        return (
            <ExpandedRowShell>
                <pre
                    className="font-inherit max-w-prose text-sm leading-6 whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                        __html: formatDifferenceHtml(
                            replaceBioSymbols(row.previousBio),
                            replaceBioSymbols(row.bio)
                        )
                    }}
                />
            </ExpandedRowShell>
        );
    }

    return null;
}

export { FeedExpandedRow };
