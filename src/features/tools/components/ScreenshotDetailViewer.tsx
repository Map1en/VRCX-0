import {
    ArrowLeftIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CopyIcon,
    EllipsisIcon,
    FolderOpenIcon,
    ImageIcon,
    MaximizeIcon,
    PanelRightCloseIcon,
    PanelRightOpenIcon,
    StarIcon,
    Trash2Icon,
    UploadIcon,
    type LucideIcon
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { useFullscreenImageTransform } from '@/components/media/useFullscreenImageTransform';
import { useProgressiveImageSource } from '@/components/media/useProgressiveImageSource';
import { cn } from '@/lib/utils';
import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { NormalizedScreenshotMetadata } from '../screenshotMetadataValues';
import { ScreenshotFilmstrip } from './ScreenshotFilmstrip';
import { ScreenshotMetadataDetailsCard } from './ScreenshotMetadataDetailsCard';
import { EmptyState } from './ScreenshotMetadataParts';

function ToolbarIconButton({
    label,
    shortcut,
    icon: Icon,
    iconClassName,
    ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
    label: string;
    shortcut?: string | string[];
    icon: LucideIcon;
    iconClassName?: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={label}
                        {...props}
                    >
                        <Icon
                            data-icon="inline-start"
                            className={iconClassName}
                        />
                    </Button>
                }
            />
            <TooltipContent className="flex items-center gap-2">
                {label}
                {shortcut ? <KeyboardShortcut keys={shortcut} /> : null}
            </TooltipContent>
        </Tooltip>
    );
}

function ScreenshotDetailStage({
    imageUrl,
    placeholderUrl,
    alt,
    isMetadataLoading,
    canNavigatePrev,
    canNavigateNext,
    onNavigatePrev,
    onNavigateNext
}: {
    imageUrl: string;
    placeholderUrl: string;
    alt: string;
    isMetadataLoading: boolean;
    canNavigatePrev: boolean;
    canNavigateNext: boolean;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
}) {
    const { t } = useTranslation();
    const { isInterim, shownSrc, status } = useProgressiveImageSource(
        imageUrl,
        placeholderUrl
    );
    const {
        viewerRef,
        scale,
        transformStyle,
        handleDoubleClick,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handleWheel,
        resetTransform
    } = useFullscreenImageTransform({ open: true, url: imageUrl });

    let content: ReactNode;
    if (shownSrc) {
        content = (
            <img
                src={shownSrc}
                alt={alt}
                draggable={false}
                className={cn(
                    'max-h-full max-w-full cursor-grab touch-none object-contain select-none active:cursor-grabbing',
                    isInterim && 'size-full'
                )}
                style={transformStyle}
                onDoubleClick={handleDoubleClick}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            />
        );
    } else if (isMetadataLoading || status === 'loading') {
        content = (
            <EmptyState
                loading
                title={t('view.tools.loading.loading_screenshot')}
                description={t(
                    'view.tools.loading.fetching_embedded_metadata_and_file_details'
                )}
            />
        );
    } else if (status === 'error') {
        content = <EmptyState title={t('message.image.load_failed')} />;
    } else {
        content = (
            <EmptyState
                title={t('dialog.screenshot_metadata.drag')}
                description={t(
                    'view.tools.description.browse_for_a_screenshot_load_the_latest_screenshot_or_run_a_metadata_search'
                )}
            />
        );
    }

    return (
        <div
            ref={viewerRef}
            className="group/stage relative min-h-0 flex-1 overflow-hidden"
            onWheel={shownSrc ? handleWheel : undefined}
        >
            <div className="absolute inset-0 flex items-center justify-center p-3">
                {content}
            </div>
            {[
                {
                    side: 'prev',
                    label: t('message.image.previous'),
                    disabled: !canNavigatePrev,
                    onClick: onNavigatePrev,
                    icon: ChevronLeftIcon
                },
                {
                    side: 'next',
                    label: t('message.image.next'),
                    disabled: !canNavigateNext,
                    onClick: onNavigateNext,
                    icon: ChevronRightIcon
                }
            ].map(({ side, label, disabled, onClick, icon: Icon }) => (
                <Button
                    key={side}
                    type="button"
                    variant="secondary"
                    size="icon-lg"
                    aria-label={label}
                    disabled={disabled}
                    className={cn(
                        'bg-background/70 absolute top-1/2 -translate-y-1/2 rounded-full opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/stage:opacity-100 focus-visible:opacity-100 disabled:invisible',
                        side === 'prev' ? 'left-3' : 'right-3'
                    )}
                    onClick={onClick}
                >
                    <Icon />
                </Button>
            ))}
            {scale !== 1 ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="bg-background/70 absolute bottom-3 left-1/2 -translate-x-1/2 tabular-nums shadow-sm backdrop-blur"
                    onClick={resetTransform}
                >
                    {Math.round(scale * 100)}%
                </Button>
            ) : null}
        </div>
    );
}

export function ScreenshotDetailViewer({
    metadata,
    metadataError,
    imageUrl,
    placeholderUrl,
    isMetadataLoading,
    filmstripImages,
    positionLabel,
    canNavigatePrev,
    canNavigateNext,
    isDetailsVisible,
    isFavorite,
    isVrcPlusSupporter,
    isUploadingScreenshot,
    isDeletingMetadata,
    isDeletingFile,
    backLabel,
    onBack,
    onNavigatePrev,
    onNavigateNext,
    onSelectPath,
    onToggleDetails,
    onToggleFavorite,
    onCopyImage,
    onOpenPrint,
    onOpenFolder,
    onOpenFullscreen,
    onUpload,
    onDeleteMetadata,
    onDeleteFile
}: {
    metadata: NormalizedScreenshotMetadata | null;
    metadataError: string;
    imageUrl: string;
    placeholderUrl: string;
    isMetadataLoading: boolean;
    filmstripImages: readonly ScreenshotLibraryImage[];
    positionLabel: string;
    canNavigatePrev: boolean;
    canNavigateNext: boolean;
    isDetailsVisible: boolean;
    isFavorite: boolean;
    isVrcPlusSupporter: boolean;
    isUploadingScreenshot: boolean;
    isDeletingMetadata: boolean;
    isDeletingFile: boolean;
    backLabel: string;
    onBack: () => void;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
    onSelectPath: (path: string) => void;
    onToggleDetails: () => void;
    onToggleFavorite: () => void;
    onCopyImage: () => void;
    onOpenPrint: () => void;
    onOpenFolder: () => void;
    onOpenFullscreen: () => void;
    onUpload: () => void;
    onDeleteMetadata: () => void;
    onDeleteFile: () => void;
}) {
    const { t } = useTranslation();
    const hasFile = Boolean(metadata?.filePath);
    const favoriteLabel = t(
        isFavorite
            ? 'dialog.screenshot_metadata.unfavorite'
            : 'dialog.screenshot_metadata.favorite'
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeftIcon data-icon="inline-start" />
                    {backLabel}
                </Button>
                <Separator
                    orientation="vertical"
                    className="mx-1 h-5 data-vertical:self-center"
                />
                <div className="flex min-w-0 flex-1 items-baseline gap-2 px-1">
                    <span
                        className="truncate text-sm font-medium"
                        title={metadata?.filePath}
                    >
                        {metadata?.fileName || '—'}
                    </span>
                    {positionLabel ? (
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {positionLabel}
                        </span>
                    ) : null}
                </div>
                <ToolbarIconButton
                    label={t('message.image.previous')}
                    shortcut="ArrowLeft"
                    icon={ChevronLeftIcon}
                    disabled={!canNavigatePrev}
                    onClick={onNavigatePrev}
                />
                <ToolbarIconButton
                    label={t('message.image.next')}
                    shortcut="ArrowRight"
                    icon={ChevronRightIcon}
                    disabled={!canNavigateNext}
                    onClick={onNavigateNext}
                />
                <Separator
                    orientation="vertical"
                    className="mx-1 h-5 data-vertical:self-center"
                />
                <ToolbarIconButton
                    label={favoriteLabel}
                    shortcut="F"
                    icon={StarIcon}
                    iconClassName={cn(
                        isFavorite && 'fill-current text-amber-400'
                    )}
                    aria-pressed={isFavorite}
                    disabled={!hasFile}
                    onClick={onToggleFavorite}
                />
                <ToolbarIconButton
                    label={t('dialog.screenshot_metadata.copy_image')}
                    shortcut={['Mod', 'C']}
                    icon={CopyIcon}
                    disabled={!hasFile}
                    onClick={onCopyImage}
                />
                <ToolbarIconButton
                    label={t('view.tools.screenshot_print.menu')}
                    icon={ImageIcon}
                    disabled={!hasFile}
                    onClick={onOpenPrint}
                />
                <ToolbarIconButton
                    label={t('dialog.screenshot_metadata.open_folder')}
                    icon={FolderOpenIcon}
                    disabled={!hasFile}
                    onClick={onOpenFolder}
                />
                <ToolbarIconButton
                    label={t('dialog.screenshot_metadata.fullscreen')}
                    shortcut="Space"
                    icon={MaximizeIcon}
                    disabled={!imageUrl}
                    onClick={onOpenFullscreen}
                />
                <ToolbarIconButton
                    label={t(
                        isDetailsVisible
                            ? 'dialog.screenshot_metadata.hide_details'
                            : 'dialog.screenshot_metadata.show_details'
                    )}
                    shortcut="I"
                    icon={
                        isDetailsVisible
                            ? PanelRightCloseIcon
                            : PanelRightOpenIcon
                    }
                    aria-pressed={isDetailsVisible}
                    onClick={onToggleDetails}
                />
                <DropdownMenu>
                    <HintTooltip label={t('common.actions.more_actions')}>
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={!hasFile}
                                >
                                    <EllipsisIcon data-icon="inline-start" />
                                </Button>
                            }
                        />
                    </HintTooltip>
                    <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem
                            disabled={
                                !isVrcPlusSupporter || isUploadingScreenshot
                            }
                            onClick={onUpload}
                        >
                            <UploadIcon />
                            {t('dialog.screenshot_metadata.upload')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={isDeletingMetadata}
                            onClick={onDeleteMetadata}
                        >
                            <Trash2Icon />
                            {t('dialog.screenshot_metadata.delete_metadata')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <ToolbarIconButton
                    label={t('dialog.screenshot_metadata.delete_file')}
                    shortcut="Delete"
                    icon={Trash2Icon}
                    className="text-destructive hover:text-destructive"
                    disabled={!hasFile || isDeletingFile}
                    onClick={onDeleteFile}
                />
            </div>

            <div className="bg-muted/30 flex min-h-0 flex-1 overflow-hidden rounded-xl border">
                <div className="flex min-w-0 flex-1 flex-col">
                    <ScreenshotDetailStage
                        imageUrl={imageUrl}
                        placeholderUrl={placeholderUrl}
                        alt={metadata?.fileName || 'Screenshot preview'}
                        isMetadataLoading={isMetadataLoading}
                        canNavigatePrev={canNavigatePrev}
                        canNavigateNext={canNavigateNext}
                        onNavigatePrev={onNavigatePrev}
                        onNavigateNext={onNavigateNext}
                    />
                    <ScreenshotFilmstrip
                        images={filmstripImages}
                        currentPath={metadata?.filePath || ''}
                        onSelect={onSelectPath}
                    />
                </div>
                {isDetailsVisible ? (
                    <aside className="bg-background/60 flex w-72 shrink-0 flex-col overflow-hidden border-l xl:w-80">
                        <ScreenshotMetadataDetailsCard
                            metadata={metadata}
                            metadataError={metadataError}
                        />
                    </aside>
                ) : null}
            </div>
        </div>
    );
}
