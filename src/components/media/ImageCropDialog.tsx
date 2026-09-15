import 'react-easy-crop/react-easy-crop.css';
import { RotateCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { validateImageUploadFile } from '@/shared/utils/imageUpload';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

import { useImageCropDialogSession } from './imageCropDialogSession';
import { ImageCropToolbar } from './ImageCropToolbar';
import {
    buildMediaTransform,
    CROP_ROTATION_GUTTER,
    cropImage,
    getRotationCoverZoom,
    normalizeRotation,
    normalizeSignedRotation,
    prepareImage,
    type CropResizeAxis
} from './imageCropUtils';
import { useImageCropViewportInteractions } from './useImageCropViewportInteractions';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 5;
const ZOOM_DEFAULT = 1;
const ZOOM_FACTOR = 1.2;
const TRANSFORM_TRANSITION = `transform 150ms cubic-bezier(0.23, 1, 0.32, 1)`;

const CROP_EDGE_HANDLES: ReadonlyArray<{
    side: 'top' | 'right' | 'bottom' | 'left';
    axis: CropResizeAxis;
    direction: 1 | -1;
    className: string;
    gripClassName: string;
}> = [
    {
        side: 'top',
        axis: 'vertical',
        direction: -1,
        className:
            'top-[-0.5px] left-1/2 h-5 w-12 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
        gripClassName: 'h-1 w-7'
    },
    {
        side: 'right',
        axis: 'horizontal',
        direction: 1,
        className:
            'top-1/2 right-[-0.5px] h-12 w-5 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
        gripClassName: 'h-7 w-1'
    },
    {
        side: 'bottom',
        axis: 'vertical',
        direction: 1,
        className:
            'bottom-[-0.5px] left-1/2 h-5 w-12 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
        gripClassName: 'h-1 w-7'
    },
    {
        side: 'left',
        axis: 'horizontal',
        direction: -1,
        className:
            'top-1/2 left-[-0.5px] h-12 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
        gripClassName: 'h-7 w-1'
    }
];

const CROP_CORNER_HANDLES = [
    {
        corner: 'top-left',
        direction: { x: -1, y: -1 },
        resizeClassName:
            'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'
    },
    {
        corner: 'top-right',
        direction: { x: 1, y: -1 },
        resizeClassName:
            'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'
    },
    {
        corner: 'bottom-right',
        direction: { x: 1, y: 1 },
        resizeClassName:
            'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'
    },
    {
        corner: 'bottom-left',
        direction: { x: -1, y: 1 },
        resizeClassName:
            'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'
    }
] as const;

const ASPECT_PRESETS: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [4, 3],
    [3, 4],
    [16, 9],
    [3, 2],
    [2, 3],
    [2, 1]
];

function formatAspect(aspect: number): string {
    for (const [w, h] of ASPECT_PRESETS) {
        if (Math.abs(aspect - w / h) < 0.02) return `${w}:${h}`;
    }
    return aspect.toFixed(2);
}

interface ImageCropDialogNoteField {
    label: string;
    placeholder?: string;
    maxLength?: number;
}

interface ImageCropDialogCropWhiteBorderField {
    label: string;
    defaultChecked?: boolean;
}

interface ImageCropDialogConfirmOptions {
    note?: string;
    cropWhiteBorder?: boolean;
}

export interface ImageCropDialogProps {
    open: boolean;
    title?: string;
    description?: string;
    file: File | null;
    aspectRatio?: number;
    noteField?: ImageCropDialogNoteField;
    cropWhiteBorderField?: ImageCropDialogCropWhiteBorderField;
    onOpenChange?: (open: boolean) => void;
    onConfirm?: (
        blob: Blob,
        options?: ImageCropDialogConfirmOptions
    ) => void | Promise<void>;
}

export function ImageCropDialog({
    open,
    title,
    description,
    file,
    aspectRatio = 1,
    noteField,
    cropWhiteBorderField,
    onOpenChange,
    onConfirm
}: ImageCropDialogProps) {
    const { t } = useTranslation();

    const cropSession = useImageCropDialogSession();
    const {
        crop,
        croppedAreaPixels,
        cropSize,
        cropStageRef,
        cropWhiteBorder,
        cropWrapperRef,
        cropperReady,
        fitWhole,
        flipH,
        flipV,
        isConfirming,
        mediaSize,
        note,
        originalImgRef,
        previewPending,
        previewScaleRef,
        previewSrc,
        resetTransforms,
        rotation,
        rotationEditing,
        rotationInput,
        rotationInputRef,
        setCroppedAreaPixels,
        setCropSize,
        setCropWhiteBorder,
        setCropperReady,
        setIsConfirming,
        setMediaSize,
        setNote,
        setPreviewPending,
        setPreviewSrc,
        setRotation,
        setRotationEditing,
        setRotationInput,
        setZoom,
        transformAnimating,
        triggerTransformAnim,
        zoom
    } = cropSession;

    const resolvedTitle = title || t('message.image.label.crop_image');
    const resolvedDescription =
        description || t('message.image.description.crop_description');
    const noteEnabled = Boolean(noteField);
    const noteMaxLength = Number(noteField?.maxLength) || 32;
    const cropWhiteBorderEnabled = Boolean(cropWhiteBorderField);
    const cropWhiteBorderDefault =
        cropWhiteBorderField?.defaultChecked !== false;
    const aspect = Number(aspectRatio) || 1;

    // Keep the crop frame inside the image. Fit mode may show padding at exact
    // quarter turns, while free rotation still needs the image to cover it.
    const coverZoom =
        mediaSize && cropSize
            ? getRotationCoverZoom(mediaSize, cropSize, rotation)
            : ZOOM_DEFAULT;
    const hasFreeRotation =
        Math.abs(rotation - Math.round(rotation / 90) * 90) > 0.01;
    const constrainToImage = !fitWhole || hasFreeRotation;
    const baseMinZoom = fitWhole ? ZOOM_MIN : ZOOM_DEFAULT;
    const minZoom = constrainToImage
        ? Math.max(baseMinZoom, coverZoom)
        : baseMinZoom;
    const maxZoom = Math.max(ZOOM_MAX, minZoom * ZOOM_FACTOR);
    const effectiveZoom = Math.max(zoom, minZoom);
    const logZoomMin = Math.log(minZoom);
    const logZoomMax = Math.log(maxZoom);

    const {
        adjustRotationFromKeyboard,
        flipHorizontal: doFlipH,
        flipVertical: doFlipV,
        moveCropResize,
        moveCropRotation,
        onCropChange,
        onWheelRequest,
        reset,
        rotateLeft,
        rotateRight,
        setZoomFromSlider: onZoomSlider,
        startCropResize,
        startCropRotation,
        stopCropResize,
        stopCropRotation,
        toggleFit,
        zoomIn,
        zoomOut
    } = useImageCropViewportInteractions({
        model: {
            aspect,
            constrainToImage,
            cropSize,
            effectiveZoom,
            logZoomMax,
            logZoomMin,
            maxZoom,
            mediaSize,
            minZoom,
            rotation
        },
        session: cropSession
    });

    useEffect(() => {
        resetTransforms();
        setCroppedAreaPixels(null);
        setMediaSize(null);
        if (!open || !file || !validateImageUploadFile(file).ok) {
            setPreviewSrc('');
            setPreviewPending(false);
            originalImgRef.current = null;
            previewScaleRef.current = 1;
            return;
        }

        let cancelled = false;
        setPreviewPending(true);
        prepareImage(file)
            .then(({ img, previewSrc: src, previewScale }) => {
                if (cancelled) return;
                originalImgRef.current = img;
                previewScaleRef.current = previewScale;
                setPreviewSrc(src);
                setPreviewPending(false);
            })
            .catch(() => {
                if (cancelled) return;
                setPreviewSrc('');
                setPreviewPending(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        file,
        open,
        originalImgRef,
        previewScaleRef,
        resetTransforms,
        setCroppedAreaPixels,
        setMediaSize,
        setPreviewPending,
        setPreviewSrc
    ]);

    useEffect(() => {
        setCropSize(null);
    }, [aspect, setCropSize]);

    useEffect(() => {
        setNote('');
        setCropWhiteBorder(cropWhiteBorderDefault);
    }, [
        cropWhiteBorderDefault,
        cropWhiteBorderEnabled,
        file,
        noteEnabled,
        open,
        setCropWhiteBorder,
        setNote
    ]);

    // Mount the cropper only after the dialog open animation settles: it measures
    // its container via getBoundingClientRect, which is wrong mid transform-scale.
    useEffect(() => {
        if (!open || !previewSrc) {
            setCropperReady(false);
            return undefined;
        }
        let raf = 0;
        let lastWidth = -1;
        let stableFrames = 0;
        const tick = () => {
            const width =
                cropWrapperRef.current?.getBoundingClientRect().width ?? 0;
            if (width > 0 && Math.abs(width - lastWidth) < 0.5) {
                stableFrames += 1;
                if (stableFrames >= 3) {
                    setCropperReady(true);
                    return;
                }
            } else {
                stableFrames = 0;
                lastWidth = width;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [cropWrapperRef, open, previewSrc, setCropperReady]);

    const onCropComplete = useCallback(
        (_croppedArea: Area, pixels: Area) => {
            setCroppedAreaPixels(pixels);
        },
        [setCroppedAreaPixels]
    );

    async function confirmCrop() {
        const img = originalImgRef.current;
        if (!file || !validateImageUploadFile(file).ok || !img) return;

        const pixels: Area = croppedAreaPixels ?? {
            x: 0,
            y: 0,
            width: img.width * previewScaleRef.current,
            height: img.height * previewScaleRef.current
        };

        setIsConfirming(true);
        try {
            const blob = await cropImage(
                img,
                previewScaleRef.current,
                pixels,
                normalizeRotation(rotation),
                flipH,
                flipV,
                file
            );

            const opts: ImageCropDialogConfirmOptions = {};
            if (noteEnabled) opts.note = note.slice(0, noteMaxLength);
            if (cropWhiteBorderEnabled) opts.cropWhiteBorder = cropWhiteBorder;

            await onConfirm?.(
                blob,
                Object.keys(opts).length > 0 ? opts : undefined
            );
        } finally {
            setIsConfirming(false);
        }
    }

    const mediaTransform = useMemo(
        () =>
            buildMediaTransform(
                crop.x,
                crop.y,
                rotation,
                flipH,
                flipV,
                effectiveZoom
            ),
        [crop.x, crop.y, rotation, flipH, flipV, effectiveZoom]
    );

    const cropperStyle = useMemo(
        () => ({
            containerStyle: {
                borderRadius: '0.5rem',
                top: CROP_ROTATION_GUTTER,
                overflow: 'visible'
            },
            cropAreaStyle: { overflow: 'visible' },
            ...(transformAnimating
                ? { mediaStyle: { transition: TRANSFORM_TRANSITION } }
                : {})
        }),
        [transformAnimating]
    );

    const fitLabel = t(
        fitWhole ? 'dialog.image_crop.mode_fit' : 'dialog.image_crop.mode_free'
    );
    const toolsDisabled = !previewSrc || isConfirming;
    const zoomSliderValue =
        ((Math.log(effectiveZoom) - logZoomMin) / (logZoomMax - logZoomMin)) *
        100;
    const zoomPercent = Math.round(effectiveZoom * 100);
    const aspectLabel = formatAspect(aspect);
    const rotationDisplay =
        Math.round(normalizeSignedRotation(rotation) * 10) / 10;
    const flipDisplay =
        flipH || flipV ? `${flipH ? 'H' : ''}${flipV ? 'V' : ''}` : '';
    const rotationLabel = t('dialog.image_crop.rotation_angle');

    function startRotationInput() {
        setRotationInput(String(rotationDisplay));
        setRotationEditing(true);
    }

    function commitRotationInput() {
        const value = Number(rotationInput.trim());
        if (rotationInput.trim() && Number.isFinite(value)) {
            triggerTransformAnim();
            setRotation(normalizeSignedRotation(value));
        }
        setRotationEditing(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-3xl"
                onPointerDownCapture={(event) => {
                    if (
                        rotationEditing &&
                        event.target !== rotationInputRef.current
                    ) {
                        rotationInputRef.current?.blur();
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{resolvedDescription}</DialogDescription>
                </DialogHeader>

                <TooltipProvider delay={400}>
                    <div className="flex flex-col gap-4">
                        <div
                            ref={cropWrapperRef}
                            inert={isConfirming}
                            className="bg-muted/60 ring-border/60 relative flex items-center justify-center overflow-hidden rounded-xl border p-2 shadow-inner ring-1 ring-inset"
                        >
                            {previewSrc && cropperReady ? (
                                <div
                                    ref={cropStageRef}
                                    className="animate-in fade-in-0 zoom-in-[0.98] relative w-full overflow-hidden rounded-lg bg-neutral-950 duration-200 ease-out motion-reduce:animate-none"
                                    style={{
                                        height: 'clamp(18rem, 50vh, 34rem)'
                                    }}
                                >
                                    <Cropper
                                        image={previewSrc}
                                        crop={crop}
                                        zoom={effectiveZoom}
                                        rotation={rotation}
                                        aspect={aspect}
                                        cropSize={cropSize ?? undefined}
                                        minZoom={minZoom}
                                        maxZoom={maxZoom}
                                        objectFit="contain"
                                        restrictPosition={constrainToImage}
                                        showGrid
                                        zoomWithScroll
                                        onWheelRequest={onWheelRequest}
                                        onCropChange={onCropChange}
                                        onZoomChange={setZoom}
                                        onRotationChange={setRotation}
                                        setMediaSize={setMediaSize}
                                        setCropSize={setCropSize}
                                        onCropComplete={onCropComplete}
                                        onCropAreaChange={onCropComplete}
                                        transform={mediaTransform}
                                        style={cropperStyle}
                                        cropperProps={{
                                            'aria-label': t(
                                                'dialog.image_crop.crop_area'
                                            ),
                                            children: (
                                                <>
                                                    <span
                                                        data-crop-rotation-handle
                                                        role="slider"
                                                        aria-label={
                                                            rotationLabel
                                                        }
                                                        aria-valuemin={-180}
                                                        aria-valuemax={180}
                                                        aria-valuenow={
                                                            rotationDisplay
                                                        }
                                                        aria-valuetext={`${rotationDisplay}°`}
                                                        title={rotationLabel}
                                                        tabIndex={0}
                                                        className="group absolute top-0 left-1/2 z-40 flex size-11 -translate-x-1/2 -translate-y-full cursor-grab touch-none items-center justify-center focus-visible:outline-none active:cursor-grabbing"
                                                        onKeyDown={
                                                            adjustRotationFromKeyboard
                                                        }
                                                        onPointerDown={
                                                            startCropRotation
                                                        }
                                                        onPointerMove={
                                                            moveCropRotation
                                                        }
                                                        onPointerUp={
                                                            stopCropRotation
                                                        }
                                                        onPointerCancel={
                                                            stopCropRotation
                                                        }
                                                    >
                                                        <span className="flex size-7 items-center justify-center rounded-full bg-black/55 text-white/80 shadow-[0_1px_3px_rgb(0_0_0/0.35)] ring-1 ring-white/15 backdrop-blur-sm transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-focus-visible:ring-2 group-focus-visible:ring-white/70 group-active:scale-[0.96] pointer-fine:group-hover:bg-white/15 pointer-fine:group-hover:text-white">
                                                            <RotateCw className="size-4 text-white opacity-80 group-focus-visible:opacity-100 pointer-fine:group-hover:opacity-100" />
                                                        </span>
                                                    </span>
                                                    {CROP_CORNER_HANDLES.map(
                                                        ({
                                                            corner,
                                                            direction,
                                                            resizeClassName
                                                        }) => (
                                                            <span
                                                                key={corner}
                                                                data-crop-resize-handle={
                                                                    corner
                                                                }
                                                                className={cn(
                                                                    'group absolute z-30 flex size-7 touch-none items-center justify-center',
                                                                    resizeClassName
                                                                )}
                                                                onPointerDown={(
                                                                    event
                                                                ) =>
                                                                    startCropResize(
                                                                        {
                                                                            kind: 'corner',
                                                                            direction
                                                                        },
                                                                        event
                                                                    )
                                                                }
                                                                onPointerMove={
                                                                    moveCropResize
                                                                }
                                                                onPointerUp={
                                                                    stopCropResize
                                                                }
                                                                onPointerCancel={
                                                                    stopCropResize
                                                                }
                                                            >
                                                                <span className="pointer-fine:group-hover:bg-primary size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.65)] transition-colors" />
                                                            </span>
                                                        )
                                                    )}
                                                    {CROP_EDGE_HANDLES.map(
                                                        ({
                                                            side,
                                                            axis,
                                                            direction,
                                                            className,
                                                            gripClassName
                                                        }) => (
                                                            <span
                                                                key={side}
                                                                data-crop-resize-handle={
                                                                    side
                                                                }
                                                                className={cn(
                                                                    'group absolute z-20 flex touch-none items-center justify-center',
                                                                    className
                                                                )}
                                                                onPointerDown={(
                                                                    event
                                                                ) =>
                                                                    startCropResize(
                                                                        {
                                                                            kind: 'edge',
                                                                            axis,
                                                                            direction
                                                                        },
                                                                        event
                                                                    )
                                                                }
                                                                onPointerMove={
                                                                    moveCropResize
                                                                }
                                                                onPointerUp={
                                                                    stopCropResize
                                                                }
                                                                onPointerCancel={
                                                                    stopCropResize
                                                                }
                                                            >
                                                                <span
                                                                    className={cn(
                                                                        'pointer-fine:group-hover:bg-primary rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.65)] transition-colors',
                                                                        gripClassName
                                                                    )}
                                                                />
                                                            </span>
                                                        )
                                                    )}
                                                </>
                                            )
                                        }}
                                    />

                                    <span className="bg-background/70 text-muted-foreground ring-border pointer-events-none absolute top-2 left-2 z-10 rounded-md px-2 py-0.5 font-mono text-[11px] leading-none ring-1 backdrop-blur-sm">
                                        {aspectLabel}
                                    </span>
                                    <div className="bg-background/70 text-muted-foreground ring-border absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] leading-none tabular-nums ring-1 backdrop-blur-sm">
                                        {rotationEditing ? (
                                            <span className="flex items-center">
                                                <Input
                                                    ref={rotationInputRef}
                                                    autoFocus
                                                    inputMode="decimal"
                                                    value={rotationInput}
                                                    onChange={(event) =>
                                                        setRotationInput(
                                                            event.target.value
                                                        )
                                                    }
                                                    onFocus={(event) =>
                                                        event.currentTarget.select()
                                                    }
                                                    onBlur={commitRotationInput}
                                                    onKeyDown={(event) => {
                                                        if (
                                                            event.key ===
                                                            'Enter'
                                                        ) {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            event.currentTarget.blur();
                                                        } else if (
                                                            event.key ===
                                                            'Escape'
                                                        ) {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            setRotationEditing(
                                                                false
                                                            );
                                                        }
                                                    }}
                                                    aria-label={rotationLabel}
                                                    className="h-4 w-12 rounded-sm border-0 px-0.5 py-0 text-right font-mono text-[11px] shadow-none focus-visible:ring-1"
                                                />
                                                <span aria-hidden="true">
                                                    °
                                                </span>
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={startRotationInput}
                                                aria-label={`${rotationLabel}: ${rotationDisplay}°`}
                                                title={rotationLabel}
                                                className="hover:text-foreground cursor-text rounded-sm outline-none focus-visible:ring-1"
                                            >
                                                {rotationDisplay}°
                                            </button>
                                        )}
                                        {flipDisplay ? (
                                            <>
                                                <span className="pointer-events-none opacity-30">
                                                    ·
                                                </span>
                                                <span className="pointer-events-none">
                                                    {flipDisplay}
                                                </span>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            ) : previewPending || previewSrc ? (
                                <div className="flex items-center justify-center">
                                    <Spinner />
                                </div>
                            ) : null}
                        </div>

                        <ImageCropToolbar
                            model={{
                                disabled: toolsDisabled,
                                fitLabel,
                                fitWhole,
                                flipH,
                                flipV,
                                zoomPercent,
                                zoomSliderValue
                            }}
                            actions={{
                                flipHorizontal: doFlipH,
                                flipVertical: doFlipV,
                                reset,
                                rotateLeft,
                                rotateRight,
                                toggleFit,
                                zoomIn,
                                zoomOut,
                                setZoom: onZoomSlider
                            }}
                        />

                        {noteEnabled ? (
                            <Field>
                                <FieldLabel htmlFor="image-crop-upload-note">
                                    {noteField?.label}
                                </FieldLabel>
                                <Input
                                    id="image-crop-upload-note"
                                    maxLength={noteMaxLength}
                                    value={note}
                                    onChange={(e) =>
                                        setNote(
                                            String(e.target.value || '').slice(
                                                0,
                                                noteMaxLength
                                            )
                                        )
                                    }
                                    placeholder={noteField?.placeholder}
                                />
                            </Field>
                        ) : null}
                        {cropWhiteBorderEnabled ? (
                            <Field
                                orientation="horizontal"
                                className="h-9 w-auto"
                            >
                                <Checkbox
                                    id="image-crop-white-border"
                                    checked={cropWhiteBorder}
                                    onCheckedChange={(v) =>
                                        setCropWhiteBorder(Boolean(v))
                                    }
                                />
                                <FieldLabel htmlFor="image-crop-white-border">
                                    {cropWhiteBorderField?.label}
                                </FieldLabel>
                            </Field>
                        ) : null}
                    </div>
                </TooltipProvider>

                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={isConfirming}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        disabled={isConfirming || !file}
                        onClick={() => {
                            confirmCrop();
                        }}
                    >
                        {isConfirming ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <Upload data-icon="inline-start" />
                        )}
                        {t('message.image.action.upload')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
