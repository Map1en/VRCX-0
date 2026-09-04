import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { PageScaffold } from '@/components/layout/PageScaffold';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { convertFileSrc } from '@/platform/tauri/assets';
import mediaRepository from '@/repositories/mediaRepository';
import { withUploadTimeout } from '@/shared/utils/imageUpload';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';

import { ScreenshotGalleryView } from './components/ScreenshotGalleryView';
import {
    ScreenshotDetailActions,
    ScreenshotMetadataDetailsCard,
    ScreenshotMetadataPreviewCard,
    ScreenshotSearchToolbar
} from './components/ScreenshotMetadataSections';
import { ScreenshotSearchResultsView } from './components/ScreenshotSearchResultsView';
import {
    buildScreenshotSearchRow,
    getDroppedScreenshotPath,
    normalizeScreenshotMetadata,
    normalizeScreenshotSearchResult,
    resolvePathAfterScreenshotDelete,
    searchResultToLibraryImage,
    SCREENSHOT_METADATA_SEARCH_TYPES,
    sortScreenshotRowsByNewest,
    type ScreenshotMetadataSearchType
} from './screenshotMetadataValues';
import { useScreenshotBrowseSelection } from './useScreenshotBrowseSelection';
import { useScreenshotBulkDelete } from './useScreenshotBulkDelete';
import { useScreenshotGalleryController } from './useScreenshotGalleryController';
import { useScreenshotMetadataNavigation } from './useScreenshotMetadataNavigation';
import { useScreenshotMetadataSearch } from './useScreenshotMetadataSearch';
import { useScreenshotZipExport } from './useScreenshotZipExport';

function recordFromUnknown(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function ScreenshotMetadataPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { i18n, t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const screenshotCacheStatus = useRuntimeStore(
        (state) => state.hostCapabilities.screenshotCache
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis.$debug?.debugVrcPlus
    );
    const imageVersionRef = useRef(0);
    const metadataRequestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const routePath = searchParams.get('path') || '';
    const routeFolder = searchParams.get('folder') || '';
    const isGalleryMode = !routePath;
    const {
        currentSearchType,
        removeSearchPaths,
        resetSearchResults,
        searchLayout,
        searchNavigationPaths,
        searchQuery,
        searchRows,
        searchSort,
        searchType,
        searchViewMode,
        selectedPath,
        selectedPathIndex,
        setSearchLayout,
        setSearchQuery,
        setSearchResults,
        setSearchType,
        setSearchViewMode,
        setSelectedPath,
        sortedSearchImages,
        sortedSearchRows,
        toggleSearchSort
    } = useScreenshotMetadataSearch();
    const showSearchResults = searchViewMode === 'results';
    const [metadata, setMetadata] = useState<ReturnType<
        typeof normalizeScreenshotMetadata
    > | null>(null);
    const [metadataError, setMetadataError] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isDeletingMetadata, setIsDeletingMetadata] = useState(false);
    const [isDeletingFile, setIsDeletingFile] = useState(false);
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
    const [isDetailsVisible, setIsDetailsVisible] = useState(true);
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const {
        folderTree,
        galleryImagesError,
        galleryScanError,
        galleryTreeError,
        isGalleryTreeLoading,
        openGalleryRoute,
        refreshGallery,
        refreshGalleryTree,
        removeGalleryImages,
        scanStatus,
        selectedGalleryFolder,
        selectedGalleryScrollTop,
        selectGalleryFolder,
        shouldShowGalleryImagesLoading,
        updateGalleryScrollPosition,
        visibleGalleryImages
    } = useScreenshotGalleryController({
        isGalleryMode,
        routeFolder,
        screenshotCacheStatus,
        setSearchParams
    });
    const visibleGalleryImagePaths = useMemo(
        () => visibleGalleryImages.map((image) => image.path),
        [visibleGalleryImages]
    );
    const browseSelection = useScreenshotBrowseSelection(
        visibleGalleryImagePaths
    );
    const { bulkDeleteRunning, deleteScreenshots } = useScreenshotBulkDelete({
        scopeKey: showSearchResults ? `search:${searchQuery}` : 'browse',
        removeDeletedImages: (paths) => {
            removeGalleryImages(paths);
            removeSearchPaths(paths);
            browseSelection.removePaths(paths);
        },
        refreshGalleryTree
    });
    const { exportScreenshots } = useScreenshotZipExport();

    const updateRoutePath = useCallback(
        (path: string, folderPath?: string) => {
            const nextParams = new URLSearchParams();
            nextParams.set('path', path);
            const folder = folderPath || selectedGalleryFolder || routeFolder;
            if (folder) {
                nextParams.set('folder', folder);
            }
            setSearchParams(nextParams);
        },
        [routeFolder, selectedGalleryFolder, setSearchParams]
    );

    const openDetailPath = useCallback(
        (
            path: string,
            { clearPreview = true }: { clearPreview?: boolean } = {}
        ) => {
            if (path) {
                if (clearPreview) {
                    metadataRequestRef.current += 1;
                    setMetadata(null);
                    setMetadataError('');
                    setImageUrl('');
                }
                updateRoutePath(path);
            }
        },
        [updateRoutePath]
    );

    function openSearchResultPath(path: string) {
        setSelectedPath(path);
        setSearchViewMode('detail');
        openDetailPath(path);
    }

    function resetSearchContext({
        clearQuery = false,
        clearPreview = false
    }: { clearQuery?: boolean; clearPreview?: boolean } = {}) {
        resetSearchResults({ clearQuery });

        if (clearPreview) {
            setMetadata(null);
            setMetadataError('');
            setImageUrl('');
        }
    }

    const loadScreenshot = useCallback(
        async (path: string, withCarousel = true) => {
            if (!path) {
                return;
            }

            const requestId = metadataRequestRef.current + 1;
            metadataRequestRef.current = requestId;
            setIsMetadataLoading(true);
            setMetadataError('');

            try {
                const rawMetadata = recordFromUnknown(
                    await mediaRepository.getScreenshotMetadata(path)
                );

                if (metadataRequestRef.current !== requestId) {
                    return;
                }

                const sourceFile =
                    typeof rawMetadata.sourceFile === 'string'
                        ? rawMetadata.sourceFile
                        : '';
                if (!sourceFile) {
                    const message = t(
                        'dialog.screenshot_metadata.invalid_file'
                    );
                    setMetadata(null);
                    setImageUrl('');
                    setMetadataError(message);
                    toast.error(message);
                    return;
                }

                const extra = await mediaRepository.getExtraScreenshotData(
                    sourceFile,
                    withCarousel
                );

                if (metadataRequestRef.current !== requestId) {
                    return;
                }

                const nextMetadata = normalizeScreenshotMetadata(
                    rawMetadata,
                    extra
                );
                const nextMetadataError = rawMetadata?.error
                    ? String(rawMetadata.error)
                    : '';
                imageVersionRef.current += 1;

                setMetadata(nextMetadata);
                setMetadataError(nextMetadataError);
                setSelectedPath(nextMetadata.filePath);
                setImageUrl(
                    `${convertFileSrc(nextMetadata.filePath, 'vrcx-0-img')}?v=${imageVersionRef.current}`
                );
            } catch (error) {
                if (metadataRequestRef.current !== requestId) {
                    return;
                }

                setMetadata(null);
                setImageUrl('');
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Failed to load screenshot metadata.';
                setMetadataError(message);
                toast.error(message);
            } finally {
                if (metadataRequestRef.current === requestId) {
                    setIsMetadataLoading(false);
                }
            }
        },
        [setSelectedPath, t]
    );

    useEffect(() => {
        if (!routePath) {
            return;
        }
        setSearchViewMode('detail');
        loadScreenshot(routePath, true);
    }, [loadScreenshot, routePath, setSearchViewMode]);

    const { canNavigateNext, canNavigatePrev, navigateNext, navigatePrev } =
        useScreenshotMetadataNavigation({
            enabled: !isGalleryMode && searchViewMode === 'detail',
            loadScreenshot,
            metadata,
            onPathChange: updateRoutePath,
            searchNavigationPaths,
            selectedPath,
            setSelectedPath
        });

    useEffect(() => {
        function handleDetailsShortcut(event: KeyboardEvent) {
            const target = event.target;
            if (
                isGalleryMode ||
                searchViewMode !== 'detail' ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.key.toLowerCase() !== 'i' ||
                (target instanceof HTMLElement &&
                    (target.isContentEditable ||
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.tagName === 'SELECT'))
            ) {
                return;
            }

            event.preventDefault();
            setIsDetailsVisible((visible) => !visible);
        }

        window.addEventListener('keydown', handleDetailsShortcut);
        return () => {
            window.removeEventListener('keydown', handleDetailsShortcut);
        };
    }, [isGalleryMode, searchViewMode]);

    async function openFolder() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await mediaRepository.openFolderAndSelectItem(
                metadata.filePath,
                false
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.toast.failed_to_open_folder')
            );
        }
    }

    async function copyImage() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await mediaRepository.copyImageToClipboard(metadata.filePath);
            toast.success(t('message.image.copied_to_clipboard'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.toast.failed_to_copy_image')
            );
        }
    }

    async function deleteMetadata() {
        const filePath = metadata?.filePath || '';
        if (!filePath) {
            return;
        }

        const result = await confirm({
            title: t('dialog.screenshot_metadata.delete_metadata'),
            description: metadata?.fileName || filePath,
            confirmText: t('dialog.screenshot_metadata.delete_metadata'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setIsDeletingMetadata(true);

        try {
            const deleted =
                await mediaRepository.deleteScreenshotMetadata(filePath);
            if (!deleted) {
                toast.error(t('message.screenshot_metadata.delete_failed'));
                return;
            }

            toast.success(t('message.screenshot_metadata.deleted'));
            await loadScreenshot(filePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('message.screenshot_metadata.delete_failed')
            );
        } finally {
            setIsDeletingMetadata(false);
        }
    }

    async function deleteScreenshotFile() {
        const filePath = metadata?.filePath || '';
        if (!filePath) {
            return;
        }

        const result = await confirm({
            title: t('dialog.screenshot_metadata.delete_file_confirm_title'),
            description: t(
                'dialog.screenshot_metadata.delete_file_confirm_description'
            ),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        const nextTarget = resolvePathAfterScreenshotDelete(metadata);
        setIsDeletingFile(true);

        try {
            await mediaRepository.deleteScreenshotFile(filePath);
            toast.success(t('message.screenshot_metadata.file_deleted'));
            if (nextTarget) {
                updateRoutePath(nextTarget.filePath, nextTarget.folderPath);
                return;
            }
            openGalleryRoute();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('message.screenshot_metadata.file_delete_failed')
            );
        } finally {
            setIsDeletingFile(false);
        }
    }

    async function uploadScreenshotToGallery() {
        if (!metadata?.filePath) {
            return;
        }
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (metadata.fileSizeBytes > 10_000_000) {
            toast.error(t('message.file.too_large'));
            return;
        }

        setIsUploadingScreenshot(true);
        try {
            const base64Body = await mediaRepository.getFileBase64(
                metadata.filePath
            );
            await withUploadTimeout(
                mediaRepository.uploadGalleryImage(base64Body)
            );
            toast.success(t('message.gallery.uploaded'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('message.gallery.failed')
            );
        } finally {
            setIsUploadingScreenshot(false);
        }
    }

    async function runSearch(
        nextSearchType: ScreenshotMetadataSearchType['value'] = searchType,
        nextSearchQuery: string = searchQuery
    ) {
        const query = nextSearchQuery.trim();
        const selectedSearchType =
            SCREENSHOT_METADATA_SEARCH_TYPES.find(
                (type) => type.value === nextSearchType
            ) ?? SCREENSHOT_METADATA_SEARCH_TYPES[0];

        if (!query) {
            searchRequestRef.current += 1;
            resetSearchContext();
            if (metadata?.filePath) {
                await loadScreenshot(metadata.filePath, true);
            }
            return;
        }

        const requestId = searchRequestRef.current + 1;
        searchRequestRef.current = requestId;
        setIsSearchLoading(true);
        setSearchViewMode('results');

        try {
            const results = await mediaRepository.findScreenshotsBySearch(
                query,
                selectedSearchType.index
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            if (!Array.isArray(results) || results.length === 0) {
                setSearchResults({ rows: [], images: [] });
                setSelectedPath('');
                setMetadataError('');
                return;
            }

            const rows = results.map((result) =>
                buildScreenshotSearchRow(
                    normalizeScreenshotSearchResult(result),
                    selectedSearchType,
                    query,
                    dateLocale
                )
            );

            setSearchResults({
                rows: sortScreenshotRowsByNewest(rows),
                images: results.map(searchResultToLibraryImage)
            });
            setMetadataError('');
            setSelectedPath('');
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to search screenshot metadata.';
            setSearchResults({ rows: [], images: [] });
            setMetadataError(message);
            toast.error(message);
        } finally {
            if (searchRequestRef.current === requestId) {
                setIsSearchLoading(false);
            }
        }
    }

    function handleSearchTypeChange(value: string | null) {
        const nextType = SCREENSHOT_METADATA_SEARCH_TYPES.find(
            (type) => type.value === value
        )?.value;
        if (!nextType) {
            return;
        }
        setSearchType(nextType);
        if (searchQuery.trim()) {
            setSearchResults({ rows: [], images: [] });
            setSelectedPath('');
        }
        runSearch(nextType);
    }

    async function handleScreenshotDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const filePath = getDroppedScreenshotPath(event);
        if (!filePath) {
            toast.error(
                t('view.tools.error.dropped_screenshot_path_is_not_available')
            );
            return;
        }
        resetSearchContext({ clearQuery: true });
        openDetailPath(filePath);
    }

    function handleScreenshotDragOver(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    if (!screenshotCacheStatus?.available) {
        return (
            <PageScaffold className="screenshot-metadata-page flex-1">
                <ToolPageHeader toolKey="screenshot-metadata" />
                <div className="text-muted-foreground mt-4 rounded-md border p-4 text-sm">
                    {screenshotCacheStatus?.reason ||
                        'Screenshot cache is unavailable on this platform.'}
                </div>
            </PageScaffold>
        );
    }

    return (
        <PageScaffold className="screenshot-metadata-page flex-1">
            <ToolPageHeader
                toolKey="screenshot-metadata"
                status={
                    <>
                        {isDeletingMetadata || isDeletingFile ? (
                            <Badge variant="outline">
                                {isDeletingFile
                                    ? t(
                                          'view.tools.loading.deleting_screenshot'
                                      )
                                    : t('view.tools.loading.deleting_metadata')}
                            </Badge>
                        ) : null}
                        {isUploadingScreenshot ? (
                            <Badge variant="outline">
                                {t('view.tools.loading.uploading_screenshot')}
                            </Badge>
                        ) : null}
                    </>
                }
            />

            <ScreenshotSearchToolbar
                searchQuery={searchQuery}
                searchType={searchType}
                searchLayout={searchLayout}
                showResultControls={showSearchResults}
                searchRowsCount={searchRows.length}
                searchNavigationCount={searchNavigationPaths.length}
                selectedPathIndex={selectedPathIndex}
                onSearchQueryChange={setSearchQuery}
                onSearchTypeChange={handleSearchTypeChange}
                onSearch={() => {
                    runSearch();
                }}
                onSearchLayoutChange={setSearchLayout}
                onClearSearch={() => {
                    resetSearchContext({ clearQuery: true });
                }}
            />

            {showSearchResults ? (
                <ScreenshotSearchResultsView
                    isSearchLoading={isSearchLoading}
                    layout={searchLayout}
                    images={sortedSearchImages}
                    rows={sortedSearchRows}
                    currentSearchType={currentSearchType}
                    searchSort={searchSort}
                    searchQuery={searchQuery}
                    selectedPath={selectedPath}
                    isDeleteRunning={bulkDeleteRunning}
                    onToggleSearchSort={toggleSearchSort}
                    onOpenResultPath={openSearchResultPath}
                    onDeleteSelection={(paths) => {
                        deleteScreenshots(paths);
                    }}
                    onExportSelection={(paths, groupByFolder) => {
                        exportScreenshots(paths, groupByFolder);
                    }}
                />
            ) : isGalleryMode ? (
                <ScreenshotGalleryView
                    folderTree={folderTree}
                    images={visibleGalleryImages}
                    isImagesLoading={shouldShowGalleryImagesLoading}
                    isTreeLoading={isGalleryTreeLoading && !folderTree}
                    error={
                        galleryScanError ||
                        galleryTreeError ||
                        galleryImagesError
                    }
                    scanStatus={scanStatus}
                    selectedFolder={selectedGalleryFolder}
                    onOpenImage={(path) => {
                        resetSearchContext();
                        openDetailPath(path);
                    }}
                    onRefresh={() => {
                        refreshGallery(true);
                    }}
                    onSelectFolder={selectGalleryFolder}
                    onDeleteSelection={(paths) => {
                        deleteScreenshots(paths);
                    }}
                    onExportSelection={(paths, groupByFolder) => {
                        exportScreenshots(paths, groupByFolder);
                    }}
                    onScrollPositionChange={updateGalleryScrollPosition}
                    isDeleteRunning={bulkDeleteRunning}
                    restoreScrollTop={selectedGalleryScrollTop}
                    selection={browseSelection}
                />
            ) : (
                <>
                    <ScreenshotDetailActions
                        metadata={metadata}
                        isVrcPlusSupporter={isVrcPlusSupporter}
                        isUploadingScreenshot={isUploadingScreenshot}
                        isDeletingMetadata={isDeletingMetadata}
                        isDeletingFile={isDeletingFile}
                        onBackToGallery={openGalleryRoute}
                        onOpenFolder={() => {
                            openFolder();
                        }}
                        onCopyImage={() => {
                            copyImage();
                        }}
                        onUpload={() => {
                            uploadScreenshotToGallery();
                        }}
                        onDelete={() => {
                            deleteMetadata();
                        }}
                        onDeleteFile={() => {
                            deleteScreenshotFile();
                        }}
                    />

                    <div
                        className={
                            isDetailsVisible
                                ? 'grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]'
                                : 'grid min-h-0 flex-1'
                        }
                    >
                        <ScreenshotMetadataPreviewCard
                            metadata={metadata}
                            imageUrl={imageUrl}
                            isMetadataLoading={isMetadataLoading}
                            canNavigatePrev={canNavigatePrev}
                            canNavigateNext={canNavigateNext}
                            isDetailsVisible={isDetailsVisible}
                            onNavigatePrev={() => {
                                navigatePrev();
                            }}
                            onNavigateNext={() => {
                                navigateNext();
                            }}
                            onToggleDetails={() => {
                                setIsDetailsVisible((visible) => !visible);
                            }}
                            onImagePreview={() =>
                                openImagePreview({
                                    url: imageUrl,
                                    title:
                                        metadata?.fileName ||
                                        'Screenshot preview',
                                    fileName: metadata?.fileName || '',
                                    sourcePath: metadata?.filePath || ''
                                })
                            }
                            onDragOver={handleScreenshotDragOver}
                            onDrop={(event) => {
                                handleScreenshotDrop(event);
                            }}
                        />

                        {isDetailsVisible ? (
                            <ScreenshotMetadataDetailsCard
                                metadata={metadata}
                                metadataError={metadataError}
                                searchRowsCount={searchRows.length}
                                onBackToResults={() =>
                                    setSearchViewMode('results')
                                }
                            />
                        ) : null}
                    </div>
                </>
            )}
        </PageScaffold>
    );
}
