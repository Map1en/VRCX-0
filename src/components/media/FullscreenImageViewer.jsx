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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { mediaRepository } from '@/repositories/index.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { Button } from '@/ui/shadcn/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/shadcn/dialog';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_STEP = 1.1;
const INITIAL_TRANSFORM = Object.freeze({
    scale: 1,
    rotate: 0,
    tx: 0,
    ty: 0
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function degToRad(value) {
    return (value * Math.PI) / 180;
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[<>:"/\\|?*]+/g, '_')
        .trim();
}

function ensureImageExtension(fileName) {
    if (!fileName) {
        return '';
    }

    return /\.[0-9A-Za-z]+$/.test(fileName) ? fileName : `${fileName}.png`;
}

function getUrlFileName(url) {
    if (!url || String(url).startsWith('data:')) {
        return '';
    }

    try {
        const parsedUrl = new URL(url, window.location.href);
        return decodeURIComponent(parsedUrl.pathname.split('/').pop() || '');
    } catch {
        return String(url).split(/[?#]/)[0].split('/').pop() || '';
    }
}

function toFullSizeImageUrl(url) {
    return String(url || '').replace(
        /\/image\/(file_[^/?#]+)\/(\d+)\/\d+\/?(?=([?#]|$))/,
        '/file/$1/$2/file'
    );
}

function getPathFileName(path) {
    return String(path || '')
        .split(/[/\\]/)
        .pop();
}

function deriveImageFileName({ fileName, url, sourcePath }) {
    const explicitName = ensureImageExtension(sanitizeFileName(fileName));
    if (explicitName) {
        return explicitName;
    }

    const fileId = extractFileId(url);
    if (fileId) {
        return `${fileId}.png`;
    }

    const urlFileName = ensureImageExtension(
        sanitizeFileName(getUrlFileName(url))
    );
    if (urlFileName) {
        return urlFileName;
    }

    const sourceFileName = ensureImageExtension(
        sanitizeFileName(getPathFileName(sourcePath))
    );
    return sourceFileName || 'image.png';
}

function isHttpUrl(url) {
    try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error(`Unexpected image type: ${blob.type}`);
    }
    return blob;
}

async function fetchImageBlobDirect(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error(`Unexpected image type: ${blob.type}`);
    }

    return blob;
}

async function fetchImageBlobViaBackend(url) {
    const response = await mediaRepository.executeGet(url);
    const dataUrl = typeof response.json === 'string' ? response.json : '';

    if (!dataUrl.startsWith('data:image/')) {
        throw new Error('Image response is not a data URL');
    }

    return dataUrlToBlob(dataUrl);
}

async function fetchImageBlob(url) {
    if (!url) {
        throw new Error('Missing image URL');
    }

    const normalizedUrl = String(url);
    if (normalizedUrl.startsWith('data:')) {
        return dataUrlToBlob(normalizedUrl);
    }

    if (isHttpUrl(normalizedUrl)) {
        try {
            return await fetchImageBlobViaBackend(normalizedUrl);
        } catch (backendError) {
            try {
                return await fetchImageBlobDirect(normalizedUrl);
            } catch {
                throw backendError;
            }
        }
    }

    return fetchImageBlobDirect(normalizedUrl);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const separatorIndex = dataUrl.indexOf(',');
            resolve(
                separatorIndex >= 0
                    ? dataUrl.slice(separatorIndex + 1)
                    : dataUrl
            );
        };
        reader.onerror = () => {
            reject(reader.error || new Error('Failed to read image data'));
        };
        reader.readAsDataURL(blob);
    });
}

async function getDownloadImageBase64({ sourcePath, url }) {
    if (sourcePath) {
        return mediaRepository.getFileBase64(sourcePath);
    }

    const blob = await fetchImageBlob(url);
    return blobToBase64(blob);
}

function useImageTransform({ open, url }) {
    const viewerRef = useRef(null);
    const transformRef = useRef(INITIAL_TRANSFORM);
    const dragRef = useRef({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        startTx: 0,
        startTy: 0
    });
    const [transform, setTransform] = useState(INITIAL_TRANSFORM);

    useEffect(() => {
        transformRef.current = transform;
    }, [transform]);

    const resetTransform = useCallback(() => {
        setTransform(INITIAL_TRANSFORM);
    }, []);

    useEffect(() => {
        if (open) {
            resetTransform();
        }
    }, [open, resetTransform, url]);

    const zoomBy = useCallback((factor) => {
        setTransform((current) => ({
            ...current,
            scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE)
        }));
    }, []);

    const zoomIn = useCallback(() => {
        zoomBy(ZOOM_STEP);
    }, [zoomBy]);

    const zoomOut = useCallback(() => {
        zoomBy(1 / ZOOM_STEP);
    }, [zoomBy]);

    const zoomAtPointer = useCallback(
        (event, factor) => {
            const element = viewerRef.current;
            if (!element) {
                zoomBy(factor);
                return;
            }

            const rect = element.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            const cx = rect.width / 2;
            const cy = rect.height / 2;

            setTransform((current) => {
                const oldScale = current.scale;
                const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
                const radians = degToRad(current.rotate);
                const cos = Math.cos(radians);
                const sin = Math.sin(radians);
                const vx = mx - cx - current.tx;
                const vy = my - cy - current.ty;
                const ux = (vx * cos + vy * sin) / oldScale;
                const uy = (-vx * sin + vy * cos) / oldScale;
                const nextVx = (ux * cos - uy * sin) * newScale;
                const nextVy = (ux * sin + uy * cos) * newScale;

                return {
                    ...current,
                    scale: newScale,
                    tx: mx - cx - nextVx,
                    ty: my - cy - nextVy
                };
            });
        },
        [zoomBy]
    );

    const rotateClockwise = useCallback(() => {
        setTransform((current) => ({
            ...current,
            rotate: (current.rotate + 90) % 360
        }));
    }, []);

    const rotateCounterClockwise = useCallback(() => {
        setTransform((current) => ({
            ...current,
            rotate: (current.rotate - 90 + 360) % 360
        }));
    }, []);

    const handleWheel = useCallback(
        (event) => {
            event.preventDefault();
            event.stopPropagation();
            zoomAtPointer(
                event,
                event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
            );
        },
        [zoomAtPointer]
    );

    const handlePointerDown = useCallback((event) => {
        if (event.button !== 0) {
            return;
        }

        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);

        const current = transformRef.current;
        dragRef.current = {
            active: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startTx: current.tx,
            startTy: current.ty
        };
    }, []);

    const handlePointerMove = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) {
            return;
        }

        event.stopPropagation();
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;

        setTransform((current) => ({
            ...current,
            tx: drag.startTx + dx,
            ty: drag.startTy + dy
        }));
    }, []);

    const handlePointerUp = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) {
            return;
        }

        event.stopPropagation();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        dragRef.current = {
            ...dragRef.current,
            active: false,
            pointerId: null
        };
    }, []);

    const transformStyle = useMemo(
        () => ({
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
            transformOrigin: 'center center'
        }),
        [transform.rotate, transform.scale, transform.tx, transform.ty]
    );

    return {
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
    };
}

export function FullscreenImageViewer({
    open,
    url,
    title,
    fileName,
    sourcePath,
    onClose
}) {
    const { t } = useI18n();
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
    } = useImageTransform({ open, url });

    const fullSizeUrl = useMemo(() => toFullSizeImageUrl(url), [url]);
    const resolvedTitle = title || t('message.image.preview_title');
    const resolvedFileName = useMemo(
        () => deriveImageFileName({ fileName, sourcePath, url: fullSizeUrl }),
        [fileName, fullSizeUrl, sourcePath]
    );

    useEffect(() => {
        setImageLoadError(false);
        setImageLoading(Boolean(open && fullSizeUrl));
    }, [fullSizeUrl, open]);

    const copyImage = useCallback(async () => {
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
    }, [copying, fullSizeUrl, sourcePath, t, url]);

    const downloadImage = useCallback(async () => {
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
    }, [downloading, fullSizeUrl, resolvedFileName, sourcePath, t, url]);

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
    }, [
        onClose,
        open,
        resetTransform,
        rotateClockwise,
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
                showCloseButton={false}
                onClick={onClose}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                className="fixed inset-x-0 top-8 bottom-0 left-0 h-auto max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-background/90 p-4 shadow-none ring-0 sm:max-w-none sm:p-10"
            >
                <DialogTitle className="sr-only">{resolvedTitle}</DialogTitle>

                <div
                    ref={viewerRef}
                    className="relative flex size-full select-none items-center justify-center overflow-hidden"
                    onWheel={handleWheel}
                >
                    <div
                        className="absolute top-3 right-3 left-3 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/80 px-2 py-1 shadow-sm backdrop-blur sm:left-auto sm:max-w-none"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={copying || (!url && !sourcePath)}
                            aria-label={t('message.image.copy')}
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
                            aria-label={t('message.image.download')}
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
                            aria-label={t('message.image.zoom_out')}
                            title={t('message.image.zoom_out')}
                            onClick={zoomOut}
                        >
                            <ZoomOutIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('message.image.zoom_in')}
                            title={t('message.image.zoom_in')}
                            onClick={zoomIn}
                        >
                            <ZoomInIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('message.image.rotate_clockwise')}
                            title={t('message.image.rotate_clockwise')}
                            onClick={rotateClockwise}
                        >
                            <RotateCwIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t(
                                'message.image.rotate_counterclockwise'
                            )}
                            title={t('message.image.rotate_counterclockwise')}
                            onClick={rotateCounterClockwise}
                        >
                            <RotateCcwIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('message.image.reset')}
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
                            aria-label={t('message.image.close')}
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
                                className="max-h-full max-w-full touch-none cursor-grab object-contain select-none data-[unavailable=true]:hidden active:cursor-grabbing"
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
