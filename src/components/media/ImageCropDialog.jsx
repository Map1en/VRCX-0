import { useEffect, useMemo, useRef, useState } from 'react';

import { computeAspectCrop, cropImageFileToAspect, validateImageUploadFile } from '@/shared/utils/imageUpload.js';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Label } from '@/ui/shadcn/label.jsx';

export function ImageCropDialog({
    open,
    title = 'Crop image',
    description = 'Adjust the crop before upload.',
    file,
    aspectRatio = 1,
    onOpenChange,
    onConfirm
}) {
    const canvasRef = useRef(null);
    const [imageBitmap, setImageBitmap] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [isConfirming, setIsConfirming] = useState(false);

    useEffect(() => {
        if (!open || !file || !validateImageUploadFile(file).ok || typeof createImageBitmap !== 'function') {
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

        const crop = computeAspectCrop(imageBitmap.width, imageBitmap.height, aspectRatio, {
            zoom,
            offsetX: offsetX / 100,
            offsetY: offsetY / 100
        });
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

    const frameStyle = useMemo(
        () => ({
            aspectRatio: String(aspectRatio || 1)
        }),
        [aspectRatio]
    );

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
                <div className="space-y-4">
                    <div
                        className="relative max-h-[60vh] overflow-hidden rounded-lg border bg-muted"
                        style={frameStyle}>
                        {imageBitmap ? (
                            <canvas
                                ref={canvasRef}
                                role="img"
                                aria-label="Selected upload preview"
                                className="h-full w-full object-cover"
                            />
                        ) : null}
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <Label>Zoom</Label>
                            <Input
                                type="range"
                                min="1"
                                max="3"
                                step="0.05"
                                value={zoom}
                                onChange={(event) => setZoom(Number(event.target.value) || 1)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Horizontal</Label>
                            <Input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                value={offsetX}
                                onChange={(event) => setOffsetX(Number(event.target.value) || 0)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Vertical</Label>
                            <Input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                value={offsetY}
                                onChange={(event) => setOffsetY(Number(event.target.value) || 0)}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={isConfirming} onClick={() => onOpenChange?.(false)}>
                        Cancel
                    </Button>
                    <Button disabled={isConfirming || !file} onClick={() => void confirmCrop()}>
                        Upload
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
