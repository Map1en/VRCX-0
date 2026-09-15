import {
    CalendarRangeIcon,
    ChevronRightIcon,
    DicesIcon,
    FolderIcon,
    RefreshCwIcon
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefaultLayout } from 'react-resizable-panels';

import { ToolbarViewMenu } from '@/components/layout/ToolbarControls';
import { WorkspaceResizeHandle } from '@/components/layout/WorkspaceResizeHandle';
import {
    readScreenshotGridDensity,
    readScreenshotGridSort,
    sanitizeScreenshotGridDensity,
    sanitizeScreenshotGridSort,
    SCREENSHOT_GRID_DENSITY_OPTIONS,
    SCREENSHOT_GRID_SORT_OPTIONS,
    sortScreenshotGridImages,
    writeScreenshotGridDensity,
    writeScreenshotGridSort,
    type ScreenshotGridDensity,
    type ScreenshotGridSort
} from '@/components/media/screenshotGridPreferences';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { ResizablePanel, ResizablePanelGroup } from '@/ui/shadcn/resizable';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

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
    synthetic?: boolean;
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
        node.children = groupChildrenByYear(node);
    }

    return root;
}

const SCREENSHOT_GALLERY_LAYOUT_ID = 'screenshot-gallery-layout';
const SCREENSHOT_GALLERY_FOLDER_PANEL_ID = 'screenshot-gallery-folders';
const SCREENSHOT_GALLERY_CONTENT_PANEL_ID = 'screenshot-gallery-content';
const SCREENSHOT_GALLERY_PANEL_IDS = [
    SCREENSHOT_GALLERY_FOLDER_PANEL_ID,
    SCREENSHOT_GALLERY_CONTENT_PANEL_ID
];

const MONTH_FOLDER_PATTERN = /^(\d{4})-(\d{2})$/;

function groupChildrenByYear(
    parent: FolderTreeNodeModel
): FolderTreeNodeModel[] {
    const monthsByYear = new Map<string, FolderTreeNodeModel[]>();
    const passthrough: FolderTreeNodeModel[] = [];

    for (const child of parent.children) {
        const match = String(child.name || '').match(MONTH_FOLDER_PATTERN);
        if (!match || child.children.length) {
            passthrough.push(child);
            continue;
        }
        const year = match[1];
        const bucket = monthsByYear.get(year);
        if (bucket) {
            bucket.push(child);
        } else {
            monthsByYear.set(year, [child]);
        }
    }

    const groups: FolderTreeNodeModel[] = [];
    for (const [year, months] of monthsByYear) {
        if (months.length < 2) {
            passthrough.push(...months);
            continue;
        }
        months.sort((left, right) =>
            String(right.name || '').localeCompare(String(left.name || ''))
        );
        groups.push({
            path: `${parent.path}::year:${year}`,
            parentPath: parent.path,
            name: year,
            imageCount: months.reduce(
                (total, month) => total + month.imageCount,
                0
            ),
            totalImageCount: months.reduce(
                (total, month) => total + month.totalImageCount,
                0
            ),
            latestModifiedAt: null,
            synthetic: true,
            children: months
        });
    }

    if (!groups.length) {
        return parent.children;
    }

    groups.sort((left, right) =>
        String(right.name || '').localeCompare(String(left.name || ''))
    );
    passthrough.sort((left, right) =>
        String(left.name || '').localeCompare(String(right.name || ''))
    );
    return [...groups, ...passthrough];
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
    const { t } = useTranslation();
    const containsSelected = folderContainsSelected(node, selectedFolder);
    const [open, setOpen] = useState(() => containsSelected);
    const selected = !node.synthetic && node.path === selectedFolder;
    const hasChildren = Boolean(node.children?.length);
    const selectedRowRef = useRef<HTMLButtonElement | null>(null);
    const label = node.synthetic
        ? t('dialog.screenshot_metadata.year_group', { year: node.name })
        : node.name;

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
            onClick={
                node.synthetic
                    ? () => setOpen((current) => !current)
                    : () => onSelectFolder(node.path)
            }
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
            {node.synthetic ? (
                <CalendarRangeIcon
                    data-icon="inline-start"
                    className="text-muted-foreground"
                />
            ) : (
                <FolderIcon data-icon="inline-start" />
            )}
            <span
                className={cn(
                    'truncate text-left',
                    node.synthetic && 'text-muted-foreground'
                )}
                title={label}
            >
                {label}
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
    density,
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
    density: ScreenshotGridDensity;
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
            density={density}
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

function ScreenshotGridOptionField<TValue extends string>({
    label,
    options,
    value,
    onValueChange
}: {
    label: string;
    options: ReadonlyArray<{ value: TValue; labelKey: string }>;
    value: TValue;
    onValueChange: (next: string) => void;
}) {
    const { t } = useTranslation();

    return (
        <Field>
            <FieldLabel>{label}</FieldLabel>
            <ToggleGroup
                variant="outline"
                size="sm"
                value={[value]}
                onValueChange={(nextValue) => {
                    const next = nextValue[0];
                    if (next) {
                        onValueChange(next);
                    }
                }}
                className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
            >
                {options.map((option, index) => (
                    <Fragment key={option.value}>
                        {index > 0 ? <ToggleGroupSeparator /> : null}
                        <ToggleGroupItem
                            value={option.value}
                            aria-label={t(option.labelKey)}
                            className="w-full min-w-0 justify-center px-2"
                        >
                            <span className="truncate">
                                {t(option.labelKey)}
                            </span>
                        </ToggleGroupItem>
                    </Fragment>
                ))}
            </ToggleGroup>
        </Field>
    );
}

function ScreenshotGridSettingsMenu({
    density,
    sort,
    onDensityChange,
    onSortChange
}: {
    density: ScreenshotGridDensity;
    sort: ScreenshotGridSort;
    onDensityChange: (value: ScreenshotGridDensity) => void;
    onSortChange: (value: ScreenshotGridSort) => void;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarViewMenu contentClassName="p-3">
            <FieldGroup>
                <ScreenshotGridOptionField
                    label={t('dialog.screenshot_metadata.grid_density')}
                    options={SCREENSHOT_GRID_DENSITY_OPTIONS}
                    value={density}
                    onValueChange={(next) =>
                        onDensityChange(sanitizeScreenshotGridDensity(next))
                    }
                />
                <ScreenshotGridOptionField
                    label={t('dialog.screenshot_metadata.sort')}
                    options={SCREENSHOT_GRID_SORT_OPTIONS}
                    value={sort}
                    onValueChange={(next) =>
                        onSortChange(sanitizeScreenshotGridSort(next))
                    }
                />
            </FieldGroup>
        </ToolbarViewMenu>
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
    const layout = useDefaultLayout({
        id: SCREENSHOT_GALLERY_LAYOUT_ID,
        panelIds: SCREENSHOT_GALLERY_PANEL_IDS
    });
    const [density, setDensity] = useState(readScreenshotGridDensity);
    const [sort, setSort] = useState(readScreenshotGridSort);
    const sortedImages = useMemo(
        () => sortScreenshotGridImages(images, sort),
        [images, sort]
    );
    const root = useMemo(() => buildFolderTree(folderTree), [folderTree]);
    const activeFolder =
        folderTree?.folders.find((folder) => folder.path === selectedFolder) ||
        root;
    const activeFolderPath =
        selectedFolder || activeFolder?.path || folderTree?.rootPath || '';
    useClearSelectionOnEscape(selection.hasSelection, selection.clearSelection);

    function onDensityChange(next: ScreenshotGridDensity) {
        setDensity(next);
        writeScreenshotGridDensity(next);
    }

    function onSortChange(next: ScreenshotGridSort) {
        setSort(next);
        writeScreenshotGridSort(next);
    }

    return (
        <ResizablePanelGroup
            id={SCREENSHOT_GALLERY_LAYOUT_ID}
            orientation="horizontal"
            className="min-h-0 flex-1 overflow-hidden"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
        >
            <ResizablePanel
                id={SCREENSHOT_GALLERY_FOLDER_PANEL_ID}
                defaultSize="22"
                minSize="14"
                maxSize="40"
                className="flex min-h-0 min-w-0 flex-col overflow-hidden pr-3"
            >
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
            </ResizablePanel>
            <WorkspaceResizeHandle />
            <ResizablePanel
                id={SCREENSHOT_GALLERY_CONTENT_PANEL_ID}
                minSize="40"
                className="relative flex min-h-0 min-w-0 flex-col gap-3 pl-3"
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Tooltip disabled={!activeFolderPath}>
                        <TooltipTrigger render={<div className="min-w-0" />}>
                            <div className="truncate text-sm font-medium">
                                {activeFolder?.name ||
                                    t('dialog.screenshot_metadata.gallery')}
                            </div>
                            <div className="text-muted-foreground truncate text-xs">
                                {activeFolderPath || '—'}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>{activeFolderPath}</TooltipContent>
                    </Tooltip>
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
                        <ScreenshotGridSettingsMenu
                            density={density}
                            sort={sort}
                            onDensityChange={onDensityChange}
                            onSortChange={onSortChange}
                        />
                    </div>
                </div>
                <ScreenshotGalleryGrid
                    density={density}
                    error={error}
                    initialScrollTop={restoreScrollTop}
                    images={sortedImages}
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
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}
