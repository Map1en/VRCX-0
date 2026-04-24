import { useEffect, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';
import {
    computeAspectCrop,
    cropImageFileToAspect,
    validateImageUploadFile
} from '@/shared/utils/imageUpload.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';

export function ImageCropDialog({
    open,
    title = 'Crop image',
    description = 'Adjust the crop before upload.',
    file,
    aspectRatio = 1,
    onOpenChange,
    onConfirm
}) {
    const { t } = useTranslation();

    const canvasRef = useRef(null);
    const [imageBitmap, setImageBitmap] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [isConfirming, setIsConfirming] = useState(false);

    useEffect(() => {
        if (
            !open ||
            !file ||
            !validateImageUploadFile(file).ok ||
            typeof createImageBitmap !== 'function'
        ) {
            setImageBitmap(null);
            return undefined;
        }

        let active = true;
        let bitmap = null;
        setImageBitmap(null);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
        createImageBitmap(file)
            .then((nextBitmap) => {
                if (!active) {
                    nextBitmap.close();
                    return;
                }
                bitmap = nextBitmap;
                setImageBitmap(nextBitmap);
            })
            .catch(() => {
                if (active) {
                    setImageBitmap(null);
                }
            });
        return () => {
            active = false;
            bitmap?.close();
        };
    }, [file, open]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imageBitmap) {
            return;
        }

        const crop = computeAspectCrop(
            imageBitmap.width,
            imageBitmap.height,
            aspectRatio,
            {
                zoom,
                offsetX: offsetX / 100,
                offsetY: offsetY / 100
            }
        );
        canvas.width = crop.width;
        canvas.height = crop.height;
        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }
        context.clearRect(0, 0, crop.width, crop.height);
        context.drawImage(
            imageBitmap,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height
        );
    }, [aspectRatio, imageBitmap, offsetX, offsetY, zoom]);

    async function confirmCrop() {
        if (!file || !validateImageUploadFile(file).ok) {
            return;
        }

        setIsConfirming(true);
        try {
            const blob = await cropImageFileToAspect(file, aspectRatio, {
                zoom,
                offsetX: offsetX / 100,
                offsetY: offsetY / 100
            });
            await onConfirm?.(blob);
        } finally {
            setIsConfirming(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div
                        className="bg-muted relative max-h-[60vh] overflow-hidden rounded-lg border"
                        style={{ aspectRatio: String(aspectRatio || 1) }}
                    >
                        {imageBitmap ? (
                            <canvas
                                ref={canvasRef}
                                role="img"
                                aria-label={"Selected upload preview"}
                                className="h-full w-full object-cover"
                            />
                        ) : null}
                    </div>
                    <FieldGroup className="grid gap-4 md:grid-cols-3">
                        <Field>
                            <FieldLabel htmlFor="image-crop-zoom">
                                {t('message.image.generated.zoom')}
                            </FieldLabel>
                            <Slider
                                id="image-crop-zoom"
                                min={1}
                                max={3}
                                step={0.05}
                                value={[zoom]}
                                onValueChange={([value]) =>
                                    setZoom(Number(value) || 1)
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="image-crop-offset-x">
                                {t('message.image.generated.horizontal')}
                            </FieldLabel>
                            <Slider
                                id="image-crop-offset-x"
                                min={-100}
                                max={100}
                                step={1}
                                value={[offsetX]}
                                onValueChange={([value]) =>
                                    setOffsetX(Number(value) || 0)
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="image-crop-offset-y">
                                {t('message.image.generated.vertical')}
                            </FieldLabel>
                            <Slider
                                id="image-crop-offset-y"
                                min={-100}
                                max={100}
                                step={1}
                                value={[offsetY]}
                                onValueChange={([value]) =>
                                    setOffsetY(Number(value) || 0)
                                }
                            />
                        </Field>
                    </FieldGroup>
                </div>
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
                        onClick={() => void confirmCrop()}
                    >
                        {isConfirming ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {t('message.image.generated.upload')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
