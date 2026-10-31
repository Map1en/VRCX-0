// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import { useScreenshotBrowseImages } from './useScreenshotBrowseImages';

function image(fileName: string, capturedAt: string): ScreenshotLibraryImage {
    return {
        path: `C:/shots/${fileName}`,
        folderPath: 'C:/shots',
        fileName,
        sizeBytes: 1,
        modifiedAt: 0,
        createdAt: null,
        width: null,
        height: null,
        worldId: null,
        worldName: null,
        capturedAt,
        capturedAtMs: Date.parse(capturedAt),
        metadata: null,
        error: null
    };
}

const backendOrder = [
    image('a.png', '2026-08-02T10:00:00Z'),
    image('b.png', '2026-08-03T10:00:00Z'),
    image('c.png', '2026-08-01T10:00:00Z')
];

describe('useScreenshotBrowseImages', () => {
    beforeEach(() => localStorage.clear());
    afterEach(cleanup);

    it('orders selection paths the same way the grid displays them', () => {
        const { result } = renderHook(() =>
            useScreenshotBrowseImages(backendOrder)
        );

        expect(result.current.paths).toEqual([
            'C:/shots/b.png',
            'C:/shots/a.png',
            'C:/shots/c.png'
        ]);

        act(() => result.current.setSort('captured-asc'));

        expect(result.current.paths).toEqual([
            'C:/shots/c.png',
            'C:/shots/a.png',
            'C:/shots/b.png'
        ]);
        expect(result.current.images.map((entry) => entry.path)).toEqual(
            result.current.paths
        );
    });
});
