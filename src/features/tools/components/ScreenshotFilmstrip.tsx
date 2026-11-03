import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useScreenshotThumbnailUrl } from '@/components/media/useScreenshotThumbnailUrl';
import { cn } from '@/lib/utils';
import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';
import { Skeleton } from '@/ui/shadcn/skeleton';

const FILMSTRIP_CHUNK_SIZE = 40;

export function resolveFilmstripWindow(index: number, total: number) {
    const chunkStart =
        Math.floor(Math.max(0, index) / FILMSTRIP_CHUNK_SIZE) *
        FILMSTRIP_CHUNK_SIZE;
    return {
        start: Math.max(0, chunkStart - FILMSTRIP_CHUNK_SIZE),
        end: Math.min(total, chunkStart + FILMSTRIP_CHUNK_SIZE * 2)
    };
}

function FilmstripThumbnail({
    image,
    current,
    onSelect
}: {
    image: ScreenshotLibraryImage;
    current: boolean;
    onSelect: (path: string) => void;
}) {
    const { thumbnailUrl } = useScreenshotThumbnailUrl(
        image.path,
        `${image.modifiedAt}:${image.sizeBytes}`
    );

    return (
        <button
            type="button"
            data-path={image.path}
            aria-current={current ? 'true' : undefined}
            aria-label={image.worldName || image.fileName}
            title={image.worldName || image.fileName}
            className={cn(
                'bg-muted relative aspect-video h-14 shrink-0 overflow-hidden rounded-md border-2 transition-opacity outline-none focus-visible:opacity-100',
                current
                    ? 'border-foreground/80 opacity-100'
                    : 'border-transparent opacity-50 hover:opacity-90'
            )}
            onClick={() => onSelect(image.path)}
        >
            {thumbnailUrl ? (
                <img
                    src={thumbnailUrl}
                    alt=""
                    draggable={false}
                    className="size-full object-cover"
                />
            ) : (
                <Skeleton className="size-full rounded-none" />
            )}
        </button>
    );
}

export function ScreenshotFilmstrip({
    images,
    currentPath,
    onSelect
}: {
    images: readonly ScreenshotLibraryImage[];
    currentPath: string;
    onSelect: (path: string) => void;
}) {
    const { t } = useTranslation();
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const index = images.findIndex((image) => image.path === currentPath);
    const { start, end } = resolveFilmstripWindow(index, images.length);
    const visibleImages = images.slice(start, end);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || !currentPath) {
            return;
        }
        const currentThumbnail = Array.from(
            viewport.querySelectorAll<HTMLElement>('[data-path]')
        ).find((element) => element.dataset.path === currentPath);
        currentThumbnail?.scrollIntoView?.({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });
    }, [currentPath, start]);

    if (images.length < 2 || index === -1) {
        return null;
    }

    return (
        <div
            ref={viewportRef}
            role="toolbar"
            aria-label={t('dialog.screenshot_metadata.filmstrip')}
            className="flex shrink-0 [scrollbar-width:none] gap-1.5 overflow-x-auto overflow-y-hidden px-3 py-2"
            onWheel={(event) => {
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                    event.currentTarget.scrollLeft += event.deltaY;
                }
            }}
        >
            {visibleImages.map((image) => (
                <FilmstripThumbnail
                    key={image.path}
                    image={image}
                    current={image.path === currentPath}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}
