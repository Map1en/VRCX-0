import {
    ChevronRightIcon,
    DicesIcon,
    FolderIcon,
    RefreshCwIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type {
    ScreenshotFolderInfo,
    ScreenshotFolderTree,
    ScreenshotLibraryImage,
    ScreenshotLibraryScanStatus
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { pickRandomScreenshotPath } from '../screenshotMetadataValues';
import { useClearSelectionOnEscape } from '../useClearSelectionOnEscape';
import type { useScreenshotBrowseSelection } from '../useScreenshotBrowseSelection';
import { GallerySelectionBar } from './GallerySelectionBar';
import { EmptyState } from './ScreenshotMetadataParts';
import { ScreenshotSelectableImageGrid } from './ScreenshotSelectableImageGrid';

type ScreenshotBrowseSelection = ReturnType<
    typeof useScreenshotBrowseSelection
>;

type FolderTreeNodeModel = ScreenshotFolderInfo & {
    children: FolderTreeNodeModel[];
};

function buildFolderTree(folderTree: ScreenshotFolderTree | null) {
    const folders = folderTree?.folders ?? [];
    const rootPath = folderTree?.rootPath || folders[0]?.path || '';
    const nodesByPath = new Map<string, FolderTreeNodeModel>();

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
        node.children.sort((left, right) =>
            String(left.name || '').localeCompare(String(right.name || ''))
        );
    }

    return root;
}

function folderContainsSelected(
    node: FolderTreeNodeModel | null,
    selectedFolder: string
): boolean {
    if (!node || !selectedFolder) {
        return false;
    }
    if (node.path === selectedFolder) {
        return true;
    }
    return node.children.some((child) =>
        folderContainsSelected(child, selectedFolder)
    );
}

function FolderTreeNode({
    node,
    selectedFolder,
    onSelectFolder
}: {
    node: FolderTreeNodeModel;
    selectedFolder: string;
    onSelectFolder: (folder: string) => void;
}) {
    const containsSelected = folderContainsSelected(node, selectedFolder);
    const [open, setOpen] = useState(() => containsSelected);
    const selected = node.path === selectedFolder;
    const hasChildren = Boolean(node.children?.length);
    const selectedRowRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (containsSelected) {
            setOpen(true);
        }
    }, [containsSelected]);

    useEffect(() => {
        if (selected) {
            selectedRowRef.current?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest'
            });
        }
    }, [selected]);

    const row = (
        <Button
            ref={selected ? selectedRowRef : undefined}
            type="button"
            variant={selected ? 'secondary' : 'ghost'}
            size="sm"
            className="w-full min-w-0 justify-start transition-none"
            aria-current={selected ? 'location' : undefined}
            onClick={() => onSelectFolder(node.path)}
        >
            {hasChildren ? (
                <ChevronRightIcon
                    data-icon="inline-start"
                    className={cn(
                        'transition-transform motion-reduce:transition-none',
                        open && 'rotate-90'
                    )}
                />
            ) : (
                <span aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <FolderIcon data-icon="inline-start" />
            <span className="truncate text-left" title={node.name}>
                {node.name}
            </span>
            {node.imageCount > 0 && (
                <span
                    aria-hidden="true"
                    className="text-muted-foreground ml-auto min-w-5 text-right text-xs tabular-nums"
                >
                    {node.imageCount}
                </span>
            )}
        </Button>
    );

    if (!hasChildren) {
        return row;
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger render={row} />
            <CollapsibleContent>
                <div className="mt-1 ml-5 flex flex-col gap-1">
                    {node.children.map((child) => (
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
    hasSelection,
    selectedKeysSet,
    onOpen,
    onToggleSelect,
    onScrollPositionChange
}: {
    error: string;
    initialScrollTop: number;
    images: ScreenshotLibraryImage[];
    isLoading: boolean;
    selectedFolder: string;
    hasSelection: boolean;
    selectedKeysSet: ReadonlySet<string>;
    onOpen: (path: string) => void;
    onToggleSelect: (path: string, checked: boolean, shift: boolean) => void;
    onScrollPositionChange: (folder: string, scrollTop: number) => void;
}) {
    const { t } = useTranslation();

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
        <ScreenshotSelectableImageGrid
            images={images}
            initialScrollTop={initialScrollTop}
            resetKey={selectedFolder}
            hasSelection={hasSelection}
            selectedKeysSet={selectedKeysSet}
            onOpen={onOpen}
            onToggleSelect={onToggleSelect}
            onScrollPositionChange={(scrollTop) => {
                if (selectedFolder) {
                    onScrollPositionChange(selectedFolder, scrollTop);
                }
            }}
        />
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
    onDeleteSelection,
    onScrollPositionChange,
    isDeleteRunning,
    restoreScrollTop,
    selection,
    onExportSelection
}: {
    folderTree: ScreenshotFolderTree | null;
    images: ScreenshotLibraryImage[];
    isImagesLoading: boolean;
    isTreeLoading: boolean;
    error: string;
    scanStatus: ScreenshotLibraryScanStatus | null;
    selectedFolder: string;
    onOpenImage: (path: string) => void;
    onRefresh: () => void;
    onSelectFolder: (folder: string) => void;
    onDeleteSelection: (paths: string[]) => void;
    onScrollPositionChange: (folder: string, scrollTop: number) => void;
    isDeleteRunning: boolean;
    restoreScrollTop: number;
    selection: ScreenshotBrowseSelection;
    onExportSelection: (paths: string[], groupByFolder: boolean) => void;
}) {
    const { t } = useTranslation();
    const root = useMemo(() => buildFolderTree(folderTree), [folderTree]);
    const activeFolder =
        folderTree?.folders.find((folder) => folder.path === selectedFolder) ||
        root;
    const activeFolderPath =
        selectedFolder || activeFolder?.path || folderTree?.rootPath || '';
    useClearSelectionOnEscape(selection.hasSelection, selection.clearSelection);

    return (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(160px,240px)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] lg:grid-rows-none xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
            <aside className="border-border flex min-h-0 min-w-0 flex-col overflow-hidden border-b pb-3 lg:border-r lg:border-b-0 lg:pr-3 lg:pb-0">
                <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
                    <div className="text-sm font-medium">
                        {t('dialog.screenshot_metadata.folders')}
                    </div>
                    {scanStatus?.running ? (
                        <div className="text-muted-foreground truncate text-xs">
                            {t('dialog.screenshot_metadata.scanning')}
                        </div>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
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
                <nav
                    aria-label={t('dialog.screenshot_metadata.folders')}
                    className="min-h-0 flex-1 overflow-auto pr-1"
                >
                    {isTreeLoading ? (
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-7 w-full" />
                            <Skeleton className="h-7 w-10/12" />
                            <Skeleton className="h-7 w-8/12" />
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
                </nav>
            </aside>
            <section className="relative flex min-h-0 min-w-0 flex-col gap-3 pt-3 lg:pt-0 lg:pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div
                            className="truncate text-sm font-medium"
                            title={activeFolderPath}
                        >
                            {activeFolder?.name ||
                                t('dialog.screenshot_metadata.gallery')}
                        </div>
                        <div
                            className="text-muted-foreground truncate text-xs"
                            title={activeFolderPath}
                        >
                            {activeFolderPath || '—'}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs tabular-nums">
                            {t('dialog.screenshot_metadata.image_count', {
                                count: images.length
                            })}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={images.length === 0}
                            onClick={() =>
                                onOpenImage(
                                    pickRandomScreenshotPath(
                                        images,
                                        Math.random()
                                    )
                                )
                            }
                        >
                            <DicesIcon data-icon="inline-start" />
                            {t('dialog.screenshot_metadata.feeling_lucky')}
                        </Button>
                    </div>
                </div>
                <ScreenshotGalleryGrid
                    error={error}
                    initialScrollTop={restoreScrollTop}
                    images={images}
                    isLoading={isImagesLoading}
                    selectedFolder={selectedFolder}
                    hasSelection={selection.hasSelection}
                    selectedKeysSet={selection.selectedKeysSet}
                    onOpen={onOpenImage}
                    onToggleSelect={(path, checked, shift) =>
                        selection.selectItem(path, checked, { shift })
                    }
                    onScrollPositionChange={onScrollPositionChange}
                />
                <GallerySelectionBar
                    selectedCount={selection.selectedPaths.length}
                    deletableCount={selection.selectedPaths.length}
                    isAllSelected={selection.isAllSelected}
                    actionsDisabled={isDeleteRunning}
                    onSelectAll={selection.toggleSelectAll}
                    onClearSelection={selection.clearSelection}
                    onDelete={() => onDeleteSelection(selection.selectedPaths)}
                    exportAction={{
                        onExport: (groupByFolder) =>
                            onExportSelection(
                                selection.selectedPaths,
                                groupByFolder
                            )
                    }}
                />
            </section>
        </div>
    );
}
