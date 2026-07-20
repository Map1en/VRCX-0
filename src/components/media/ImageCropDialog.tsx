import 'react-easy-crop/react-easy-crop.css';
import {
    FlipHorizontal2,
    FlipVertical2,
    Maximize2,
    Minimize2,
    RefreshCcw,
    RotateCcw,
    RotateCw,
    Upload,
    ZoomIn,
    ZoomOut
} from 'lucide-react';
import {
    Fragment,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import Cropper, {
    type Area,
    type MediaSize,
    type Point,
    type Size
} from 'react-easy-crop';
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
import { Separator } from '@/ui/shadcn/separator';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

import {
    buildMediaTransform,
    constrainCropSizeToZoom,
    constrainCropToImage,
    cropImage,
    getContinuousRotationDeltaDegrees,
    getRotationCoverZoom,
    prepareImage,
    resizeCropSize,
    resizeCropSizeFromCorner,
    type CropResizeAxis
} from './imageCropUtils';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 5;
const ZOOM_DEFAULT = 1;
const ZOOM_FACTOR = 1.2;
const TRACKPAD_PAN_END_MS = 160;
const TRACKPAD_PAN_THRESHOLD = 50;
const TRANSFORM_TRANSITION_MS = 180;
const TRANSFORM_TRANSITION = `transform 150ms cubic-bezier(0.23, 1, 0.32, 1)`;
const MIN_CROP_SHORT_EDGE = 56;

type CropResizeHandle =
    | { kind: 'edge'; axis: CropResizeAxis; direction: 1 | -1 }
    | { kind: 'corner'; direction: Point };

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
            'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
        rotateClassName: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2'
    },
    {
        corner: 'top-right',
        direction: { x: 1, y: -1 },
        resizeClassName:
            'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
        rotateClassName: 'top-0 right-0 translate-x-1/2 -translate-y-1/2'
    },
    {
        corner: 'bottom-right',
        direction: { x: 1, y: 1 },
        resizeClassName:
            'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
        rotateClassName: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2'
    },
    {
        corner: 'bottom-left',
        direction: { x: -1, y: 1 },
        resizeClassName:
            'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
        rotateClassName: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2'
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

function normalizeRotation(rotation: number): number {
    return ((rotation % 360) + 360) % 360;
}

function normalizeSignedRotation(rotation: number): number {
    const normalized = normalizeRotation(rotation);
    return normalized > 180 ? normalized - 360 : normalized;
}

function prefersReducedMotion(): boolean {
    if (
        typeof window === 'undefined' ||
        typeof window.matchMedia !== 'function'
    ) {
        return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ImageCropDialogNoteField {
    label: string;
    placeholder?: string;
    maxLength?: number;
}

export interface ImageCropDialogCropWhiteBorderField {
    label: string;
    defaultChecked?: boolean;
}

export interface ImageCropDialogConfirmOptions {
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

    const originalImgRef = useRef<HTMLImageElement | null>(null);
    const previewScaleRef = useRef<number>(1);
    const cropWrapperRef = useRef<HTMLDivElement | null>(null);
    const cropStageRef = useRef<HTMLDivElement | null>(null);
    const rotationInputRef = useRef<HTMLInputElement | null>(null);

    const [previewSrc, setPreviewSrc] = useState<string>('');
    const [previewPending, setPreviewPending] = useState(false);
    const [cropperReady, setCropperReady] = useState(false);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(ZOOM_DEFAULT);
    const [rotation, setRotation] = useState(0);
    const [rotationEditing, setRotationEditing] = useState(false);
    const [rotationInput, setRotationInput] = useState('');
    const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
    const [cropSize, setCropSize] = useState<Size | null>(null);
    const [flipH, setFlipH] = useState(false);
    const [flipV, setFlipV] = useState(false);
    const [fitWhole, setFitWhole] = useState(false);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
        null
    );

    const [note, setNote] = useState('');
    const [cropWhiteBorder, setCropWhiteBorder] = useState(true);
    const [isConfirming, setIsConfirming] = useState(false);
    const [transformAnimating, setTransformAnimating] = useState(false);
    const transformAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    const rotationDragRef = useRef<{
        pointerId: number;
        centerX: number;
        centerY: number;
        previousAngleRadians: number;
        rotationDegrees: number;
    } | null>(null);
    const cropResizeDragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        startSize: Size;
        handle: CropResizeHandle;
    } | null>(null);
    const trackpadPanningRef = useRef(false);
    const trackpadPanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );

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

    const resetTransforms = useCallback(() => {
        setCrop({ x: 0, y: 0 });
        setZoom(ZOOM_DEFAULT);
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
        setFitWhole(false);
        setRotationEditing(false);
        setCropSize(null);
    }, []);

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
    }, [file, open, resetTransforms]);

    useEffect(() => {
        setCropSize(null);
    }, [aspect]);

    useEffect(() => {
        setNote('');
        setCropWhiteBorder(cropWhiteBorderDefault);
    }, [
        cropWhiteBorderDefault,
        cropWhiteBorderEnabled,
        file,
        noteEnabled,
        open
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
    }, [open, previewSrc]);

    const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    useEffect(() => {
        return () => {
            if (transformAnimTimerRef.current) {
                clearTimeout(transformAnimTimerRef.current);
            }
            if (trackpadPanTimerRef.current) {
                clearTimeout(trackpadPanTimerRef.current);
            }
        };
    }, []);

    const triggerTransformAnim = useCallback(() => {
        if (prefersReducedMotion()) return;
        if (transformAnimTimerRef.current) {
            clearTimeout(transformAnimTimerRef.current);
        }
        setTransformAnimating(true);
        transformAnimTimerRef.current = setTimeout(() => {
            setTransformAnimating(false);
            transformAnimTimerRef.current = null;
        }, TRANSFORM_TRANSITION_MS);
    }, []);

    const startCropRotation = useCallback(
        (event: ReactPointerEvent<HTMLSpanElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const cropBounds =
                event.currentTarget.parentElement?.getBoundingClientRect();
            if (!cropBounds) return;

            if (transformAnimTimerRef.current) {
                clearTimeout(transformAnimTimerRef.current);
                transformAnimTimerRef.current = null;
            }
            setTransformAnimating(false);
            event.currentTarget.setPointerCapture(event.pointerId);
            const centerX = cropBounds.left + cropBounds.width / 2;
            const centerY = cropBounds.top + cropBounds.height / 2;
            rotationDragRef.current = {
                pointerId: event.pointerId,
                centerX,
                centerY,
                previousAngleRadians: Math.atan2(
                    event.clientY - centerY,
                    event.clientX - centerX
                ),
                rotationDegrees: rotation
            };
        },
        [rotation]
    );

    const moveCropRotation = useCallback(
        (event: ReactPointerEvent<HTMLSpanElement>) => {
            const drag = rotationDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            const angleRadians = Math.atan2(
                event.clientY - drag.centerY,
                event.clientX - drag.centerX
            );
            drag.rotationDegrees += getContinuousRotationDeltaDegrees(
                drag.previousAngleRadians,
                angleRadians
            );
            drag.previousAngleRadians = angleRadians;
            setRotation(drag.rotationDegrees);
        },
        []
    );

    const stopCropRotation = useCallback(
        (event: ReactPointerEvent<HTMLSpanElement>) => {
            const drag = rotationDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            rotationDragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setRotation((value) => normalizeSignedRotation(value));
        },
        []
    );

    const startCropResize = useCallback(
        (
            handle: CropResizeHandle,
            event: ReactPointerEvent<HTMLSpanElement>
        ) => {
            if (!cropSize) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            cropResizeDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startSize: cropSize,
                handle
            };
        },
        [cropSize]
    );

    const moveCropResize = useCallback(
        (event: ReactPointerEvent<HTMLSpanElement>) => {
            const drag = cropResizeDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;

            event.preventDefault();
            event.stopPropagation();
            const bounds = cropStageRef.current?.getBoundingClientRect();
            if (!bounds) return;

            const delta = {
                x: event.clientX - drag.startX,
                y: event.clientY - drag.startY
            };
            const resized =
                drag.handle.kind === 'corner'
                    ? resizeCropSizeFromCorner(
                          drag.startSize,
                          delta,
                          drag.handle.direction,
                          bounds,
                          aspect,
                          MIN_CROP_SHORT_EDGE
                      )
                    : resizeCropSize(
                          drag.startSize,
                          drag.handle.axis,
                          (drag.handle.axis === 'horizontal'
                              ? delta.x
                              : delta.y) * drag.handle.direction,
                          bounds,
                          aspect,
                          MIN_CROP_SHORT_EDGE
                      );
            setCropSize(
                constrainToImage && mediaSize
                    ? constrainCropSizeToZoom(
                          resized,
                          mediaSize,
                          effectiveZoom,
                          rotation
                      )
                    : resized
            );
        },
        [aspect, constrainToImage, effectiveZoom, mediaSize, rotation]
    );

    const stopCropResize = useCallback(
        (event: ReactPointerEvent<HTMLSpanElement>) => {
            const drag = cropResizeDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            cropResizeDragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        },
        []
    );

    const limitCropPosition = useCallback(
        (position: Point) =>
            constrainToImage && mediaSize && cropSize
                ? constrainCropToImage(
                      position,
                      mediaSize,
                      cropSize,
                      effectiveZoom,
                      rotation
                  )
                : position,
        [constrainToImage, cropSize, effectiveZoom, mediaSize, rotation]
    );

    const onCropChange = useCallback(
        (position: Point) => setCrop(limitCropPosition(position)),
        [limitCropPosition]
    );

    const onWheelRequest = useCallback(
        (event: WheelEvent) => {
            if (event.ctrlKey) {
                trackpadPanningRef.current = false;
                if (trackpadPanTimerRef.current) {
                    clearTimeout(trackpadPanTimerRef.current);
                    trackpadPanTimerRef.current = null;
                }
                return true;
            }

            const startsTrackpadPan =
                event.deltaMode === 0 &&
                (event.deltaX !== 0 ||
                    Math.abs(event.deltaY) < TRACKPAD_PAN_THRESHOLD);
            if (!trackpadPanningRef.current && !startsTrackpadPan) return true;

            event.preventDefault();
            trackpadPanningRef.current = true;
            if (trackpadPanTimerRef.current) {
                clearTimeout(trackpadPanTimerRef.current);
            }
            trackpadPanTimerRef.current = setTimeout(() => {
                trackpadPanningRef.current = false;
                trackpadPanTimerRef.current = null;
            }, TRACKPAD_PAN_END_MS);
            setCrop((current) =>
                limitCropPosition({
                    x: current.x - event.deltaX,
                    y: current.y - event.deltaY
                })
            );
            return false;
        },
        [limitCropPosition]
    );

    const rotateBy = useCallback(
        (delta: number) => setRotation((r) => r + delta),
        []
    );
    const rotateLeft = useCallback(() => {
        triggerTransformAnim();
        rotateBy(-90);
    }, [rotateBy, triggerTransformAnim]);
    const rotateRight = useCallback(() => {
        triggerTransformAnim();
        rotateBy(90);
    }, [rotateBy, triggerTransformAnim]);
    const doFlipH = useCallback(() => {
        triggerTransformAnim();
        setFlipH((v) => !v);
    }, [triggerTransformAnim]);
    const doFlipV = useCallback(() => {
        triggerTransformAnim();
        setFlipV((v) => !v);
    }, [triggerTransformAnim]);
    const zoomIn = useCallback(() => {
        setZoom(Math.min(maxZoom, effectiveZoom * ZOOM_FACTOR));
    }, [effectiveZoom, maxZoom]);
    const zoomOut = useCallback(
        () => setZoom(Math.max(minZoom, effectiveZoom / ZOOM_FACTOR)),
        [effectiveZoom, minZoom]
    );
    const onZoomSlider = useCallback(
        (value: number | readonly number[]) => {
            const pct = (Array.isArray(value) ? value[0] : value) ?? 0;
            setZoom(
                Math.exp(logZoomMin + (pct / 100) * (logZoomMax - logZoomMin))
            );
        },
        [logZoomMax, logZoomMin]
    );
    const toggleFit = useCallback(
        () =>
            setFitWhole((f) => {
                // Leaving free mode: clamp back so the image still fills the frame.
                if (f) setZoom((z) => Math.max(z, ZOOM_DEFAULT));
                return !f;
            }),
        []
    );
    const reset = resetTransforms;

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
            containerStyle: { borderRadius: '0.5rem' },
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

    const tool = (
        onClick: () => void,
        label: string,
        icon: ReactNode,
        active?: boolean
    ) => (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={onClick}
                        disabled={toolsDisabled}
                        aria-label={label}
                        aria-pressed={active}
                        className={cn(
                            'text-muted-foreground hover:text-foreground',
                            active && 'bg-muted text-foreground'
                        )}
                    >
                        {icon}
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );

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
                                                    {CROP_CORNER_HANDLES.map(
                                                        ({
                                                            corner,
                                                            direction,
                                                            resizeClassName,
                                                            rotateClassName
                                                        }) => (
                                                            <Fragment
                                                                key={corner}
                                                            >
                                                                <span
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
                                                                    <span className="group-hover:bg-primary size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.65)] transition-colors" />
                                                                </span>
                                                                <span
                                                                    data-crop-rotation-handle={
                                                                        corner
                                                                    }
                                                                    className={cn(
                                                                        'absolute z-20 size-11 cursor-grab touch-none active:cursor-grabbing',
                                                                        rotateClassName
                                                                    )}
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
                                                                />
                                                            </Fragment>
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
                                                                        'group-hover:bg-primary rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.65)] transition-colors',
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

                        <div
                            className="bg-muted/40 flex flex-wrap items-center justify-center gap-2 rounded-xl border p-1.5"
                            role="toolbar"
                            aria-label={t('dialog.image_crop.toolbar_label', {
                                defaultValue: 'Image crop toolbar'
                            })}
                        >
                            <div className="bg-background/50 flex items-center gap-0.5 rounded-lg border p-1">
                                {tool(
                                    rotateLeft,
                                    t('dialog.image_crop.rotate_left'),
                                    <RotateCcw />
                                )}
                                {tool(
                                    rotateRight,
                                    t('dialog.image_crop.rotate_right'),
                                    <RotateCw />
                                )}
                                <Separator
                                    orientation="vertical"
                                    className="mx-0.5 !h-5"
                                />
                                {tool(
                                    doFlipH,
                                    t('dialog.image_crop.flip_h'),
                                    <FlipHorizontal2 />,
                                    flipH
                                )}
                                {tool(
                                    doFlipV,
                                    t('dialog.image_crop.flip_v'),
                                    <FlipVertical2 />,
                                    flipV
                                )}
                            </div>

                            <div className="bg-background/50 flex items-center gap-1 rounded-lg border py-1 pr-1 pl-1.5">
                                {tool(
                                    zoomOut,
                                    t('dialog.image_crop.zoom_out'),
                                    <ZoomOut />
                                )}
                                <div className="w-24 sm:w-36">
                                    <Slider
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={[zoomSliderValue]}
                                        disabled={toolsDisabled}
                                        onValueChange={onZoomSlider}
                                        aria-label={t(
                                            'dialog.image_crop.zoom_level'
                                        )}
                                    />
                                </div>
                                <span className="text-muted-foreground w-10 text-right font-mono text-xs tabular-nums">
                                    {zoomPercent}%
                                </span>
                                {tool(
                                    zoomIn,
                                    t('dialog.image_crop.zoom_in'),
                                    <ZoomIn />
                                )}
                            </div>

                            <div className="bg-background/50 flex items-center gap-0.5 rounded-lg border p-1">
                                {tool(
                                    toggleFit,
                                    fitLabel,
                                    fitWhole ? <Minimize2 /> : <Maximize2 />,
                                    fitWhole
                                )}
                                {tool(
                                    reset,
                                    t('dialog.image_crop.reset'),
                                    <RefreshCcw />
                                )}
                            </div>
                        </div>

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
