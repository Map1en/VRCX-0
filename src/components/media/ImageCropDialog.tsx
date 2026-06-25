import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    computeAspectCrop,
    cropImageFileToAspect,
    validateImageUploadFile
} from '@/shared/utils/imageUpload';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';

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

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
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
        setImageBitmap(null);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
        createImageBitmap(file)
            .then((nextBitmap: any) => {
                if (!active) {
                    nextBitmap.close();
                    return;
                }
                setImageBitmap(nextBitmap);
            })
            .catch(() => {
                if (active) {
                    setImageBitmap(null);
                }
            });
        return () => {
            active = false;
            // A published ImageBitmap stays owned by React state; closing it here
            // can detach the canvas source during React effect replay.
        };
    }, [file, open]);

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
        try {
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
        } catch (error) {
            if (
                error &&
                typeof error === 'object' &&
                'name' in error &&
                error.name === 'InvalidStateError'
            ) {
                setImageBitmap(null);
                return;
            }
            throw error;
        }
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
            const uploadOptions: any = {};
            if (noteEnabled) {
                uploadOptions.note = note.slice(0, noteMaxLength);
            }
            if (cropWhiteBorderEnabled) {
                uploadOptions.cropWhiteBorder = cropWhiteBorder;
            }
            await onConfirm?.(
                blob,
                Object.keys(uploadOptions).length > 0
                    ? uploadOptions
                    : undefined
            );
        } finally {
            setIsConfirming(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{resolvedDescription}</DialogDescription>
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
                                aria-label={t(
                                    'message.image.success.selected_upload_preview'
                                )}
                                className="h-full w-full object-cover"
                            />
                        ) : null}
                    </div>
                    <FieldGroup className="grid gap-4 md:grid-cols-3">
                        <Field>
                            <FieldLabel htmlFor="image-crop-zoom">
                                {t('message.image.label.zoom')}
                            </FieldLabel>
                            <Slider
                                id="image-crop-zoom"
                                min={1}
                                max={3}
                                step={0.05}
                                value={[zoom]}
                                onValueChange={([value]: any) =>
                                    setZoom(Number(value) || 1)
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="image-crop-offset-x">
                                {t('message.image.label.horizontal')}
                            </FieldLabel>
                            <Slider
                                id="image-crop-offset-x"
                                min={-100}
                                max={100}
                                step={1}
                                value={[offsetX]}
                                onValueChange={([value]: any) =>
                                    setOffsetX(Number(value) || 0)
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="image-crop-offset-y">
                                {t('message.image.label.vertical')}
                            </FieldLabel>
                            <Slider
                                id="image-crop-offset-y"
                                min={-100}
                                max={100}
                                step={1}
                                value={[offsetY]}
                                onValueChange={([value]: any) =>
                                    setOffsetY(Number(value) || 0)
                                }
                            />
                        </Field>
                    </FieldGroup>
                    {noteEnabled ? (
                        <Field>
                            <FieldLabel htmlFor="image-crop-upload-note">
                                {noteField.label}
                            </FieldLabel>
                            <Input
                                id="image-crop-upload-note"
                                maxLength={noteMaxLength}
                                value={note}
                                onChange={(event: any) =>
                                    setNote(
                                        String(event.target.value || '').slice(
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
                        <Field orientation="horizontal" className="h-9 w-auto">
                            <Checkbox
                                id="image-crop-white-border"
                                checked={cropWhiteBorder}
                                onCheckedChange={(value: any) =>
                                    setCropWhiteBorder(Boolean(value))
                                }
                            />
                            <FieldLabel htmlFor="image-crop-white-border">
                                {cropWhiteBorderField.label}
                            </FieldLabel>
                        </Field>
                    ) : null}
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
                        onClick={() => {
                            confirmCrop();
                        }}
                    >
                        {isConfirming ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {t('message.image.action.upload')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
