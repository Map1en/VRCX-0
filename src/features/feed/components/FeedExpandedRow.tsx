import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { timeToText } from '@/lib/dateTime';
import { useModalStore } from '@/state/modalStore';
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

function ExpandedRowShell({ children }: { children: ReactNode }) {
    return (
        <div className="animate-in fade-in border-border ml-3 border-l-2 py-3 pl-4 text-sm duration-150">
            {children}
        </div>
    );
}

type AvatarColumnProps = {
    avatarName: unknown;
    avatarTags: unknown;
    imageAlt: string;
    imageUrl: string;
    label: string;
    onOpenPreview(): void;
    ownerId: unknown;
    userId: unknown;
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

function FeedExpandedRow({
    loadingHistoryKey,
    onNewInstance,
    onOpenPreviousInstances,
    row
}: FeedExpandedRowProps) {
    const { t } = useTranslation();
    const openImagePreview = useModalStore((state) => state.openImagePreview);

    if (row?.type === 'GPS') {
        const displayLocation = resolveFeedLocationForDisplay(row);

        return (
            <ExpandedRowShell>
                <div className="flex items-center gap-3">
                    <FeedLocationLink
                        disableTooltip
                        groupName={row.previousGroupName}
                        loadingHistoryKey={loadingHistoryKey}
                        location={row.previousLocation}
                        onNewInstance={onNewInstance}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        worldName={row.previousWorldName}
                        wrapperClassName="min-w-0"
                    />
                    <span className="flex shrink-0 flex-col items-center gap-1">
                        {row.time ? (
                            <span className="text-muted-foreground text-xs">
                                {timeToText(row.time)}
                            </span>
                        ) : null}
                        <ArrowRightIcon className="text-muted-foreground size-4" />
                    </span>
                    <FeedLocationLink
                        disableTooltip
                        groupName={row.groupName}
                        loadingHistoryKey={loadingHistoryKey}
                        location={displayLocation}
                        onNewInstance={onNewInstance}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        worldName={row.worldName}
                        wrapperClassName="min-w-0"
                    />
                </div>
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
                            {String(row.previousStatusDescription || '')}
                        </span>
                    </span>
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="inline-flex items-center gap-1.5">
                        <FeedStatusBadge status={row.status} />
                        <span className="bg-primary/10 text-primary rounded px-0.5">
                            {String(row.statusDescription || '')}
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
                            imageUrl={String(previousImage)}
                            label={previousAvatarLabel}
                            onOpenPreview={() =>
                                openImagePreview({
                                    url: String(
                                        row.previousCurrentAvatarImageUrl ||
                                            previousImage
                                    ),
                                    title:
                                        String(row.previousAvatarName || '') ||
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
                            imageAlt={
                                String(row.avatarName || '') ||
                                currentAvatarLabel
                            }
                            imageUrl={String(currentImage)}
                            label={currentAvatarLabel}
                            onOpenPreview={() =>
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
                        __html: formatDifferenceHtml(row.previousBio, row.bio)
                    }}
                />
            </ExpandedRowShell>
        );
    }

    return null;
}

export { FeedExpandedRow };
