import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_SCREENSHOT_GRID_DENSITY } from '@/components/media/screenshotGridPreferences';
import { useTileSelectionState } from '@/lib/useTileSelectionState';
import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

import { ScreenshotPrintButton } from '../screenshot-share/ScreenshotPrintButton';
import { ScreenshotShareMenu } from '../screenshot-share/ScreenshotShareMenu';
import type {
    ScreenshotSearchRow,
    ScreenshotSearchSort
} from '../screenshotMetadataValues';
import { useClearSelectionOnEscape } from '../useClearSelectionOnEscape';
import type { ScreenshotSearchLayout } from '../useScreenshotMetadataSearch';
import { GallerySelectionBar } from './GallerySelectionBar';
import { EmptyState } from './ScreenshotMetadataParts';
import { ScreenshotMetadataResultsTable } from './ScreenshotMetadataSections';
import { ScreenshotSelectableImageGrid } from './ScreenshotSelectableImageGrid';

export function ScreenshotSearchResultsView({
    isSearchLoading,
    layout,
    images,
    rows,
    showMatch,
    searchSort,
    searchKey,
    selectedPath,
    isDeleteRunning,
    onToggleSearchSort,
    onOpenResultPath,
    onDeleteSelection,
    onExportSelection
}: {
    isSearchLoading: boolean;
    layout: ScreenshotSearchLayout;
    images: ScreenshotLibraryImage[];
    rows: ScreenshotSearchRow[];
    showMatch: boolean;
    searchSort: ScreenshotSearchSort;
    searchKey: string;
    selectedPath: string;
    isDeleteRunning: boolean;
    onToggleSearchSort: (key: string) => void;
    onOpenResultPath: (path: string) => void;
    onDeleteSelection: (paths: string[]) => void;
    onExportSelection: (paths: string[], groupByFolder: boolean) => void;
}) {
    const { t } = useTranslation();
    const imagePaths = useMemo(
        () => images.map((image) => image.path),
        [images]
    );
    const selection = useTileSelectionState({
        keys: imagePaths,
        resetToken: searchKey
    });
    const selectedPaths = useMemo(
        () => imagePaths.filter((path) => selection.selectedKeysSet.has(path)),
        [imagePaths, selection.selectedKeysSet]
    );
    useClearSelectionOnEscape(selection.hasSelection, selection.clearSelection);

    if (isSearchLoading) {
        return (
            <EmptyState
                loading
                title={t('view.tools.loading.searching_screenshots')}
                description={t(
                    'view.tools.loading.resolving_file_list_and_metadata_summaries'
                )}
            />
        );
    }

    if (!rows.length) {
        return (
            <EmptyState
                title={t('dialog.screenshot_metadata.no_results')}
                description={t(
                    'dialog.screenshot_metadata.no_results_description'
                )}
            />
        );
    }

    if (layout === 'list') {
        return (
            <ScreenshotMetadataResultsTable
                showMatch={showMatch}
                searchSort={searchSort}
                sortedSearchRows={rows}
                selectedPath={selectedPath}
                onToggleSearchSort={onToggleSearchSort}
                onOpenResult={(row) => onOpenResultPath(row.filePath)}
            />
        );
    }

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <ScreenshotSelectableImageGrid
                density={DEFAULT_SCREENSHOT_GRID_DENSITY}
                images={images}
                initialScrollTop={0}
                resetKey={searchKey}
                hasSelection={selection.hasSelection}
                selectedKeysSet={selection.selectedKeysSet}
                onOpen={onOpenResultPath}
                onToggleSelect={(path, checked, shift) =>
                    selection.selectItem(path, checked, { shift })
                }
            />
            <GallerySelectionBar
                selectedCount={selectedPaths.length}
                deletableCount={selectedPaths.length}
                isAllSelected={selection.isAllSelected}
                actionsDisabled={isDeleteRunning}
                onSelectAll={selection.toggleSelectAll}
                onClearSelection={selection.clearSelection}
                onDelete={() => onDeleteSelection(selectedPaths)}
                exportAction={{
                    onExport: (groupByFolder) =>
                        onExportSelection(selectedPaths, groupByFolder)
                }}
            >
                <ScreenshotPrintButton
                    paths={selectedPaths}
                    disabled={isDeleteRunning}
                />
                <ScreenshotShareMenu
                    paths={selectedPaths}
                    disabled={isDeleteRunning}
                />
            </GallerySelectionBar>
        </div>
    );
}
