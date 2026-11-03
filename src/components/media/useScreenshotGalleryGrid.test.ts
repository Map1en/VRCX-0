import { describe, expect, it } from 'vitest';

import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import {
    buildGalleryGridRows,
    GALLERY_GRID_SECTION_HEADER_HEIGHT,
    resolveScreenshotGridRevealScrollTop
} from './useScreenshotGalleryGrid';

const rows = Array.from({ length: 20 }, (_, index) => ({
    top: index * 190,
    height: 190
}));

function image(fileName: string, day: string): ScreenshotLibraryImage {
    return {
        path: `C:\\VRChat\\${fileName}`,
        folderPath: 'C:\\VRChat',
        fileName,
        sizeBytes: 1,
        modifiedAt: 1,
        createdAt: null,
        width: null,
        height: null,
        worldId: null,
        worldName: day,
        capturedAt: null,
        capturedAtMs: 1,
        metadata: null,
        error: null
    };
}

describe('resolveScreenshotGridRevealScrollTop', () => {
    it('keeps the scroll position when the item row is already visible', () => {
        expect(
            resolveScreenshotGridRevealScrollTop({
                rowIndex: 2,
                rows,
                scrollTop: 300,
                viewportHeight: 600
            })
        ).toBeNull();
    });

    it('centers the item row when it is outside the viewport', () => {
        expect(
            resolveScreenshotGridRevealScrollTop({
                rowIndex: 10,
                rows,
                scrollTop: 0,
                viewportHeight: 600
            })
        ).toBe(10 * 190 - (600 - 190) / 2);
    });

    it('clamps to the top and ignores unknown items', () => {
        expect(
            resolveScreenshotGridRevealScrollTop({
                rowIndex: 0,
                rows,
                scrollTop: 2000,
                viewportHeight: 600
            })
        ).toBe(0);
        expect(
            resolveScreenshotGridRevealScrollTop({
                rowIndex: -1,
                rows,
                scrollTop: 0,
                viewportHeight: 600
            })
        ).toBeNull();
    });
});

describe('buildGalleryGridRows', () => {
    it('starts every section on a fresh row under its own header', () => {
        const items = [
            image('a.png', '2026-07-04'),
            image('b.png', '2026-07-04'),
            image('c.png', '2026-07-04'),
            image('d.png', '2026-07-03')
        ];
        const { rows: built, totalHeight } = buildGalleryGridRows({
            cardHeight: 100,
            gridColumnCount: 2,
            gridGap: 10,
            items,
            sectionOf: (item) => ({
                key: item.worldName ?? '',
                label: `day ${item.worldName}`
            })
        });

        expect(
            built.map((row) =>
                row.section
                    ? `${row.section.label} (${row.section.count})`
                    : row.items.map((item) => item.fileName).join(',')
            )
        ).toEqual([
            'day 2026-07-04 (3)',
            'a.png,b.png',
            'c.png',
            'day 2026-07-03 (1)',
            'd.png'
        ]);
        expect(built.map((row) => row.top)).toEqual([
            0,
            GALLERY_GRID_SECTION_HEADER_HEIGHT,
            GALLERY_GRID_SECTION_HEADER_HEIGHT + 110,
            GALLERY_GRID_SECTION_HEADER_HEIGHT + 220,
            GALLERY_GRID_SECTION_HEADER_HEIGHT * 2 + 220
        ]);
        expect(totalHeight).toBe(GALLERY_GRID_SECTION_HEADER_HEIGHT * 2 + 320);
    });
});
