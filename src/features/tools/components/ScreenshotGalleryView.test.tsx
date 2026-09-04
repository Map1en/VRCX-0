// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    scrollIntoView: vi.fn(),
    visibleRows: [] as Array<{
        key: string;
        top: number;
        items: Array<{ path: string; fileName: string }>;
    }>
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string, values?: { count?: number }) =>
            values?.count === undefined ? key : `${key}:${values.count}`
    })
}));

vi.mock('@/components/media/useScreenshotGalleryGrid', () => ({
    useScreenshotGalleryGrid: () => ({
        gridColumnCount: 1,
        gridGap: 0,
        gridMinWidth: 0,
        totalHeight: 0,
        viewportRef: { current: null },
        visibleRows: mocks.visibleRows
    })
}));

vi.mock('@/components/media/ScreenshotThumbnailCard', () => ({
    ScreenshotThumbnailCard: ({
        item,
        selected,
        onToggleSelect
    }: {
        item: { path: string };
        selected?: boolean;
        onToggleSelect?: (checked: boolean, shift: boolean) => void;
    }) => (
        <button
            type="button"
            aria-pressed={Boolean(selected)}
            onClick={() => onToggleSelect?.(!selected, false)}
        >
            {item.path}
        </button>
    ),
    useScreenshotThumbnailTitleMap: () => new Map()
}));

import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import { useScreenshotBrowseSelection } from '../useScreenshotBrowseSelection';
import { ScreenshotGalleryView } from './ScreenshotGalleryView';

const folderTree = {
    rootPath: 'C:\\VRChat',
    folders: [
        {
            path: 'C:\\VRChat',
            parentPath: null,
            name: 'VRChat',
            imageCount: 0,
            totalImageCount: 61,
            latestModifiedAt: 2
        },
        {
            path: 'C:\\VRChat\\2024-05',
            parentPath: 'C:\\VRChat',
            name: '2024-05',
            imageCount: 55,
            totalImageCount: 55,
            latestModifiedAt: 1
        },
        {
            path: 'C:\\VRChat\\2026-07',
            parentPath: 'C:\\VRChat',
            name: '2026-07',
            imageCount: 6,
            totalImageCount: 6,
            latestModifiedAt: 2
        }
    ]
};

describe('ScreenshotGalleryView folder tree', () => {
    beforeEach(() => {
        mocks.scrollIntoView.mockReset();
        HTMLElement.prototype.scrollIntoView = mocks.scrollIntoView;
    });

    afterEach(cleanup);

    it('uses one folder row per node and reveals the selected folder', async () => {
        const onSelectFolder = vi.fn();
        const { container } = render(
            <GalleryHarness
                images={[]}
                selectedFolder={folderTree.folders[2].path}
                onDeleteSelection={() => undefined}
                onSelectFolder={onSelectFolder}
            />
        );

        await waitFor(() => {
            expect(container.querySelectorAll('aside nav button')).toHaveLength(
                3
            );
        });
        const selectedFolder = screen.getByRole('button', {
            name: '2026-07'
        });
        expect(selectedFolder.getAttribute('aria-current')).toBe('location');
        expect(mocks.scrollIntoView).toHaveBeenCalledWith({
            block: 'nearest',
            inline: 'nearest'
        });

        fireEvent.click(screen.getByRole('button', { name: '2024-05' }));
        expect(onSelectFolder).toHaveBeenCalledWith(folderTree.folders[1].path);
    });
});

function galleryImage(
    folder: string,
    fileName: string
): ScreenshotLibraryImage {
    return {
        path: `${folder}\\${fileName}`,
        folderPath: folder,
        fileName,
        sizeBytes: 1024,
        modifiedAt: 1,
        createdAt: null,
        width: 1920,
        height: 1080,
        worldId: null,
        worldName: null,
        capturedAt: null,
        metadata: null,
        error: null
    };
}

const julyFolder = folderTree.folders[2].path;
const mayFolder = folderTree.folders[1].path;
const galleryImages = [
    galleryImage(julyFolder, 'a.png'),
    galleryImage(julyFolder, 'b.png'),
    galleryImage(julyFolder, 'c.png')
];
const mayImages = [
    galleryImage(mayFolder, 'x.png'),
    galleryImage(mayFolder, 'y.png')
];

function GalleryHarness({
    images,
    selectedFolder,
    onDeleteSelection,
    onSelectFolder = () => undefined
}: {
    images: ScreenshotLibraryImage[];
    selectedFolder: string;
    onDeleteSelection: (paths: string[]) => void;
    onSelectFolder?: (folder: string) => void;
}) {
    const selection = useScreenshotBrowseSelection(
        images.map((image) => image.path)
    );
    return (
        <ScreenshotGalleryView
            folderTree={folderTree}
            images={images}
            isImagesLoading={false}
            isTreeLoading={false}
            error=""
            scanStatus={null}
            selectedFolder={selectedFolder}
            onOpenImage={() => undefined}
            onRefresh={() => undefined}
            onSelectFolder={onSelectFolder}
            onScrollPositionChange={() => undefined}
            onDeleteSelection={onDeleteSelection}
            onExportSelection={() => undefined}
            isDeleteRunning={false}
            restoreScrollTop={0}
            selection={selection}
        />
    );
}

function renderGalleryWithImages(onDeleteSelection = vi.fn()) {
    mocks.visibleRows = [{ key: 'row-0', top: 0, items: galleryImages }];
    const view = render(
        <GalleryHarness
            images={galleryImages}
            selectedFolder={julyFolder}
            onDeleteSelection={onDeleteSelection}
        />
    );
    return {
        onDeleteSelection,
        openFolder(images: ScreenshotLibraryImage[], folder: string) {
            mocks.visibleRows = [{ key: 'row-0', top: 0, items: images }];
            view.rerender(
                <GalleryHarness
                    images={images}
                    selectedFolder={folder}
                    onDeleteSelection={onDeleteSelection}
                />
            );
        }
    };
}

describe('ScreenshotGalleryView selection', () => {
    beforeEach(() => {
        HTMLElement.prototype.scrollIntoView = mocks.scrollIntoView;
    });

    afterEach(() => {
        cleanup();
        mocks.visibleRows = [];
    });

    it('shows the selection bar once tiles are selected and hides it when cleared', () => {
        renderGalleryWithImages();

        expect(
            screen.queryByText('view.tools.gallery_selection.count:1')
        ).toBeNull();

        fireEvent.click(
            screen.getByRole('button', { name: galleryImages[0].path })
        );
        expect(
            screen.getByText('view.tools.gallery_selection.count:1')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: galleryImages[1].path })
        );
        expect(
            screen.getByText('view.tools.gallery_selection.count:2')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.gallery_selection.select_all'
            })
        );
        expect(
            screen.getByText('view.tools.gallery_selection.count:3')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.gallery_selection.deselect_all'
            })
        );
        expect(
            screen.queryByText('view.tools.gallery_selection.count:3')
        ).toBeNull();
    });

    it('keeps the selection across folders and deletes the combined set', () => {
        const harness = renderGalleryWithImages();

        fireEvent.click(
            screen.getByRole('button', { name: galleryImages[0].path })
        );
        harness.openFolder(mayImages, mayFolder);

        expect(
            screen.getByText('view.tools.gallery_selection.count:1')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: mayImages[0].path })
        );
        expect(
            screen.getByText('view.tools.gallery_selection.count:2')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.delete' })
        );
        expect(harness.onDeleteSelection).toHaveBeenCalledWith([
            galleryImages[0].path,
            mayImages[0].path
        ]);
    });

    it('scopes select all to the open folder', () => {
        const harness = renderGalleryWithImages();

        fireEvent.click(
            screen.getByRole('button', { name: galleryImages[0].path })
        );
        harness.openFolder(mayImages, mayFolder);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.gallery_selection.select_all'
            })
        );
        expect(
            screen.getByText('view.tools.gallery_selection.count:3')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.gallery_selection.deselect_all'
            })
        );
        expect(
            screen.getByText('view.tools.gallery_selection.count:1')
        ).toBeTruthy();
    });

    it('hands the selected paths to the delete callback and clears selection on Escape', () => {
        const { onDeleteSelection } = renderGalleryWithImages();

        fireEvent.click(
            screen.getByRole('button', { name: galleryImages[2].path })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.delete' })
        );
        expect(onDeleteSelection).toHaveBeenCalledWith([galleryImages[2].path]);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(
            screen.queryByText('view.tools.gallery_selection.count:1')
        ).toBeNull();
    });
});
