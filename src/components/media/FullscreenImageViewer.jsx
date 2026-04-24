import {
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
import { toast } from 'sonner';

import { mediaRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/shadcn/dialog';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    deriveImageFileName,
    toFullSizeImageUrl
} from './fullscreenImageViewerUtils.js';
import {
    fetchImageBlob,
    getDownloadImageBase64
} from './fullscreenImageDownload.js';
import { useFullscreenImageTransform } from './useFullscreenImageTransform.js';

export function FullscreenImageViewer({
    open,
    url,
    title,
    fileName,
    sourcePath,
    onClose
}) {
    const { t } = useTranslation();
    const [imageLoading, setImageLoading] = useState(false);
    const [imageLoadError, setImageLoadError] = useState(false);
    const [copying, setCopying] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const {
        viewerRef,
        transformStyle,
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
    const resolvedTitle = title || t('message.image.preview_title');
    const resolvedFileName = deriveImageFileName({
        fileName,
        sourcePath,
        url: fullSizeUrl
    });

    useEffect(() => {
        setImageLoadError(false);
        setImageLoading(Boolean(open && fullSizeUrl));
    }, [fullSizeUrl, open]);

    async function copyImage() {
        if ((!url && !sourcePath) || copying) {
            return;
        }

        setCopying(true);
        const toastId = toast.info(t('message.image.downloading'));

        try {
            if (sourcePath) {
                await mediaRepository.copyImageToClipboard(sourcePath);
                toast.success(t('message.image.copied_to_clipboard'));
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
            toast.success(t('message.image.copied_to_clipboard'));
        } catch (error) {
            console.error('Failed to copy image:', error);
            toast.error(t('message.image.copy_failed'));
        } finally {
            setCopying(false);
            toast.dismiss(toastId);
        }
    }

    async function downloadImage() {
        if ((!url && !sourcePath) || downloading) {
            return;
        }

        setDownloading(true);
        const toastId = toast.info(t('message.image.downloading'));

        try {
            const base64Data = await getDownloadImageBase64({
                sourcePath,
                url: fullSizeUrl
            });
            const savedPath = await mediaRepository.saveImageFile(
                resolvedFileName,
                base64Data
            );
            if (savedPath) {
                toast.success(t('message.image.downloaded'));
            }
        } catch (error) {
            console.error('Failed to download image:', error);
            toast.error(t('message.image.download_failed'));
        } finally {
            setDownloading(false);
            toast.dismiss(toastId);
        }
    }

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
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

            if (event.key.toLowerCase() === 'r') {
                event.preventDefault();
                rotateClockwise();
                return;
            }

            if (event.key === '0') {
                event.preventDefault();
                resetTransform();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, open, resetTransform, rotateClockwise, zoomIn, zoomOut]);

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
                showCloseButton={false}
                onClick={onClose}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                className="bg-background/90 fixed inset-x-0 top-8 bottom-0 left-0 h-auto max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-4 shadow-none ring-0 sm:max-w-none sm:p-10"
            >
                <DialogTitle className="sr-only">{resolvedTitle}</DialogTitle>

                <div
                    ref={viewerRef}
                    className="relative flex size-full items-center justify-center overflow-hidden select-none"
                    onWheel={handleWheel}
                >
                    <div
                        className="bg-background/80 absolute top-3 right-3 left-3 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-end gap-2 rounded-lg border px-2 py-1 shadow-sm backdrop-blur sm:left-auto sm:max-w-none"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={copying || (!url && !sourcePath)}
                            aria-label={'Copy image'}
                            title={t('message.image.copy')}
                            onClick={() => void copyImage()}
                        >
                            {copying ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <CopyIcon data-icon="inline-start" />
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={downloading || (!url && !sourcePath)}
                            aria-label={'Download image'}
                            title={t('message.image.download')}
                            onClick={() => void downloadImage()}
                        >
                            {downloading ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <DownloadIcon data-icon="inline-start" />
                            )}
                        </Button>
                        <Separator
                            orientation="vertical"
                            className="mx-1 h-5 data-vertical:self-center"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={'Zoom out'}
                            title={t('message.image.zoom_out')}
                            onClick={zoomOut}
                        >
                            <ZoomOutIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={'Zoom in'}
                            title={t('message.image.zoom_in')}
                            onClick={zoomIn}
                        >
                            <ZoomInIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={'Rotate clockwise'}
                            title={t('message.image.rotate_clockwise')}
                            onClick={rotateClockwise}
                        >
                            <RotateCwIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={'Rotate counterclockwise'}
                            title={t('message.image.rotate_counterclockwise')}
                            onClick={rotateCounterClockwise}
                        >
                            <RotateCcwIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={'Reset'}
                            title={t('message.image.reset')}
                            onClick={resetTransform}
                        >
                            <RefreshCcwIcon data-icon="inline-start" />
                        </Button>
                        <Separator
                            orientation="vertical"
                            className="mx-1 h-5 data-vertical:self-center"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={'Close'}
                            title={t('message.image.close')}
                            onClick={onClose}
                        >
                            <XIcon data-icon="inline-start" />
                        </Button>
                    </div>

                    {fullSizeUrl ? (
                        <>
                            {imageLoading ? (
                                <div
                                    className="text-muted-foreground flex flex-col items-center gap-3 text-sm"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <Spinner className="size-6" />
                                    <span>{t('message.image.loading')}</span>
                                </div>
                            ) : null}
                            {imageLoadError ? (
                                <div
                                    className="text-muted-foreground text-sm"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    {t('message.image.load_failed')}
                                </div>
                            ) : null}
                            <img
                                src={fullSizeUrl}
                                alt={resolvedTitle}
                                draggable={false}
                                className="max-h-full max-w-full cursor-grab touch-none object-contain select-none active:cursor-grabbing data-[unavailable=true]:hidden"
                                data-unavailable={
                                    imageLoading || imageLoadError
                                }
                                style={transformStyle}
                                onLoad={() => {
                                    setImageLoading(false);
                                    setImageLoadError(false);
                                }}
                                onError={() => {
                                    setImageLoading(false);
                                    setImageLoadError(true);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onDragStart={(event) => event.preventDefault()}
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerCancel={handlePointerUp}
                            />
                        </>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
