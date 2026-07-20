import { describe, expect, it } from 'vitest';

import {
    buildMediaTransform,
    constrainCropSizeToZoom,
    constrainCropToImage,
    computeCropRect,
    getContinuousRotationDeltaDegrees,
    getRotationCoverZoom,
    isNoopCrop,
    resizeCropSize,
    resizeCropSizeFromCorner
} from './imageCropUtils';

describe('getContinuousRotationDeltaDegrees', () => {
    it('unwraps the atan2 boundary while rotating clockwise', () => {
        expect(
            getContinuousRotationDeltaDegrees(
                (179 * Math.PI) / 180,
                (-179 * Math.PI) / 180
            )
        ).toBeCloseTo(2);
    });

    it('unwraps the atan2 boundary while rotating counterclockwise', () => {
        expect(
            getContinuousRotationDeltaDegrees(
                (-179 * Math.PI) / 180,
                (179 * Math.PI) / 180
            )
        ).toBeCloseTo(-2);
    });
});

describe('resizeCropSize', () => {
    it('resizes from a horizontal edge while preserving aspect ratio', () => {
        expect(
            resizeCropSize(
                { width: 200, height: 100 },
                'horizontal',
                25,
                { width: 500, height: 300 },
                2,
                50
            )
        ).toEqual({ width: 250, height: 125 });
    });

    it('resizes from a vertical edge while preserving aspect ratio', () => {
        expect(
            resizeCropSize(
                { width: 200, height: 100 },
                'vertical',
                -20,
                { width: 500, height: 300 },
                2,
                50
            )
        ).toEqual({ width: 120, height: 60 });
    });

    it('resizes from a corner along the crop diagonal', () => {
        expect(
            resizeCropSizeFromCorner(
                { width: 200, height: 100 },
                { x: 25, y: 12.5 },
                { x: 1, y: 1 },
                { width: 500, height: 300 },
                2,
                50
            )
        ).toEqual({ width: 250, height: 125 });
    });

    it('clamps the crop to its container and minimum short edge', () => {
        const bounds = { width: 320, height: 180 };

        expect(
            resizeCropSize(
                { width: 240, height: 135 },
                'horizontal',
                100,
                bounds,
                16 / 9,
                54
            )
        ).toEqual({ width: 320, height: 180 });
        expect(
            resizeCropSize(
                { width: 240, height: 135 },
                'vertical',
                -100,
                bounds,
                16 / 9,
                54
            )
        ).toEqual({ width: 96, height: 54 });
    });
});

describe('computeCropRect', () => {
    it('returns preview-space pixels unchanged when previewScale is 1', () => {
        expect(
            computeCropRect({ x: 10, y: 20, width: 300, height: 200 }, 1)
        ).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    });

    it('maps downscaled preview pixels back to original resolution', () => {
        // large image downscaled to 25% for preview
        expect(
            computeCropRect({ x: 50, y: 100, width: 200, height: 150 }, 0.25)
        ).toEqual({ x: 200, y: 400, width: 800, height: 600 });
    });

    it('rounds fractional results', () => {
        expect(
            computeCropRect({ x: 3, y: 3, width: 10, height: 10 }, 0.3)
        ).toEqual({ x: 10, y: 10, width: 33, height: 33 });
    });
});

describe('isNoopCrop', () => {
    it('is true when the crop covers the whole image', () => {
        expect(
            isNoopCrop({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080)
        ).toBe(true);
    });

    it('tolerates 1px rounding drift on origin and size', () => {
        expect(
            isNoopCrop({ x: 1, y: 1, width: 1921, height: 1079 }, 1920, 1080)
        ).toBe(true);
    });

    it('is false when the crop is inset from the origin', () => {
        expect(
            isNoopCrop({ x: 100, y: 0, width: 1820, height: 1080 }, 1920, 1080)
        ).toBe(false);
    });

    it('is false when the crop is smaller than the image', () => {
        expect(
            isNoopCrop({ x: 0, y: 0, width: 960, height: 540 }, 1920, 1080)
        ).toBe(false);
    });
});

describe('buildMediaTransform', () => {
    it('always keeps pan, rotation and zoom so the preview is not lost', () => {
        const out = buildMediaTransform(10, -20, 90, false, false, 2);
        expect(out).toContain('translate(10px, -20px)');
        expect(out).toContain('rotateZ(90deg)');
        expect(out).toContain('scale(2)');
    });

    it('applies horizontal and vertical flips independently', () => {
        expect(buildMediaTransform(0, 0, 0, true, false, 1)).toContain(
            'rotateY(180deg)'
        );
        expect(buildMediaTransform(0, 0, 0, false, true, 1)).toContain(
            'rotateX(180deg)'
        );
    });

    it('uses 0deg flips when not flipped', () => {
        const out = buildMediaTransform(0, 0, 0, false, false, 1);
        expect(out).toContain('rotateY(0deg)');
        expect(out).toContain('rotateX(0deg)');
    });
});

describe('rotated crop constraints', () => {
    it('does not enlarge the minimum zoom when a crop edge is dragged outward', () => {
        const mediaSize = { width: 300, height: 400 };
        const resized = resizeCropSize(
            { width: 200, height: 200 },
            'horizontal',
            100,
            { width: 700, height: 400 },
            1,
            56
        );

        expect(getRotationCoverZoom(mediaSize, resized, 0)).toBeCloseTo(4 / 3);
        expect(constrainCropSizeToZoom(resized, mediaSize, 1, 0)).toEqual({
            width: 300,
            height: 300
        });
    });

    it('zooms a square image enough to cover its crop at 45 degrees', () => {
        expect(
            getRotationCoverZoom(
                { width: 200, height: 200 },
                { width: 200, height: 200 },
                45
            )
        ).toBeCloseTo(Math.SQRT2);
    });

    it('keeps crop movement inside the rotated image edges', () => {
        const position = constrainCropToImage(
            { x: 200, y: 0 },
            { width: 400, height: 300 },
            { width: 200, height: 100 },
            1,
            45
        );
        const angle = Math.PI / 4;
        const localX =
            position.x * Math.cos(angle) + position.y * Math.sin(angle);
        const localY =
            -position.x * Math.sin(angle) + position.y * Math.cos(angle);
        const extent = (200 + 100) / Math.SQRT2 / 2;

        expect(Math.abs(localX) + extent).toBeLessThanOrEqual(200);
        expect(Math.abs(localY) + extent).toBeLessThanOrEqual(150);
    });
});
