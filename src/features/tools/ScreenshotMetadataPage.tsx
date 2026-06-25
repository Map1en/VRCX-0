import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PageScaffold } from '@/components/layout/PageScaffold';
import { convertFileSrc } from '@/platform/tauri/assets';
import mediaRepository from '@/repositories/mediaRepository';
import { withUploadTimeout } from '@/shared/utils/imageUpload';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { ScreenshotGalleryView } from './components/ScreenshotGalleryView';
import {
    ScreenshotMetadataDetailsCard,
    ScreenshotMetadataHeader,
    ScreenshotMetadataPreviewCard,
    ScreenshotMetadataResultsTable,
    ScreenshotMetadataToolbar
} from './components/ScreenshotMetadataSections';
import {
    buildScreenshotSearchRow,
    getDroppedScreenshotPath,
    normalizeScreenshotMetadata,
    SCREENSHOT_METADATA_SEARCH_TYPES,
    sortScreenshotRowsByNewest
} from './screenshotMetadataValues';
import { useScreenshotGalleryController } from './useScreenshotGalleryController';
import { useScreenshotMetadataNavigation } from './useScreenshotMetadataNavigation';
import { useScreenshotMetadataSearch } from './useScreenshotMetadataSearch';

function openSearchResult(
    row: any,
    { openDetailPath, setSelectedPath, setSearchViewMode }: any
) {
    setSelectedPath(row.filePath);
    setSearchViewMode('detail');
    openDetailPath(row.filePath);
}

export function ScreenshotMetadataPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { i18n, t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const screenshotCacheStatus = useRuntimeStore(
        (state: any) => state.hostCapabilities.screenshotCache
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
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
        resetSearchTable,
        searchNavigationPaths,
        searchQuery,
        searchRows,
        searchSort,
        searchType,
        searchViewMode,
        selectedPath,
        selectedPathIndex,
        setSearchQuery,
        setSearchRows,
        setSearchType,
        setSearchViewMode,
        setSelectedPath,
        sortedSearchRows,
        toggleSearchSort
    } = useScreenshotMetadataSearch();
    const [metadata, setMetadata] = useState<ReturnType<
        typeof normalizeScreenshotMetadata
    > | null>(null);
    const [metadataError, setMetadataError] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isDeletingMetadata, setIsDeletingMetadata] = useState(false);
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const {
        folderTree,
        galleryImagesError,
        galleryScanError,
        galleryTreeError,
        isGalleryTreeLoading,
        openGalleryRoute,
        refreshGallery,
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
        setSearchParams,
        t
    });

    const updateRoutePath = useCallback(
        (path: any) => {
            const nextParams = new URLSearchParams();
            nextParams.set('path', path);
            const folder = selectedGalleryFolder || routeFolder;
            if (folder) {
                nextParams.set('folder', folder);
            }
            setSearchParams(nextParams);
        },
        [routeFolder, selectedGalleryFolder, setSearchParams]
    );

    const openDetailPath = useCallback(
        (path: any, { clearPreview = true }: any = {}) => {
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

    function resetSearchContext({
        clearQuery = false,
        clearPreview = false
    }: any = {}) {
        resetSearchTable({ clearQuery });

        if (clearPreview) {
            setMetadata(null);
            setMetadataError('');
            setImageUrl('');
        }
    }

    async function loadScreenshot(path: any, withCarousel: any = true) {
        if (!path) {
            return;
        }

        const requestId = metadataRequestRef.current + 1;
        metadataRequestRef.current = requestId;
        setIsMetadataLoading(true);
        setMetadataError('');

        try {
            const rawMetadata: any =
                await mediaRepository.getScreenshotMetadata(path);

            if (metadataRequestRef.current !== requestId) {
                return;
            }

            if (!rawMetadata?.sourceFile) {
                const message = t('dialog.screenshot_metadata.invalid_file');
                setMetadata(null);
                setImageUrl('');
                setMetadataError(message);
                toast.error(message);
                return;
            }

            const extra = await mediaRepository.getExtraScreenshotData(
                rawMetadata.sourceFile,
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
    }

    useEffect(() => {
        if (!routePath) {
            return;
        }
        setSearchViewMode('detail');
        loadScreenshot(routePath, true);
    }, [routePath]);

    const { navigateNext, navigatePrev } = useScreenshotMetadataNavigation({
        loadScreenshot,
        metadata,
        onPathChange: updateRoutePath,
        searchNavigationPaths,
        selectedPath,
        setSelectedPath
    });

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

    async function uploadScreenshotToGallery() {
        if (!metadata?.filePath) {
            return;
        }
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (Number(metadata.fileSizeBytes) > 10_000_000) {
            toast.error(t('message.file.too_large'));
            return;
        }

        setIsUploadingScreenshot(true);
        try {
            const base64Body = await mediaRepository.getFileBase64(
                metadata.filePath
            );
            await withUploadTimeout(
                mediaRepository.uploadGalleryImage(base64Body, {
                    endpoint: currentEndpoint
                })
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
        nextSearchType: any = searchType,
        nextSearchQuery: any = searchQuery
    ) {
        const query = nextSearchQuery.trim();
        const selectedSearchType =
            SCREENSHOT_METADATA_SEARCH_TYPES.find(
                (type: any) => type.value === nextSearchType
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

        try {
            const paths = await mediaRepository.findScreenshotsBySearch(
                query,
                selectedSearchType.index
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            if (!Array.isArray(paths) || paths.length === 0) {
                const message = t('dialog.screenshot_metadata.no_results');
                resetSearchContext({ clearPreview: true });
                setMetadataError(message);
                toast.error(message);
                return;
            }

            const rows = await Promise.all(
                paths.map(async (path: any) => {
                    try {
                        const [rawMetadata, extra] = await Promise.all([
                            mediaRepository.getScreenshotMetadata(path),
                            mediaRepository.getExtraScreenshotData(path, false)
                        ]);
                        const normalized = normalizeScreenshotMetadata(
                            rawMetadata ?? {},
                            extra ?? {}
                        );
                        return buildScreenshotSearchRow(
                            normalized,
                            selectedSearchType,
                            query,
                            dateLocale
                        );
                    } catch (error) {
                        console.error(
                            'Failed to enrich screenshot search result:',
                            path,
                            error
                        );
                        return null;
                    }
                })
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            const nextRows = sortScreenshotRowsByNewest(rows);

            setSearchRows(nextRows);
            setMetadataError('');
            setSelectedPath('');
            setSearchViewMode('table');
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to search screenshot metadata.';
            setMetadata(null);
            setImageUrl('');
            setMetadataError(message);
            toast.error(message);
        } finally {
            if (searchRequestRef.current === requestId) {
                setIsSearchLoading(false);
            }
        }
    }

    function handleSearchTypeChange(value: any) {
        setSearchType(value);
        if (searchQuery.trim()) {
            setSearchRows([]);
            setSelectedPath('');
        }
        runSearch(value);
    }

    async function handleScreenshotDrop(event: any) {
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

    function handleScreenshotDragOver(event: any) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    if (!screenshotCacheStatus?.available) {
        return (
            <PageScaffold className="screenshot-metadata-page flex-1">
                <ScreenshotMetadataHeader
                    backLabel={t('nav_tooltip.tools')}
                    title={t('dialog.screenshot_metadata.header')}
                    deleting={false}
                    uploading={false}
                    deletingLabel={t('view.tools.loading.deleting_metadata')}
                    uploadingLabel={t(
                        'view.tools.loading.uploading_screenshot'
                    )}
                    onBack={() => navigate('/tools')}
                />
                <div className="text-muted-foreground mt-4 rounded-md border p-4 text-sm">
                    {screenshotCacheStatus?.reason ||
                        'Screenshot cache is unavailable on this platform.'}
                </div>
            </PageScaffold>
        );
    }

    return (
        <PageScaffold className="screenshot-metadata-page flex-1">
            <ScreenshotMetadataHeader
                backLabel={t('nav_tooltip.tools')}
                title={t('dialog.screenshot_metadata.header')}
                deleting={isDeletingMetadata}
                uploading={isUploadingScreenshot}
                deletingLabel={t('view.tools.loading.deleting_metadata')}
                uploadingLabel={t('view.tools.loading.uploading_screenshot')}
                onBack={() =>
                    isGalleryMode ? navigate('/tools') : openGalleryRoute()
                }
            />

            {isGalleryMode ? (
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
                    onOpenImage={openDetailPath}
                    onRefresh={() => {
                        refreshGallery(true);
                    }}
                    onSelectFolder={selectGalleryFolder}
                    onScrollPositionChange={updateGalleryScrollPosition}
                    restoreScrollTop={selectedGalleryScrollTop}
                />
            ) : (
                <>
                    <ScreenshotMetadataToolbar
                        metadata={metadata}
                        isVrcPlusSupporter={isVrcPlusSupporter}
                        isUploadingScreenshot={isUploadingScreenshot}
                        isDeletingMetadata={isDeletingMetadata}
                        searchQuery={searchQuery}
                        searchType={searchType}
                        searchViewMode={searchViewMode}
                        searchRowsCount={searchRows.length}
                        searchNavigationCount={searchNavigationPaths.length}
                        selectedPathIndex={selectedPathIndex}
                        onSearchQueryChange={setSearchQuery}
                        onSearchTypeChange={handleSearchTypeChange}
                        onSearch={() => {
                            runSearch();
                        }}
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
                    />

                    {searchViewMode === 'table' ? (
                        <ScreenshotMetadataResultsTable
                            isSearchLoading={isSearchLoading}
                            currentSearchType={currentSearchType}
                            searchSort={searchSort}
                            sortedSearchRows={sortedSearchRows}
                            selectedPath={selectedPath}
                            onToggleSearchSort={toggleSearchSort}
                            onOpenResult={(row: any) =>
                                openSearchResult(row, {
                                    openDetailPath,
                                    setSelectedPath,
                                    setSearchViewMode
                                })
                            }
                        />
                    ) : (
                        <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]">
                            <ScreenshotMetadataPreviewCard
                                metadata={metadata}
                                imageUrl={imageUrl}
                                isMetadataLoading={isMetadataLoading}
                                onNavigatePrev={() => {
                                    navigatePrev();
                                }}
                                onNavigateNext={() => {
                                    navigateNext();
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
                                onDrop={(event: any) => {
                                    handleScreenshotDrop(event);
                                }}
                            />

                            <ScreenshotMetadataDetailsCard
                                metadata={metadata}
                                metadataError={metadataError}
                                searchRowsCount={searchRows.length}
                                currentEndpoint={currentEndpoint}
                                onBackToResults={() =>
                                    setSearchViewMode('table')
                                }
                            />
                        </div>
                    )}
                </>
            )}
        </PageScaffold>
    );
}
