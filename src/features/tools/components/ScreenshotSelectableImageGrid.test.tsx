// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    renderedPaths: [] as string[],
    toggleSelectByPath: new Map<
        string,
        (checked: boolean, shift: boolean) => void
    >(),
    visibleRows: [] as Array<{
        key: string;
        top: number;
        items: ScreenshotLibraryImage[];
    }>
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/media/useScreenshotGalleryGrid', () => ({
    GALLERY_GRID_SECTION_HEADER_HEIGHT: 40,
    useScreenshotGalleryGrid: () => ({
        gridColumnCount: 3,
        gridGap: 0,
        gridMinWidth: 0,
        rows: mocks.visibleRows,
        setScrollTop: () => undefined,
        totalHeight: 0,
        viewportMetrics: { scrollTop: 0, viewportHeight: 0, width: 0 },
        viewportRef: { current: null },
        visibleRows: mocks.visibleRows
    })
}));

vi.mock('@/components/media/ScreenshotThumbnailCard', () => ({
    useScreenshotThumbnailTitleMap: () => new Map<string, string>(),
    ScreenshotThumbnailCard: ({
        item,
        onToggleSelect
    }: {
        item: { path: string };
        onToggleSelect: (checked: boolean, shift: boolean) => void;
    }) => {
        mocks.renderedPaths.push(item.path);
        mocks.toggleSelectByPath.set(item.path, onToggleSelect);
        return null;
    }
}));

import { ScreenshotSelectableImageGrid } from './ScreenshotSelectableImageGrid';

function image(path: string): ScreenshotLibraryImage {
    return {
        path,
        folderPath: 'C:/shots',
        fileName: path,
        sizeBytes: 1,
        modifiedAt: 0,
        createdAt: null,
        width: null,
        height: null,
        worldId: null,
        worldName: null,
        capturedAt: null,
        capturedAtMs: 0,
        metadata: null,
        error: null
    };
}

const images = ['a.png', 'b.png', 'c.png'].map(image);
mocks.visibleRows = [{ key: 'row:0', top: 0, items: images }];

function renderGrid(
    selected: ReadonlySet<string>,
    onToggleSelect: (
        path: string,
        checked: boolean,
        shift: boolean
    ) => void = () => {}
) {
    return (
        <ScreenshotSelectableImageGrid
            density="standard"
            images={images}
            initialScrollTop={0}
            resetKey="folder"
            hasSelection={selected.size > 0}
            selectedKeysSet={selected}
            onOpen={() => {}}
            onToggleSelect={onToggleSelect}
        />
    );
}

describe('ScreenshotSelectableImageGrid', () => {
    afterEach(() => {
        cleanup();
        mocks.renderedPaths.length = 0;
    });

    it('re-renders only the tiles whose selection changed', () => {
        const firstSelection = new Set(['a.png']);
        const view = render(renderGrid(firstSelection));
        mocks.renderedPaths.length = 0;

        view.rerender(renderGrid(new Set(['a.png'])));
        expect(mocks.renderedPaths).toEqual([]);

        view.rerender(renderGrid(new Set(['a.png', 'b.png'])));
        expect(mocks.renderedPaths).toEqual(['b.png']);
    });

    it('routes tile selection to the latest handler after the grid re-renders', () => {
        const selected = new Set<string>();
        const view = render(renderGrid(selected));
        const latestToggle = vi.fn();

        view.rerender(renderGrid(selected, latestToggle));
        mocks.toggleSelectByPath.get('c.png')?.(true, true);

        expect(latestToggle).toHaveBeenCalledWith('c.png', true, true);
    });
});
