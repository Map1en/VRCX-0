import { ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useScreenshotThumbnailUrl } from '@/components/media/useScreenshotThumbnailUrl';
import { TileShell } from '@/components/tile/TileShell';
import type { ScreenshotFacet } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { EmptyState } from './ScreenshotMetadataParts';

function ScreenshotAlbumCard({
    facet,
    onOpen
}: {
    facet: ScreenshotFacet;
    onOpen: (facet: ScreenshotFacet) => void;
}) {
    const { t } = useTranslation();
    const { thumbnailUrl, loadState } = useScreenshotThumbnailUrl(
        facet.coverPath
    );
    const name = facet.name || facet.id;

    return (
        <TileShell
            className="h-auto w-full min-w-0 flex-col items-stretch justify-start p-0 text-left"
            render={
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpen(facet)}
                />
            }
        >
            <div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden">
                {thumbnailUrl ? (
                    <img
                        src={thumbnailUrl}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="size-full object-cover"
                    />
                ) : loadState === 'loading' ? (
                    <Skeleton className="size-full rounded-none" />
                ) : (
                    <ImageIcon className="text-muted-foreground" />
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 p-2">
                <div className="truncate text-sm font-medium" title={name}>
                    {name}
                </div>
                <div className="text-muted-foreground text-xs tabular-nums">
                    {t('dialog.screenshot_metadata.image_count', {
                        count: facet.count
                    })}
                </div>
            </div>
        </TileShell>
    );
}

export function ScreenshotAlbumGrid({
    facets,
    onOpen
}: {
    facets: readonly ScreenshotFacet[];
    onOpen: (facet: ScreenshotFacet) => void;
}) {
    const { t } = useTranslation();

    if (!facets.length) {
        return (
            <EmptyState
                title={t('dialog.screenshot_metadata.empty_albums')}
                description={t(
                    'dialog.screenshot_metadata.empty_albums_description'
                )}
            />
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-auto p-0.5 pr-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {facets.map((facet) => (
                    <ScreenshotAlbumCard
                        key={facet.id}
                        facet={facet}
                        onOpen={onOpen}
                    />
                ))}
            </div>
        </div>
    );
}
