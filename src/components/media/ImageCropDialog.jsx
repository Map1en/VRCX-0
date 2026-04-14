import { useEffect, useMemo, useState } from 'react';

import { cropImageFileToAspect } from '@/shared/utils/imageUpload.js';
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
    const [imageUrl, setImageUrl] = useState('');
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [isConfirming, setIsConfirming] = useState(false);

    useEffect(() => {
        if (!open || !file) {
            setImageUrl('');
            return undefined;
        }

        const nextUrl = URL.createObjectURL(file);
        setImageUrl(nextUrl);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
        return () => URL.revokeObjectURL(nextUrl);
    }, [file, open]);

    const frameStyle = useMemo(
        () => ({
            aspectRatio: String(aspectRatio || 1)
        }),
        [aspectRatio]
    );

    async function confirmCrop() {
        if (!file) {
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
                        {imageUrl ? (
                            <img
                                src={imageUrl}
                                alt={file?.name || 'Selected upload'}
                                className="h-full w-full object-cover"
                                style={{
                                    transform: `translate(${-offsetX / 6}%, ${-offsetY / 6}%) scale(${zoom})`
                                }}
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
