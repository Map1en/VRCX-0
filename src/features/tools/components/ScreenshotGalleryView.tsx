import { ChevronRightIcon, FolderIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { useScreenshotGalleryGrid } from '../useScreenshotGalleryGrid';
import { EmptyState } from './ScreenshotMetadataParts';
import {
    ScreenshotThumbnailCard,
    useScreenshotThumbnailTitleMap
} from './ScreenshotThumbnailGrid';

function buildFolderTree(folderTree: any) {
    const folders = Array.isArray(folderTree?.folders)
        ? folderTree.folders
        : [];
    const rootPath = folderTree?.rootPath || folders[0]?.path || '';
    const nodesByPath = new Map();

    for (const folder of folders) {
        nodesByPath.set(folder.path, {
            ...folder,
            children: []
        });
    }

    if (rootPath && !nodesByPath.has(rootPath)) {
        nodesByPath.set(rootPath, {
            path: rootPath,
            parentPath: null,
            name: rootPath,
            imageCount: 0,
            totalImageCount: 0,
            latestModifiedAt: null,
            children: []
        });
    }

    const root = nodesByPath.get(rootPath) || null;
    for (const node of nodesByPath.values()) {
        if (!node.parentPath || node.path === rootPath) {
            continue;
        }
        const parent = nodesByPath.get(node.parentPath);
        if (parent) {
            parent.children.push(node);
        }
    }

    for (const node of nodesByPath.values()) {
        node.children.sort((left: any, right: any) =>
            String(left.name || '').localeCompare(String(right.name || ''))
        );
    }

    return root;
}

function folderContainsSelected(node: any, selectedFolder: any) {
    if (!node || !selectedFolder) {
        return false;
    }
    if (node.path === selectedFolder) {
        return true;
    }
    return node.children?.some((child: any) =>
        folderContainsSelected(child, selectedFolder)
    );
}

function FolderTreeNode({ node, selectedFolder, onSelectFolder }: any) {
    const containsSelected = folderContainsSelected(node, selectedFolder);
    const [open, setOpen] = useState(() => containsSelected);
    const selected = node.path === selectedFolder;
    const hasChildren = Boolean(node.children?.length);

    useEffect(() => {
        if (containsSelected) {
            setOpen(true);
        }
    }, [containsSelected]);

    const row = (
        <Button
            type="button"
            variant={selected ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-2"
            onClick={() => onSelectFolder(node.path)}
        >
            <FolderIcon data-icon="inline-start" />
            <span className="truncate text-left">{node.name}</span>
            <Badge variant="outline" className="ml-auto tabular-nums">
                {node.imageCount}
            </Badge>
        </Button>
    );

    if (!hasChildren) {
        return <div className="flex min-w-0">{row}</div>;
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <div className="flex min-w-0 items-center gap-1">
                <CollapsibleTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={node.name}
                    >
                        <ChevronRightIcon
                            data-icon="inline-start"
                            className={cn(
                                'transition-transform',
                                open && 'rotate-90'
                            )}
                        />
                    </Button>
                </CollapsibleTrigger>
                {row}
            </div>
            <CollapsibleContent>
                <div className="ml-5 flex flex-col gap-1 py-1">
                    {node.children.map((child: any) => (
                        <FolderTreeNode
                            key={child.path}
                            node={child}
                            selectedFolder={selectedFolder}
                            onSelectFolder={onSelectFolder}
                        />
                    ))}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function ScreenshotGalleryGrid({
    error,
    initialScrollTop,
    images,
    isLoading,
    selectedFolder,
    onOpen,
    onScrollPositionChange
}: any) {
    const { t } = useTranslation();
    const {
        gridColumnCount,
        gridGap,
        gridMinWidth,
        totalHeight,
        viewportRef,
        visibleRows
    } = useScreenshotGalleryGrid({
        initialScrollTop,
        items: images,
        resetKey: selectedFolder
    });
    const visibleItems = useMemo(
        () => visibleRows.flatMap((row: any) => row.items),
        [visibleRows]
    );
    const titleMap = useScreenshotThumbnailTitleMap(visibleItems);

    if (error) {
        return (
            <EmptyState
                title={t('dialog.screenshot_metadata.gallery_load_failed')}
                description={error}
            />
        );
    }

    if (isLoading) {
        return (
            <EmptyState
                loading
                title={t('dialog.screenshot_metadata.loading_gallery')}
                description={t(
                    'dialog.screenshot_metadata.loading_gallery_description'
                )}
            />
        );
    }

    if (!images.length) {
        return (
            <EmptyState
                title={t('dialog.screenshot_metadata.empty_gallery')}
                description={t(
                    'dialog.screenshot_metadata.empty_gallery_description'
                )}
            />
        );
    }

    return (
        <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-auto pr-1"
            onScroll={(event: any) => {
                if (selectedFolder) {
                    onScrollPositionChange?.(
                        selectedFolder,
                        event.currentTarget.scrollTop
                    );
                }
            }}
        >
            <div className="relative" style={{ height: totalHeight }}>
                {visibleRows.map((row: any) => (
                    <div
                        key={row.key}
                        className="absolute right-0 left-0 grid"
                        style={{
                            top: row.top,
                            gridTemplateColumns: `repeat(${gridColumnCount}, minmax(${gridMinWidth}px, 1fr))`,
                            gap: gridGap
                        }}
                    >
                        {row.items.map((item: any) => (
                            <ScreenshotThumbnailCard
                                key={item.path}
                                item={item}
                                onOpen={onOpen}
                                title={titleMap.get(item.path)}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ScreenshotGalleryView({
    folderTree,
    images,
    isImagesLoading,
    isTreeLoading,
    error,
    scanStatus,
    selectedFolder,
    onOpenImage,
    onRefresh,
    onSelectFolder,
    onScrollPositionChange,
    restoreScrollTop
}: any) {
    const { t } = useTranslation();
    const root = useMemo(() => buildFolderTree(folderTree), [folderTree]);

    return (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(160px,240px)_minmax(0,1fr)] gap-4 overflow-hidden lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] lg:grid-rows-none xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
            <aside className="bg-card flex min-h-0 flex-col rounded-md border">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="min-w-0">
                        <div className="text-sm font-medium">
                            {t('dialog.screenshot_metadata.folders')}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                            {error
                                ? t(
                                      'dialog.screenshot_metadata.gallery_load_failed'
                                  )
                                : scanStatus?.running
                                  ? t('dialog.screenshot_metadata.scanning')
                                  : t('dialog.screenshot_metadata.gallery')}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('common.actions.refresh')}
                        onClick={onRefresh}
                    >
                        <RefreshCwIcon
                            data-icon="inline-start"
                            className={cn(
                                scanStatus?.running && 'animate-spin'
                            )}
                        />
                    </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2">
                    {isTreeLoading ? (
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-10/12" />
                            <Skeleton className="h-8 w-8/12" />
                        </div>
                    ) : root ? (
                        <FolderTreeNode
                            node={root}
                            selectedFolder={selectedFolder}
                            onSelectFolder={onSelectFolder}
                        />
                    ) : (
                        <EmptyState
                            title={t(
                                'dialog.screenshot_metadata.empty_folders'
                            )}
                            description={t(
                                'dialog.screenshot_metadata.empty_folders_description'
                            )}
                        />
                    )}
                </div>
            </aside>
            <section className="flex min-h-0 min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-sm font-medium">
                            {t('dialog.screenshot_metadata.gallery')}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                            {selectedFolder || folderTree?.rootPath || '—'}
                        </div>
                    </div>
                    <Badge variant="outline">
                        {t('dialog.screenshot_metadata.image_count', {
                            count: images.length
                        })}
                    </Badge>
                </div>
                <ScreenshotGalleryGrid
                    error={error}
                    initialScrollTop={restoreScrollTop}
                    images={images}
                    isLoading={isImagesLoading}
                    selectedFolder={selectedFolder}
                    onOpen={onOpenImage}
                    onScrollPositionChange={onScrollPositionChange}
                />
            </section>
        </div>
    );
}
