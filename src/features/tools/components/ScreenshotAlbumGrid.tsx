import { ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useScreenshotThumbnailUrl } from '@/components/media/useScreenshotThumbnailUrl';
import { TileShell } from '@/components/tile/TileShell';
import type { ScreenshotFacet } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
    useVirtualTileGrid,
    type TileGridSection
} from '../useVirtualTileGrid';
import { EmptyState } from './ScreenshotMetadataParts';
import { VirtualTileGridRows } from './VirtualTileGridRows';

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

const ALBUM_TILE_MIN_WIDTH = 180;
const ALBUM_TILE_GAP = 12;
const ALBUM_COVER_ASPECT_RATIO = 16 / 9;
const ALBUM_CAPTION_HEIGHT = 60;

function getFacetKey(facet: ScreenshotFacet) {
    return facet.id;
}

export function ScreenshotAlbumGrid({
    sections,
    resetKey,
    onOpen
}: {
    sections: readonly TileGridSection<ScreenshotFacet>[];
    resetKey: string;
    onOpen: (facet: ScreenshotFacet) => void;
}) {
    const { t } = useTranslation();
    const tileGrid = useVirtualTileGrid({
        sections,
        minTileWidth: ALBUM_TILE_MIN_WIDTH,
        gap: ALBUM_TILE_GAP,
        aspectRatio: ALBUM_COVER_ASPECT_RATIO,
        extraHeight: ALBUM_CAPTION_HEIGHT,
        resetKey
    });

    if (!sections.some((section) => section.items.length)) {
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
        <div
            ref={tileGrid.viewportRef}
            className="min-h-0 flex-1 overflow-auto pr-1"
        >
            <VirtualTileGridRows
                columnCount={tileGrid.columnCount}
                gap={ALBUM_TILE_GAP}
                getKey={getFacetKey}
                totalHeight={tileGrid.totalHeight}
                visibleRows={tileGrid.visibleRows}
                renderItem={(facet) => (
                    <ScreenshotAlbumCard facet={facet} onOpen={onOpen} />
                )}
            />
        </div>
    );
}
