import {
    ChevronLeftIcon,
    ChevronRightIcon,
    CopyIcon,
    DownloadIcon,
    RefreshCcwIcon,
    RotateCcwIcon,
    RotateCwIcon,
    XIcon,
    ZoomInIcon,
    ZoomOutIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    hasCommandModifier,
    hasOpenDialogOutside,
    isImeComposing,
    isTextEntryTarget
} from '@/components/keyboard/keyboardShortcutGuards';
import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/shadcn/dialog';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    fetchImageBlob,
    getDownloadImageBase64
} from './fullscreenImageDownload';
import {
    deriveImageFileName,
    toFullSizeImageUrl
} from './fullscreenImageViewerUtils';
import { useFullscreenImageTransform } from './useFullscreenImageTransform';
import { useProgressiveImageSource } from './useProgressiveImageSource';

export type FullscreenImageNavigation = {
    canNavigatePrev: boolean;
    canNavigateNext: boolean;
    onNavigatePrev(): void;
    onNavigateNext(): void;
};

export function FullscreenImageViewer({
    open,
    url,
    placeholderUrl,
    title,
    fileName,
    sourcePath,
    navigation,
    onClose
}: {
    open: boolean;
    url?: string | null;
    placeholderUrl?: string | null;
    title?: string | null;
    fileName?: string | null;
    sourcePath?: string | null;
    navigation?: FullscreenImageNavigation;
    onClose(): void;
}) {
    const { t } = useTranslation();
    const [copying, setCopying] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const {
        viewerRef,
        transformStyle,
        handleDoubleClick,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handleWheel,
        resetTransform,
        rotateClockwise,
        rotateCounterClockwise,
        zoomIn,
        zoomOut
    } = useFullscreenImageTransform({ open, url });

    const fullSizeUrl = toFullSizeImageUrl(url);
    const {
        isInterim,
        shownSrc,
        status: imageStatus
    } = useProgressiveImageSource(
        fullSizeUrl,
        placeholderUrl || (url && url !== fullSizeUrl ? url : '')
    );
    const imageLoading = !shownSrc && imageStatus === 'loading';
    const imageLoadError = imageStatus === 'error';
    const resolvedTitle = title || t('message.image.preview_title');
    const resolvedFileName = deriveImageFileName({
        fileName,
        sourcePath,
        url: fullSizeUrl
    });

    async function copyImage() {
        if ((!url && !sourcePath) || copying) {
            return;
        }

        setCopying(true);
        const toastId = toast.add({
            type: 'info',
            title: t('message.image.downloading')
        });

        try {
            if (sourcePath) {
                await commands.appCopyImageToClipboard(sourcePath);
                toast.add({
                    type: 'success',
                    title: t('message.image.copied_to_clipboard')
                });
                return;
            }

            if (!navigator.clipboard?.write || !window.ClipboardItem) {
                throw new Error('Clipboard image write is not available');
            }

            const blob = await fetchImageBlob(fullSizeUrl);
            const mimeType = blob.type || 'image/png';
            await navigator.clipboard.write([
                new window.ClipboardItem({
                    [mimeType]: blob
                })
            ]);
            toast.add({
                type: 'success',
                title: t('message.image.copied_to_clipboard')
            });
        } catch (error) {
            console.error('Failed to copy image:', error);
            toast.add({ type: 'error', title: t('message.image.copy_failed') });
        } finally {
            setCopying(false);
            toast.close(toastId);
        }
    }

    async function downloadImage() {
        if ((!url && !sourcePath) || downloading) {
            return;
        }

        setDownloading(true);
        const toastId = toast.add({
            type: 'info',
            title: t('message.image.downloading')
        });

        try {
            const base64Data = await getDownloadImageBase64({
                sourcePath: sourcePath ?? undefined,
                url: fullSizeUrl
            });
            const savedPath = await commands.appSaveImageFile(
                resolvedFileName,
                base64Data
            );
            if (savedPath) {
                toast.add({
                    type: 'success',
                    title: t('message.image.downloaded')
                });
            }
        } catch (error) {
            console.error('Failed to download image:', error);
            toast.add({
                type: 'error',
                title: t('message.image.download_failed')
            });
        } finally {
            setDownloading(false);
            toast.close(toastId);
        }
    }

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key.toLowerCase() === 'r') {
                event.preventDefault();
                rotateClockwise();
                return;
            }

            if (
                isImeComposing(event) ||
                hasCommandModifier(event) ||
                isTextEntryTarget(event.target)
            ) {
                return;
            }

            if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                zoomIn();
                return;
            }

            if (event.key === '-' || event.key === '_') {
                event.preventDefault();
                zoomOut();
                return;
            }

            if (event.key === '0') {
                event.preventDefault();
                resetTransform();
                return;
            }

            if (
                event.shiftKey ||
                !navigation ||
                hasOpenDialogOutside(viewerRef.current)
            ) {
                return;
            }

            if (event.key === 'ArrowLeft' && navigation.canNavigatePrev) {
                event.preventDefault();
                navigation.onNavigatePrev();
                return;
            }

            if (event.key === 'ArrowRight' && navigation.canNavigateNext) {
                event.preventDefault();
                navigation.onNavigateNext();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        navigation,
        open,
        resetTransform,
        rotateClockwise,
        viewerRef,
        zoomIn,
        zoomOut
    ]);

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onClose();
                }
            }}
        >
            <DialogContent
                data-fullscreen-image-viewer=""
                showCloseButton={false}
                onClick={onClose}
                initialFocus={false}
                finalFocus={false}
                className="bg-background/90 fixed inset-x-0 top-8 bottom-0 left-0 h-auto max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-4 shadow-none ring-0 sm:max-w-none sm:p-10"
            >
                <DialogTitle className="sr-only">{resolvedTitle}</DialogTitle>

                <div
                    ref={viewerRef}
                    className="relative flex size-full items-center justify-center overflow-hidden select-none"
                    onWheel={handleWheel}
                >
                    <div
                        role="presentation"
                        className="bg-background/80 absolute top-3 right-3 left-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-end gap-2 rounded-lg border px-2 py-1 shadow-sm backdrop-blur sm:left-auto sm:max-w-none"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        disabled={
                                            copying || (!url && !sourcePath)
                                        }
                                        aria-label={t('message.image.copy')}
                                        onClick={() => {
                                            copyImage();
                                        }}
                                    >
                                        {copying ? (
                                            <Spinner data-icon="inline-start" />
                                        ) : (
                                            <CopyIcon data-icon="inline-start" />
                                        )}
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.copy')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        disabled={
                                            downloading || (!url && !sourcePath)
                                        }
                                        aria-label={t('message.image.download')}
                                        onClick={() => {
                                            downloadImage();
                                        }}
                                    >
                                        {downloading ? (
                                            <Spinner data-icon="inline-start" />
                                        ) : (
                                            <DownloadIcon data-icon="inline-start" />
                                        )}
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.download')}
                            </TooltipContent>
                        </Tooltip>
                        <Separator
                            orientation="vertical"
                            className="mx-1 h-5 data-vertical:self-center"
                        />
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('message.image.zoom_out')}
                                        onClick={zoomOut}
                                    >
                                        <ZoomOutIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.zoom_out')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('message.image.zoom_in')}
                                        onClick={zoomIn}
                                    >
                                        <ZoomInIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.zoom_in')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t(
                                            'message.image.rotate_clockwise'
                                        )}
                                        onClick={rotateClockwise}
                                    >
                                        <RotateCwIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.rotate_clockwise')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t(
                                            'message.image.rotate_counterclockwise'
                                        )}
                                        onClick={rotateCounterClockwise}
                                    >
                                        <RotateCcwIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.rotate_counterclockwise')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('message.image.reset')}
                                        onClick={resetTransform}
                                    >
                                        <RefreshCcwIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.reset')}
                            </TooltipContent>
                        </Tooltip>
                        <Separator
                            orientation="vertical"
                            className="mx-1 h-5 data-vertical:self-center"
                        />
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('message.image.close')}
                                        onClick={onClose}
                                    >
                                        <XIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('message.image.close')}
                            </TooltipContent>
                        </Tooltip>
                    </div>

                    {navigation ? (
                        <>
                            <FullscreenImageNavButton
                                side="prev"
                                label={t('message.image.previous')}
                                disabled={!navigation.canNavigatePrev}
                                onClick={navigation.onNavigatePrev}
                            />
                            <FullscreenImageNavButton
                                side="next"
                                label={t('message.image.next')}
                                disabled={!navigation.canNavigateNext}
                                onClick={navigation.onNavigateNext}
                            />
                        </>
                    ) : null}

                    {fullSizeUrl ? (
                        <>
                            {imageLoading ? (
                                <div
                                    role="status"
                                    className="text-muted-foreground flex flex-col items-center gap-3 text-sm"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) =>
                                        event.stopPropagation()
                                    }
                                >
                                    <Spinner className="size-6" />
                                    <span>{t('message.image.loading')}</span>
                                </div>
                            ) : null}
                            {imageLoadError ? (
                                <div
                                    role="status"
                                    className="text-muted-foreground text-sm"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) =>
                                        event.stopPropagation()
                                    }
                                >
                                    {t('message.image.load_failed')}
                                </div>
                            ) : null}
                            {shownSrc && !imageLoadError ? (
                                <img
                                    src={shownSrc}
                                    alt={resolvedTitle}
                                    draggable={false}
                                    className={cn(
                                        'relative z-0 max-h-full max-w-full cursor-grab touch-none object-contain select-none active:cursor-grabbing',
                                        isInterim && 'size-full'
                                    )}
                                    style={transformStyle}
                                    onClick={(event) => event.stopPropagation()}
                                    onDoubleClick={handleDoubleClick}
                                    onKeyDown={(event) =>
                                        event.stopPropagation()
                                    }
                                    onDragStart={(event) =>
                                        event.preventDefault()
                                    }
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                />
                            ) : null}
                        </>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function FullscreenImageNavButton({
    side,
    label,
    disabled,
    onClick
}: {
    side: 'prev' | 'next';
    label: string;
    disabled: boolean;
    onClick(): void;
}) {
    const Icon = side === 'prev' ? ChevronLeftIcon : ChevronRightIcon;

    return (
        <Button
            type="button"
            variant="secondary"
            size="icon-lg"
            aria-label={label}
            disabled={disabled}
            className={cn(
                'bg-background/70 absolute top-1/2 z-20 -translate-y-1/2 rounded-full shadow-sm backdrop-blur disabled:opacity-0',
                side === 'prev' ? 'left-3' : 'right-3'
            )}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
        >
            <Icon />
        </Button>
    );
}
