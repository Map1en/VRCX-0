// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ScreenshotSelectableImageGrid', () => ({
    ScreenshotSelectableImageGrid: ({ images }: { images: unknown[] }) => (
        <div data-testid="image-grid">{images.length}</div>
    )
}));

vi.mock('./ScreenshotMetadataSections', () => ({
    ScreenshotMetadataResultsTable: ({
        sortedSearchRows
    }: {
        sortedSearchRows: unknown[];
    }) => <div data-testid="results-table">{sortedSearchRows.length}</div>
}));

import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import { ScreenshotSearchResultsView } from './ScreenshotSearchResultsView';

const rows = [
    { filePath: 'a.png', dateTime: null, playerCount: 0, world: 'W' },
    { filePath: 'b.png', dateTime: null, playerCount: 0, world: 'W' }
];

function image(fileName: string): ScreenshotLibraryImage {
    return {
        path: fileName,
        folderPath: '',
        fileName,
        sizeBytes: 0,
        modifiedAt: 0,
        createdAt: null,
        width: null,
        height: null,
        worldId: null,
        worldName: null,
        capturedAt: null,
        capturedAtMs: 1,
        metadata: null,
        error: null
    };
}

const images = [image('a.png'), image('b.png')];

function renderView(
    overrides: Partial<
        React.ComponentProps<typeof ScreenshotSearchResultsView>
    > = {}
) {
    render(
        <ScreenshotSearchResultsView
            isSearchLoading={false}
            layout="grid"
            images={images}
            rows={rows}
            showMatch
            searchSort={{ key: 'dateTime', asc: false }}
            searchKey="ava"
            selectedPath=""
            isDeleteRunning={false}
            onToggleSearchSort={() => undefined}
            onOpenResultPath={() => undefined}
            onDeleteSelection={() => undefined}
            onExportSelection={() => undefined}
            {...overrides}
        />
    );
}

describe('ScreenshotSearchResultsView', () => {
    afterEach(cleanup);

    it('renders the image grid by default and the detail list when switched', () => {
        renderView();
        expect(screen.getByTestId('image-grid').textContent).toBe('2');
        expect(screen.queryByTestId('results-table')).toBeNull();

        cleanup();
        renderView({ layout: 'list' });
        expect(screen.getByTestId('results-table').textContent).toBe('2');
        expect(screen.queryByTestId('image-grid')).toBeNull();
    });

    it('shows the loading state before any layout renders', () => {
        renderView({ isSearchLoading: true });

        expect(screen.queryByTestId('image-grid')).toBeNull();
        expect(screen.queryByTestId('results-table')).toBeNull();
        expect(
            screen.getByText('view.tools.loading.searching_screenshots')
        ).toBeTruthy();
    });

    it('shows the empty state in both layouts when nothing matched', () => {
        renderView({ rows: [], images: [] });
        expect(
            screen.getByText('dialog.screenshot_metadata.no_results')
        ).toBeTruthy();
        expect(screen.queryByTestId('image-grid')).toBeNull();

        cleanup();
        renderView({ rows: [], images: [], layout: 'list' });
        expect(
            screen.getByText('dialog.screenshot_metadata.no_results')
        ).toBeTruthy();
        expect(screen.queryByTestId('results-table')).toBeNull();
    });
});
