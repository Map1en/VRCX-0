import { describe, expect, it } from 'vitest';

import { resolveScreenshotGridRevealScrollTop } from './useScreenshotGalleryGrid';

const rows = Array.from({ length: 20 }, (_, index) => ({
    top: index * 190,
    height: 190
}));

describe('resolveScreenshotGridRevealScrollTop', () => {
    it('keeps the scroll position when the item row is already visible', () => {
        expect(
            resolveScreenshotGridRevealScrollTop({
                index: 9,
                columnCount: 4,
                rows,
                scrollTop: 300,
                viewportHeight: 600
            })
        ).toBeNull();
    });

    it('centers the item row when it is outside the viewport', () => {
        expect(
            resolveScreenshotGridRevealScrollTop({
                index: 41,
                columnCount: 4,
                rows,
                scrollTop: 0,
                viewportHeight: 600
            })
        ).toBe(10 * 190 - (600 - 190) / 2);
    });

    it('clamps to the top and ignores unknown items', () => {
        expect(
            resolveScreenshotGridRevealScrollTop({
                index: 0,
                columnCount: 4,
                rows,
                scrollTop: 2000,
                viewportHeight: 600
            })
        ).toBe(0);
        expect(
            resolveScreenshotGridRevealScrollTop({
                index: -1,
                columnCount: 4,
                rows,
                scrollTop: 0,
                viewportHeight: 600
            })
        ).toBeNull();
    });
});
