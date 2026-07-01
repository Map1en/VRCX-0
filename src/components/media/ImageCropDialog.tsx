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
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
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
import { Separator } from '@/ui/shadcn/separator';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

import { buildMediaTransform, cropImage, prepareImage } from './imageCropUtils';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 5;
const ZOOM_DEFAULT = 1;
const ZOOM_FACTOR = 1.2;
const LOG_ZOOM_MAX = Math.log(ZOOM_MAX);
const CONTAINER_STYLE = {
    containerStyle: { borderRadius: '0.5rem' }
} as const;

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
}: any) {
    const { t } = useTranslation();

    const originalImgRef = useRef<HTMLImageElement | null>(null);
    const previewScaleRef = useRef<number>(1);
    const cropWrapperRef = useRef<HTMLDivElement | null>(null);

    const [previewSrc, setPreviewSrc] = useState<string>('');
    const [cropperReady, setCropperReady] = useState(false);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(ZOOM_DEFAULT);
    const [rotation, setRotation] = useState(0);
    const [flipH, setFlipH] = useState(false);
    const [flipV, setFlipV] = useState(false);
    const [fitWhole, setFitWhole] = useState(false);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
        null
    );

    const [note, setNote] = useState('');
    const [cropWhiteBorder, setCropWhiteBorder] = useState(true);
    const [isConfirming, setIsConfirming] = useState(false);

    const resolvedTitle = title || t('message.image.label.crop_image');
    const resolvedDescription =
        description || t('message.image.description.crop_description');
    const noteEnabled = Boolean(noteField);
    const noteMaxLength = Number(noteField?.maxLength) || 32;
    const cropWhiteBorderEnabled = Boolean(cropWhiteBorderField);
    const cropWhiteBorderDefault =
        cropWhiteBorderField?.defaultChecked !== false;
    const aspect = Number(aspectRatio) || 1;

    // Fixed mode keeps the image covering the crop frame (min zoom == fill); only
    // free mode lets it shrink below the frame, mirroring the original's
    // image-restriction stencil/none split.
    const minZoom = fitWhole ? ZOOM_MIN : ZOOM_DEFAULT;
    const logZoomMin = Math.log(minZoom);

    const resetTransforms = useCallback(() => {
        setCrop({ x: 0, y: 0 });
        setZoom(ZOOM_DEFAULT);
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
        setFitWhole(false);
    }, []);

    useEffect(() => {
        resetTransforms();
        setCroppedAreaPixels(null);
        if (!open || !file || !validateImageUploadFile(file).ok) {
            setPreviewSrc('');
            originalImgRef.current = null;
            previewScaleRef.current = 1;
            return;
        }

        let cancelled = false;
        prepareImage(file)
            .then(({ img, previewSrc: src, previewScale }) => {
                if (cancelled) return;
                originalImgRef.current = img;
                previewScaleRef.current = previewScale;
                setPreviewSrc(src);
            })
            .catch(() => {
                if (!cancelled) setPreviewSrc('');
            });

        return () => {
            cancelled = true;
        };
    }, [file, open, resetTransforms]);

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

    const rotateBy = useCallback(
        (delta: number) =>
            setRotation((r) => (((r + delta) % 360) + 360) % 360),
        []
    );
    const rotateLeft = useCallback(() => rotateBy(-90), [rotateBy]);
    const rotateRight = useCallback(() => rotateBy(90), [rotateBy]);
    const doFlipH = useCallback(() => setFlipH((v) => !v), []);
    const doFlipV = useCallback(() => setFlipV((v) => !v), []);
    const zoomIn = useCallback(
        () => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_FACTOR)),
        []
    );
    const zoomOut = useCallback(
        () => setZoom((z) => Math.max(minZoom, z / ZOOM_FACTOR)),
        [minZoom]
    );
    const onZoomSlider = useCallback(
        (values: number[]) => {
            const pct = values[0] ?? 0;
            setZoom(
                Math.exp(logZoomMin + (pct / 100) * (LOG_ZOOM_MAX - logZoomMin))
            );
        },
        [logZoomMin]
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
                rotation,
                flipH,
                flipV,
                file
            );

            const opts: Record<string, unknown> = {};
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
        () => buildMediaTransform(crop.x, crop.y, rotation, flipH, flipV, zoom),
        [crop.x, crop.y, rotation, flipH, flipV, zoom]
    );

    const fitLabel = t(
        fitWhole ? 'dialog.image_crop.mode_fit' : 'dialog.image_crop.mode_free'
    );
    const toolsDisabled = !previewSrc || isConfirming;
    const zoomSliderValue =
        ((Math.log(zoom) - logZoomMin) / (LOG_ZOOM_MAX - logZoomMin)) * 100;
    const zoomPercent = Math.round(zoom * 100);
    const aspectLabel = formatAspect(aspect);
    const hudExtras = [
        rotation !== 0 ? `${rotation}°` : null,
        flipH || flipV ? `${flipH ? 'H' : ''}${flipV ? 'V' : ''}` : null
    ].filter(Boolean);

    const tool = (
        onClick: () => void,
        label: string,
        icon: ReactNode,
        active?: boolean
    ) => (
        <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{resolvedDescription}</DialogDescription>
                </DialogHeader>

                <TooltipProvider>
                    <div className="flex flex-col gap-4">
                        <div
                            ref={cropWrapperRef}
                            className="bg-muted/40 ring-border/60 relative flex items-center justify-center overflow-hidden rounded-xl border shadow-inner ring-1 ring-inset"
                            style={{ minHeight: '30vh' }}
                        >
                            {previewSrc && cropperReady ? (
                                <div
                                    className="bg-background/60 relative overflow-hidden rounded-lg"
                                    style={{
                                        aspectRatio: String(aspect),
                                        width: `min(100%, calc(50vh * ${aspect}))`
                                    }}
                                >
                                    <Cropper
                                        image={previewSrc}
                                        crop={crop}
                                        zoom={zoom}
                                        rotation={rotation}
                                        aspect={aspect}
                                        minZoom={minZoom}
                                        maxZoom={ZOOM_MAX}
                                        objectFit={
                                            fitWhole ? 'contain' : 'cover'
                                        }
                                        restrictPosition={!fitWhole}
                                        showGrid
                                        zoomWithScroll
                                        onCropChange={setCrop}
                                        onZoomChange={setZoom}
                                        onCropComplete={onCropComplete}
                                        transform={mediaTransform}
                                        style={CONTAINER_STYLE}
                                    />

                                    <span className="bg-background/70 text-muted-foreground ring-border pointer-events-none absolute top-2 left-2 z-10 rounded-md px-2 py-0.5 font-mono text-[11px] leading-none ring-1 backdrop-blur-sm">
                                        {aspectLabel}
                                    </span>
                                    <div className="bg-background/70 text-muted-foreground ring-border pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] leading-none tabular-nums ring-1 backdrop-blur-sm">
                                        <span className="text-foreground">
                                            {zoomPercent}%
                                        </span>
                                        {hudExtras.map((seg) => (
                                            <Fragment key={seg}>
                                                <span className="opacity-30">
                                                    ·
                                                </span>
                                                <span>{seg}</span>
                                            </Fragment>
                                        ))}
                                    </div>
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
                                <Slider
                                    className="w-24 sm:w-36"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={[zoomSliderValue]}
                                    disabled={toolsDisabled}
                                    onValueChange={onZoomSlider}
                                    aria-label={t('dialog.image_crop.zoom_in')}
                                />
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
                                    {noteField.label}
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
                                    placeholder={noteField.placeholder}
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
                                    {cropWhiteBorderField.label}
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
