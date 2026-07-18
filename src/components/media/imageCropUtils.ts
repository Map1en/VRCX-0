import type { Area, Point, Size } from 'react-easy-crop';

const MAX_PREVIEW_SIZE = 800;

export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function computeCropRect(
    croppedAreaPixels: Area,
    previewScale: number
): CropRect {
    return {
        x: Math.round(croppedAreaPixels.x / previewScale),
        y: Math.round(croppedAreaPixels.y / previewScale),
        width: Math.round(croppedAreaPixels.width / previewScale),
        height: Math.round(croppedAreaPixels.height / previewScale)
    };
}

export function isNoopCrop(
    rect: CropRect,
    imgWidth: number,
    imgHeight: number
): boolean {
    return (
        rect.x <= 1 &&
        rect.y <= 1 &&
        Math.abs(rect.width - imgWidth) <= 1 &&
        Math.abs(rect.height - imgHeight) <= 1
    );
}

function rotatedCropHalfExtents(cropSize: Size, rotation: number): Point {
    const angle = (rotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(angle));
    const absSin = Math.abs(Math.sin(angle));
    return {
        x: (cropSize.width * absCos + cropSize.height * absSin) / 2,
        y: (cropSize.width * absSin + cropSize.height * absCos) / 2
    };
}

export function getRotationCoverZoom(
    mediaSize: Size,
    cropSize: Size,
    rotation: number
): number {
    if (mediaSize.width <= 0 || mediaSize.height <= 0) return 1;
    const extents = rotatedCropHalfExtents(cropSize, rotation);
    return Math.max(
        (extents.x * 2) / mediaSize.width,
        (extents.y * 2) / mediaSize.height
    );
}

export function constrainCropToImage(
    position: Point,
    mediaSize: Size,
    cropSize: Size,
    zoom: number,
    rotation: number
): Point {
    const angle = (rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const extents = rotatedCropHalfExtents(cropSize, rotation);
    const maxX = Math.max(0, (mediaSize.width * zoom) / 2 - extents.x);
    const maxY = Math.max(0, (mediaSize.height * zoom) / 2 - extents.y);
    const localX = Math.max(
        -maxX,
        Math.min(maxX, position.x * cos + position.y * sin)
    );
    const localY = Math.max(
        -maxY,
        Math.min(maxY, -position.x * sin + position.y * cos)
    );
    return {
        x: localX * cos - localY * sin,
        y: localX * sin + localY * cos
    };
}

// react-easy-crop's `transform` prop replaces its default entirely, so the pan
// (translate), rotation (rotateZ) and zoom (scale) must be rebuilt here or the
// preview loses them; the flips are layered on top as rotateY/rotateX.
export function buildMediaTransform(
    cropX: number,
    cropY: number,
    rotation: number,
    flipH: boolean,
    flipV: boolean,
    zoom: number
): string {
    return [
        `translate(${cropX}px, ${cropY}px)`,
        `rotateZ(${rotation}deg)`,
        `rotateY(${flipH ? 180 : 0}deg)`,
        `rotateX(${flipV ? 180 : 0}deg)`,
        `scale(${zoom})`
    ].join(' ');
}

function applyTransforms(
    img: HTMLImageElement | HTMLCanvasElement,
    angleDeg: number,
    flipH: boolean,
    flipV: boolean
): HTMLCanvasElement {
    const angleRad = (angleDeg * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(angleRad));
    const absSin = Math.abs(Math.sin(angleRad));
    const rotW = Math.round(img.width * absCos + img.height * absSin);
    const rotH = Math.round(img.width * absSin + img.height * absCos);

    const cvs = document.createElement('canvas');
    cvs.width = rotW;
    cvs.height = rotH;
    const ctx = cvs.getContext('2d')!;
    ctx.translate(rotW / 2, rotH / 2);
    ctx.rotate(angleRad);
    if (flipH) ctx.scale(-1, 1);
    if (flipV) ctx.scale(1, -1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return cvs;
}

export async function cropImage(
    originalImg: HTMLImageElement,
    previewScale: number,
    croppedAreaPixels: Area,
    rotation: number,
    flipH: boolean,
    flipV: boolean,
    originalFile: File
): Promise<Blob> {
    const hasTransform = rotation !== 0 || flipH || flipV;
    const rect = computeCropRect(croppedAreaPixels, previewScale);

    if (
        !hasTransform &&
        isNoopCrop(rect, originalImg.width, originalImg.height)
    ) {
        return originalFile;
    }

    const source: HTMLImageElement | HTMLCanvasElement = hasTransform
        ? applyTransforms(originalImg, rotation, flipH, flipV)
        : originalImg;

    const out = document.createElement('canvas');
    out.width = rect.width;
    out.height = rect.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(source, -rect.x, -rect.y);

    return new Promise<Blob>((resolve, reject) => {
        out.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Export failed.'))),
            'image/png'
        );
    });
}

export async function prepareImage(file: File): Promise<{
    img: HTMLImageElement;
    previewSrc: string;
    previewScale: number;
}> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onerror = () => reject(new Error('Failed to decode image.'));
            img.onload = () => {
                const { width, height } = img;
                if (width > MAX_PREVIEW_SIZE || height > MAX_PREVIEW_SIZE) {
                    const scale = Math.min(
                        MAX_PREVIEW_SIZE / width,
                        MAX_PREVIEW_SIZE / height
                    );
                    const cvs = document.createElement('canvas');
                    cvs.width = Math.round(width * scale);
                    cvs.height = Math.round(height * scale);
                    cvs.getContext('2d')!.drawImage(
                        img,
                        0,
                        0,
                        cvs.width,
                        cvs.height
                    );
                    resolve({
                        img,
                        previewSrc: cvs.toDataURL('image/jpeg', 0.9),
                        previewScale: scale
                    });
                } else {
                    resolve({ img, previewSrc: dataUrl, previewScale: 1 });
                }
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
}
